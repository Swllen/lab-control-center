"""SFTP access to servers.

One ``SFTPClient`` per server runs on the shared SSH connection (see ``SSHManager``) and is
transparently re-created if the connection drops. Every path coming from the API is normalized
here; ``~`` is expanded to the remote user's home directory.
"""

from __future__ import annotations

import asyncio
import posixpath
import shlex
import stat as statmod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, TypeVar

import asyncssh

from app.core.paths import PathError, normalize_remote_path
from app.services.ssh_manager import SSHManager, SSHTarget

T = TypeVar("T")

MAX_ENTRIES = 20_000
_SYMLINK_RESOLVE_LIMIT = 300

# Never delete these (or the user's home directory itself), whatever the request says.
PROTECTED_PATHS = frozenset({
    "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib32", "/lib64", "/opt", "/proc",
    "/root", "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/var", "/mnt", "/media", "/snap",
})


class RemoteFileError(Exception):
    """User-presentable filesystem error."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class RemoteEntry:
    name: str
    path: str
    type: str  # "file" | "dir" | "symlink" | "other"
    size: int
    mtime: int | None
    mode: str  # "drwxr-xr-x"
    owner: str | None
    group: str | None
    link_target: str | None = None
    target_type: str | None = None  # type of what a symlink points to


def _kind(permissions: int | None) -> str:
    if permissions is None:
        return "other"
    if statmod.S_ISDIR(permissions):
        return "dir"
    if statmod.S_ISLNK(permissions):
        return "symlink"
    if statmod.S_ISREG(permissions):
        return "file"
    return "other"


def _owner_group(longname: str | bytes | None) -> tuple[str | None, str | None]:
    if isinstance(longname, bytes):
        longname = longname.decode(errors="replace")
    parts = (longname or "").split()
    return (parts[2], parts[3]) if len(parts) >= 4 else (None, None)


def _translate(exc: asyncssh.SFTPError, path: str) -> RemoteFileError:
    if isinstance(exc, asyncssh.SFTPNoSuchFile):
        return RemoteFileError(f"No such file or directory: {path}", 404)
    if isinstance(exc, asyncssh.SFTPPermissionDenied):
        return RemoteFileError(f"Permission denied: {path}", 403)
    if isinstance(exc, asyncssh.SFTPFileAlreadyExists):
        return RemoteFileError(f"Already exists: {path}", 409)
    return RemoteFileError(f"{exc.reason or 'SFTP error'}: {path}")


class SFTPManager:
    def __init__(self, ssh: SSHManager) -> None:
        self._ssh = ssh
        self._clients: dict[int, tuple[asyncssh.SSHClientConnection, asyncssh.SFTPClient]] = {}
        self._homes: dict[int, str] = {}
        self._locks: dict[int, asyncio.Lock] = {}

    # ------------------------------------------------------------------ plumbing

    async def connection(self, server: Any) -> asyncssh.SSHClientConnection:
        return await self._ssh.get(server.id, SSHTarget.from_model(server))

    async def client(self, server: Any) -> asyncssh.SFTPClient:
        lock = self._locks.setdefault(server.id, asyncio.Lock())
        async with lock:
            conn = await self.connection(server)
            cached = self._clients.get(server.id)
            if cached and cached[0] is conn:
                return cached[1]
            if cached:
                cached[1].exit()
            sftp = await conn.start_sftp_client()
            self._clients[server.id] = (conn, sftp)
            return sftp

    async def invalidate(self, server_id: int) -> None:
        cached = self._clients.pop(server_id, None)
        if cached:
            cached[1].exit()

    async def run(self, server: Any, op: Callable[[asyncssh.SFTPClient], Awaitable[T]], path: str = "") -> T:
        """Run an SFTP operation, reconnecting once if the channel/connection died."""
        for attempt in (0, 1):
            sftp = await self.client(server)
            try:
                return await op(sftp)
            except asyncssh.SFTPError as exc:
                if isinstance(exc, asyncssh.SFTPConnectionLost) and attempt == 0:
                    await self.invalidate(server.id)
                    await self._ssh.invalidate(server.id)
                    continue
                raise _translate(exc, path) from exc
            except (asyncssh.ConnectionLost, asyncssh.DisconnectError, BrokenPipeError) as exc:
                await self.invalidate(server.id)
                await self._ssh.invalidate(server.id)
                if attempt == 1:
                    raise RemoteFileError(f"Connection lost: {exc}", 502) from exc
        raise AssertionError("unreachable")

    async def home(self, server: Any) -> str:
        if server.id not in self._homes:
            self._homes[server.id] = await self.run(server, lambda s: s.realpath("."))
        return self._homes[server.id]

    async def resolve(self, server: Any, path: str | None) -> str:
        """Normalize a client-supplied path to an absolute remote path."""
        try:
            normalized = normalize_remote_path(path or "~")
        except PathError as exc:
            raise RemoteFileError(str(exc)) from exc
        if normalized == "~" or normalized.startswith("~/"):
            home = await self.home(server)
            normalized = posixpath.normpath(posixpath.join(home, normalized[2:])) if normalized != "~" else home
        return normalized

    # ------------------------------------------------------------------ operations

    async def stat(self, server: Any, path: str) -> asyncssh.SFTPAttrs:
        return await self.run(server, lambda s: s.stat(path), path)

    async def is_dir(self, server: Any, path: str) -> bool:
        return statmod.S_ISDIR((await self.stat(server, path)).permissions or 0)

    async def exists(self, server: Any, path: str) -> bool:
        return await self.run(server, lambda s: s.exists(path), path)

    async def list(self, server: Any, path: str) -> tuple[list[RemoteEntry], bool]:
        names = await self.run(server, lambda s: s.readdir(path), path)
        entries: list[RemoteEntry] = []
        links: list[RemoteEntry] = []
        for n in names:
            filename = n.filename if isinstance(n.filename, str) else n.filename.decode(errors="replace")
            if filename in (".", ".."):
                continue
            a = n.attrs
            owner, group = _owner_group(n.longname)
            entry = RemoteEntry(
                name=filename,
                path=posixpath.join(path, filename),
                type=_kind(a.permissions),
                size=a.size or 0,
                mtime=a.mtime,
                mode=statmod.filemode(a.permissions) if a.permissions is not None else "?---------",
                owner=owner,
                group=group,
            )
            entries.append(entry)
            if entry.type == "symlink":
                links.append(entry)
            if len(entries) >= MAX_ENTRIES:
                break

        async def resolve_link(entry: RemoteEntry) -> None:
            try:
                sftp = await self.client(server)
                entry.link_target = await sftp.readlink(entry.path)
                target = await sftp.stat(entry.path)
                entry.target_type = _kind(target.permissions)
            except (asyncssh.SFTPError, OSError):
                entry.target_type = None  # dangling link

        await asyncio.gather(*(resolve_link(e) for e in links[:_SYMLINK_RESOLVE_LIMIT]))
        return entries, len(entries) >= MAX_ENTRIES

    async def mkdir(self, server: Any, path: str) -> None:
        if await self.exists(server, path):
            raise RemoteFileError(f"Already exists: {path}", 409)
        await self.run(server, lambda s: s.makedirs(path), path)

    async def makedirs(self, server: Any, path: str) -> None:
        await self.run(server, lambda s: s.makedirs(path, exist_ok=True), path)

    async def rename(self, server: Any, src: str, dst: str, *, overwrite: bool = False) -> None:
        if src == dst:
            return
        if dst.startswith(src.rstrip("/") + "/"):
            raise RemoteFileError("Cannot move a directory into itself")
        if not overwrite and await self.exists(server, dst):
            raise RemoteFileError(f"Already exists: {dst}", 409)

        async def op(s: asyncssh.SFTPClient) -> None:
            try:
                await s.posix_rename(src, dst)  # atomic, replaces the target
            except asyncssh.SFTPOpUnsupported:
                await s.rename(src, dst)

        await self.run(server, op, src)

    async def delete(self, server: Any, paths: list[str]) -> None:
        home = await self.home(server)
        for path in paths:
            if path in PROTECTED_PATHS or path == home or posixpath.dirname(path) == "/":
                raise RemoteFileError(f"Refusing to delete protected path: {path}", 403)
        for path in paths:
            attrs = await self.run(server, lambda s, p=path: s.lstat(p), path)
            if statmod.S_ISDIR(attrs.permissions or 0):
                # rm -rf is far faster than a recursive SFTP walk for large trees.
                conn = await self.connection(server)
                result = await conn.run(f"rm -rf -- {shlex.quote(path)}", check=False)
                if result.exit_status != 0:
                    raise RemoteFileError(str(result.stderr or "").strip() or f"Failed to delete {path}", 500)
            else:
                await self.run(server, lambda s, p=path: s.remove(p), path)
