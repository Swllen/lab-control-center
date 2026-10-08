"""Interactive SSH terminal sessions.

A ``TerminalSession`` owns one PTY channel on a server and outlives individual WebSocket
connections: output is kept in a bounded scrollback buffer and replayed when a browser
(re)attaches, so a page refresh or brief network drop does not kill the shell. Sessions with no
attached client are reaped after ``terminal_idle_timeout_s``.

How the remote shell is started is delegated to a ``TerminalBackend``; ``ShellBackend`` runs the
login shell. A tmux backend (``tmux new -A -s lcc-<id>``) can be dropped in later to make
sessions survive control-center restarts and closed browsers.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Literal, Protocol

import asyncssh

from app.config import get_settings
from app.services.ssh_config import SSHConfigHost
from app.services.ssh_manager import SSHError, SSHManager, SSHTarget, open_connection

log = logging.getLogger(__name__)

SessionState = Literal["starting", "running", "closed"]

_SCROLLBACK_BYTES = 512 * 1024
_READ_CHUNK = 64 * 1024
_SUBSCRIBER_QUEUE = 2048  # chunks; a client that falls this far behind is disconnected


class TerminalBackend(Protocol):
    def command(self, session_id: str) -> str | None:
        """Remote command to run inside the PTY, or None for the user's login shell."""


class ShellBackend:
    def command(self, session_id: str) -> str | None:
        return None


class SlowConsumer(Exception):
    pass


@dataclass
class TerminalSession:
    id: str
    server_id: int
    server_name: str
    name: str
    owner_id: int
    cols: int
    rows: int
    # ~/.ssh/config alias of an alternate account (None = the server's own login).
    account: str | None = None
    username: str | None = None
    created_at: float = field(default_factory=time.time)
    state: SessionState = "starting"
    exit_status: int | None = None
    error: str | None = None
    last_detached: float = field(default_factory=time.time)
    scrollback: bytearray = field(default_factory=bytearray)
    subscribers: set[asyncio.Queue[bytes | None]] = field(default_factory=set)
    process: asyncssh.SSHClientProcess[bytes] | None = None
    own_conn: asyncssh.SSHClientConnection | None = None  # only when the shared one is saturated
    reader: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------ I/O

    def write(self, data: bytes) -> None:
        if self.process and self.state == "running":
            self.process.stdin.write(data)

    def resize(self, cols: int, rows: int) -> None:
        cols, rows = max(2, min(cols, 1000)), max(1, min(rows, 500))
        self.cols, self.rows = cols, rows
        if self.process and self.state == "running":
            self.process.change_terminal_size(cols, rows)

    def _publish(self, chunk: bytes) -> None:
        self.scrollback += chunk
        if len(self.scrollback) > _SCROLLBACK_BYTES:
            del self.scrollback[: len(self.scrollback) - _SCROLLBACK_BYTES]
        for queue in list(self.subscribers):
            if queue.full():
                # Drop the slow client; it can reattach and receive the scrollback.
                self.subscribers.discard(queue)
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
                queue.put_nowait(None)
            else:
                queue.put_nowait(chunk)

    def attach(self) -> asyncio.Queue[bytes | None]:
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE)
        self.subscribers.add(queue)
        return queue

    def detach(self, queue: asyncio.Queue[bytes | None]) -> None:
        self.subscribers.discard(queue)
        if not self.subscribers:
            self.last_detached = time.time()

    async def close(self) -> None:
        if self.process:
            self.process.close()
        if self.reader:
            self.reader.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.reader
        if self.own_conn:
            self.own_conn.close()
        self._mark_closed(self.exit_status, self.error)

    def _mark_closed(self, exit_status: int | None, error: str | None) -> None:
        if self.state == "closed":
            return
        self.state, self.exit_status, self.error = "closed", exit_status, error
        for queue in list(self.subscribers):
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(None)


class TerminalManager:
    def __init__(self, ssh: SSHManager, backend: TerminalBackend | None = None) -> None:
        self._ssh = ssh
        self._backend = backend or ShellBackend()
        self._sessions: dict[str, TerminalSession] = {}
        self._reaper: asyncio.Task[None] | None = None

    def start(self) -> None:
        self._reaper = asyncio.create_task(self._reap_loop(), name="terminal-reaper")

    async def stop(self) -> None:
        if self._reaper:
            self._reaper.cancel()
        for session in list(self._sessions.values()):
            await session.close()
        self._sessions.clear()

    # ------------------------------------------------------------------ queries

    def get(self, session_id: str) -> TerminalSession | None:
        return self._sessions.get(session_id)

    def list(self, owner_id: int | None = None) -> list[TerminalSession]:
        return [s for s in self._sessions.values() if owner_id is None or s.owner_id == owner_id]

    # ------------------------------------------------------------------ lifecycle

    async def create(
        self, *, server: object, owner_id: int, name: str, cols: int, rows: int,
        account: SSHConfigHost | None = None,
    ) -> TerminalSession:
        server_id: int = server.id  # type: ignore[attr-defined]
        session = TerminalSession(
            id=secrets.token_urlsafe(12),
            server_id=server_id,
            server_name=server.name,  # type: ignore[attr-defined]
            name=name,
            owner_id=owner_id,
            cols=max(2, cols),
            rows=max(1, rows),
        )
        if account is None:
            target = SSHTarget.from_model(server)
            conn_key: int | str = server_id
            session.username = server.username  # type: ignore[attr-defined]
        else:
            target = SSHTarget(account.hostname, account.port, account.user or "", None, account.alias)
            conn_key = f"{server_id}@{account.alias}"
            session.account, session.username = account.alias, account.user
        command = self._backend.command(session.id)
        conn = await self._ssh.get(conn_key, target)
        try:
            process = await self._open_pty(conn, command, session)
        except asyncssh.ChannelOpenError:
            # sshd MaxSessions reached on the shared connection: use a dedicated one.
            session.own_conn = await open_connection(target)
            process = await self._open_pty(session.own_conn, command, session)
        except (asyncssh.ConnectionLost, asyncssh.DisconnectError, OSError):
            await self._ssh.invalidate(conn_key)
            conn = await self._ssh.get(conn_key, target)
            process = await self._open_pty(conn, command, session)

        session.process = process
        session.state = "running"
        session.reader = asyncio.create_task(self._pump(session), name=f"terminal-{session.id}")
        self._sessions[session.id] = session
        return session

    @staticmethod
    async def _open_pty(
        conn: asyncssh.SSHClientConnection, command: str | None, session: TerminalSession
    ) -> asyncssh.SSHClientProcess[bytes]:
        return await conn.create_process(
            command,
            term_type="xterm-256color",
            term_size=(session.cols, session.rows),
            env={"COLORTERM": "truecolor", "LCC_SESSION": session.id},
            encoding=None,
            stderr=asyncssh.STDOUT,
        )

    async def _pump(self, session: TerminalSession) -> None:
        assert session.process is not None
        error: str | None = None
        try:
            while True:
                chunk = await session.process.stdout.read(_READ_CHUNK)
                if not chunk:
                    break
                session._publish(chunk)
        except asyncio.CancelledError:
            raise
        except (asyncssh.Error, OSError) as exc:
            error = f"Connection lost: {exc}"
        exit_status = session.process.exit_status
        session._mark_closed(exit_status, error)
        if session.own_conn:
            session.own_conn.close()

    async def close(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session:
            await session.close()

    async def _reap_loop(self) -> None:
        settings = get_settings()
        while True:
            await asyncio.sleep(30)
            now = time.time()
            for session in list(self._sessions.values()):
                idle_for = 0.0 if session.subscribers else now - session.last_detached
                if session.state == "closed" and idle_for > 60:
                    self._sessions.pop(session.id, None)
                elif idle_for > settings.terminal_idle_timeout_s:
                    log.info("closing idle terminal %s (%s)", session.id, session.name)
                    await self.close(session.id)


__all__ = ["SSHError", "TerminalManager", "TerminalSession"]
