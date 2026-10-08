"""Remote file manager (SFTP) with streaming upload/download.

Nothing is ever buffered whole in memory: downloads stream 1 MiB SFTP reads straight into the
HTTP response (with Range support for resume), uploads stream the raw request body into a
``.lcc-part`` file that is atomically renamed when complete.
"""

from __future__ import annotations

import asyncio
import contextlib
import mimetypes
import posixpath
import re
import shlex
import stat as statmod
from collections.abc import AsyncIterator
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from starlette.requests import ClientDisconnect

from app.api.deps import ServerDep
from app.core.deps import CurrentUser, OperatorUser
from app.models import Server
from app.schemas.files import DeleteBody, DirListing, FileEntry, PathBody, RenameBody
from app.schemas.transfer import TransferOut
from app.services.sftp_manager import RemoteFileError, SFTPManager
from app.services.ssh_manager import SSHError
from app.services.transfer_manager import CHUNK, LiveTransfer, TransferCanceled, TransferManager

router = APIRouter(prefix="/api/servers/{server_id}", tags=["files"])

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _sftp(request: Request) -> SFTPManager:
    return request.app.state.sftp


def _transfers(request: Request) -> TransferManager:
    return request.app.state.transfers


def _require_ssh(server: Server) -> None:
    if server.transport != "ssh":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Simulated servers have no filesystem")


@contextlib.contextmanager
def _errors():  # type: ignore[no-untyped-def]
    try:
        yield
    except RemoteFileError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except SSHError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc


def _content_disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "replace").decode().replace('"', "")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


# ---------------------------------------------------------------- browsing


@router.get("/files", response_model=DirListing)
async def list_dir(
    server: ServerDep, request: Request, _: CurrentUser, path: Annotated[str, Query(max_length=4096)] = "~"
) -> DirListing:
    _require_ssh(server)
    sftp = _sftp(request)
    with _errors():
        resolved = await sftp.resolve(server, path)
        if not await sftp.is_dir(server, resolved):
            raise RemoteFileError(f"Not a directory: {resolved}")
        entries, truncated = await sftp.list(server, resolved)
        home = await sftp.home(server)
    return DirListing(
        server_id=server.id,
        path=resolved,
        parent=None if resolved == "/" else posixpath.dirname(resolved),
        home=home,
        entries=[FileEntry.model_validate(e, from_attributes=True) for e in entries],
        truncated=truncated,
    )


@router.post("/files/mkdir", status_code=status.HTTP_201_CREATED)
async def mkdir(server: ServerDep, body: PathBody, request: Request, _: OperatorUser) -> dict[str, str]:
    _require_ssh(server)
    sftp = _sftp(request)
    with _errors():
        path = await sftp.resolve(server, body.path)
        await sftp.mkdir(server, path)
    return {"path": path}


@router.post("/files/rename")
async def rename(server: ServerDep, body: RenameBody, request: Request, _: OperatorUser) -> dict[str, str]:
    """Rename or move within one server."""
    _require_ssh(server)
    sftp = _sftp(request)
    with _errors():
        src = await sftp.resolve(server, body.path)
        dst = await sftp.resolve(server, body.new_path)
        # Moving into an existing directory keeps the original name.
        if await sftp.exists(server, dst) and await sftp.is_dir(server, dst) and not body.overwrite:
            dst = posixpath.join(dst, posixpath.basename(src))
        await sftp.rename(server, src, dst, overwrite=body.overwrite)
    return {"path": dst}


@router.post("/files/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete(server: ServerDep, body: DeleteBody, request: Request, _: OperatorUser) -> None:
    _require_ssh(server)
    if not body.confirm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Deletion must be confirmed")
    sftp = _sftp(request)
    with _errors():
        paths = [await sftp.resolve(server, p) for p in body.paths]
        await sftp.delete(server, paths)


# ---------------------------------------------------------------- download


@router.get("/download")
async def download(
    server: ServerDep, request: Request, _: CurrentUser, path: Annotated[str, Query(min_length=1, max_length=4096)]
) -> StreamingResponse:
    _require_ssh(server)
    sftp = _sftp(request)
    transfers = _transfers(request)
    with _errors():
        resolved = await sftp.resolve(server, path)
        attrs = await sftp.stat(server, resolved)
    name = posixpath.basename(resolved) or "root"

    if statmod.S_ISDIR(attrs.permissions or 0):
        return await _download_dir(server, resolved, name, sftp, transfers)

    size = attrs.size or 0
    start, end = 0, size - 1
    status_code = status.HTTP_200_OK
    headers = {"Accept-Ranges": "bytes", "Content-Disposition": _content_disposition(name)}
    if (rng := request.headers.get("range")) and size:
        m = _RANGE_RE.match(rng.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise HTTPException(status.HTTP_416_RANGE_NOT_SATISFIABLE, headers={"Content-Range": f"bytes */{size}"})
        if m.group(1):
            start, end = int(m.group(1)), min(int(m.group(2) or size - 1), size - 1)
        else:  # suffix range: last N bytes
            start, end = max(size - int(m.group(2)), 0), size - 1
        if start > end or start >= size:
            raise HTTPException(status.HTTP_416_RANGE_NOT_SATISFIABLE, headers={"Content-Range": f"bytes */{size}"})
        status_code = status.HTTP_206_PARTIAL_CONTENT
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = max(end - start + 1, 0)
    headers["Content-Length"] = str(length)

    lt = await transfers.begin(
        direction="download", filename=name, source_server_id=server.id, source_path=resolved, size_bytes=length
    )
    client = await sftp.client(server)

    async def body() -> AsyncIterator[bytes]:
        done = False
        try:
            async with client.open(resolved, "rb") as f:
                offset, remaining = start, length
                while remaining > 0:
                    chunk = await f.read(min(CHUNK, remaining), offset)
                    if not chunk:
                        break
                    offset += len(chunk)
                    remaining -= len(chunk)
                    transfers.progress(lt, len(chunk))
                    yield chunk
            done = True
            await transfers.finish(lt, "completed")
        except TransferCanceled:
            done = True
            await transfers.finish(lt, "canceled")
        except Exception as exc:
            done = True
            transfers.finish_soon(lt, "failed", str(exc))
            raise
        finally:
            if not done:
                # Clients often close as soon as they have Content-Length bytes, before the
                # generator resumes; only a short transfer is an interruption.
                if lt.transferred >= length:
                    transfers.finish_soon(lt, "completed")
                else:
                    transfers.finish_soon(lt, "canceled", "Download interrupted")

    media = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return StreamingResponse(body(), status_code=status_code, media_type=media, headers=headers)


async def _download_dir(
    server: Server, path: str, name: str, sftp: SFTPManager, transfers: TransferManager
) -> StreamingResponse:
    """Stream a directory as an (uncompressed) tar produced on the server."""
    conn = await sftp.connection(server)
    parent = posixpath.dirname(path) or "/"
    proc = await conn.create_process(
        f"tar -C {shlex.quote(parent)} -cf - -- {shlex.quote(name)}", encoding=None
    )
    lt = await transfers.begin(
        direction="download", filename=f"{name}/", is_directory=True, source_server_id=server.id, source_path=path
    )

    async def body() -> AsyncIterator[bytes]:
        done = False
        try:
            while chunk := await proc.stdout.read(CHUNK):
                transfers.progress(lt, len(chunk))
                yield chunk
            await proc.wait()
            done = True
            if proc.exit_status not in (0, None):
                err = (await proc.stderr.read()).decode(errors="replace").strip()
                await transfers.finish(lt, "failed", err[-300:] or f"tar exited {proc.exit_status}")
            else:
                await transfers.finish(lt, "completed")
        except TransferCanceled:
            done = True
            await transfers.finish(lt, "canceled")
        finally:
            proc.terminate()
            if not done:
                transfers.finish_soon(lt, "canceled", "Download interrupted")

    return StreamingResponse(
        body(), media_type="application/x-tar", headers={"Content-Disposition": _content_disposition(f"{name}.tar")}
    )


# ---------------------------------------------------------------- upload


def _safe_relative(name: str) -> str:
    """Upload name may include sub-directories (folder uploads) but never escape the target."""
    parts = [p for p in name.replace("\\", "/").split("/") if p not in ("", ".")]
    if not parts or any(p == ".." or "\x00" in p for p in parts) or len(name) > 1024:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid file name")
    return "/".join(parts)


@router.post("/upload", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
async def upload(
    server: ServerDep,
    request: Request,
    _: OperatorUser,
    dir: Annotated[str, Query(min_length=1, max_length=4096)],
    name: Annotated[str, Query(min_length=1, max_length=1024)],
    overwrite: bool = False,
) -> TransferOut:
    """Raw-body streaming upload: ``POST ...?dir=/data&name=sub/file.bin`` with the file as body."""
    _require_ssh(server)
    sftp = _sftp(request)
    transfers = _transfers(request)
    rel = _safe_relative(name)
    length = int(request.headers.get("content-length") or 0) or None
    with _errors():
        base = await sftp.resolve(server, dir)
        if not await sftp.is_dir(server, base):
            raise RemoteFileError(f"Not a directory: {base}")
        target = posixpath.join(base, rel)
        if await sftp.exists(server, target) and not overwrite:
            raise RemoteFileError(f"Already exists: {target}", 409)
        await sftp.makedirs(server, posixpath.dirname(target))
        client = await sftp.client(server)

    part = target + ".lcc-part"
    lt = await transfers.begin(
        direction="upload", filename=posixpath.basename(rel), dest_server_id=server.id, dest_path=target,
        source_path=rel, size_bytes=length,
    )
    ok = False
    try:
        async with client.open(part, "wb") as f:
            buf = bytearray()
            async for chunk in request.stream():
                buf += chunk
                transfers.progress(lt, len(chunk))
                if len(buf) >= CHUNK:  # large writes let asyncssh pipeline SFTP requests
                    await f.write(bytes(buf))
                    buf.clear()
            if buf:
                await f.write(bytes(buf))
        if length is not None and lt.transferred != length:
            raise RemoteFileError(f"Incomplete upload ({lt.transferred} of {length} bytes)")
        await sftp.rename(server, part, target, overwrite=True)
        ok = True
        await transfers.finish(lt, "completed")
    except TransferCanceled:
        await transfers.finish(lt, "canceled")
        raise HTTPException(499, "Upload canceled") from None
    except (ClientDisconnect, asyncio.CancelledError):
        transfers.finish_soon(lt, "canceled", "Upload interrupted")
        raise
    except RemoteFileError as exc:
        await transfers.finish(lt, "failed", str(exc))
        raise HTTPException(exc.status, str(exc)) from exc
    except Exception as exc:
        await transfers.finish(lt, "failed", f"{exc.__class__.__name__}: {exc}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Upload failed: {exc}") from exc
    finally:
        if not ok:
            with contextlib.suppress(Exception):
                await asyncio.shield(client.remove(part))

    from app.api.transfers import transfer_out  # local import avoids a cycle

    return await transfer_out(lt.id, transfers)
