"""Transfer tracking and server-to-server copies.

Every upload/download/copy gets a ``Transfer`` row (durable history) plus a ``LiveTransfer``
(in-memory progress, speed, cancel flag) while it runs. Progress is broadcast to WebSocket
subscribers a few times per second; bytes are checkpointed to the DB every few seconds.

Server-to-server copies are backend-mediated streams (SFTP file pipe, or ``tar | tar`` for
directories). The API is shaped so a direct server->server path (e.g. rsync over an SSH hop
initiated on the source) can replace the implementation later.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import posixpath
import shlex
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import asyncssh

from app.db.base import utcnow
from app.db.session import SessionLocal
from app.models import Server, Transfer
from app.services.sftp_manager import RemoteFileError, SFTPManager

log = logging.getLogger(__name__)

CHUNK = 1024 * 1024
_BROADCAST_INTERVAL_S = 0.5
_PERSIST_INTERVAL_S = 3.0
_SPEED_WINDOW_S = 5.0
_MAX_PARALLEL_COPIES = 3


class TransferCanceled(Exception):
    pass


@dataclass
class LiveTransfer:
    id: int
    size: int | None
    transferred: int = 0
    status: str = "transferring"
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    samples: deque[tuple[float, int]] = field(default_factory=lambda: deque(maxlen=64))
    last_persist: float = field(default_factory=time.monotonic)

    def speed(self) -> float:
        if len(self.samples) < 2:
            return 0.0
        (t0, b0), (t1, b1) = self.samples[0], self.samples[-1]
        return (b1 - b0) / (t1 - t0) if t1 > t0 else 0.0

    def to_json(self) -> dict[str, Any]:
        speed = self.speed()
        eta = (self.size - self.transferred) / speed if self.size and speed > 0 else None
        return {
            "id": self.id,
            "status": self.status,
            "transferred_bytes": self.transferred,
            "size_bytes": self.size,
            "speed_bps": round(speed),
            "eta_s": round(eta, 1) if eta is not None else None,
        }


class TransferManager:
    def __init__(self, sftp: SFTPManager) -> None:
        self.sftp = sftp
        self._live: dict[int, LiveTransfer] = {}
        self._subscribers: set[asyncio.Queue[str]] = set()
        self._copy_slots = asyncio.Semaphore(_MAX_PARALLEL_COPIES)
        self._tasks: set[asyncio.Task[None]] = set()
        self._ticker: asyncio.Task[None] | None = None
        self._dirty = False

    # ------------------------------------------------------------------ lifecycle

    def start(self) -> None:
        self._ticker = asyncio.create_task(self._tick_loop(), name="transfer-ticker")

    async def stop(self) -> None:
        if self._ticker:
            self._ticker.cancel()
        for lt in self._live.values():
            lt.cancel.set()
        for task in list(self._tasks):
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        # Anything still marked active did not finish.
        async with SessionLocal() as db:
            for lt in list(self._live.values()):
                row = await db.get(Transfer, lt.id)
                if row and row.status in ("queued", "transferring"):
                    row.status, row.error, row.ended_at = "failed", "Control center stopped", utcnow()
                    row.transferred_bytes = lt.transferred
            await db.commit()

    # ------------------------------------------------------------------ tracking

    async def begin(self, *, status: str = "transferring", **fields: Any) -> LiveTransfer:
        async with SessionLocal() as db:
            row = Transfer(status=status, started_at=utcnow() if status == "transferring" else None, **fields)
            db.add(row)
            await db.commit()
            await db.refresh(row)
        lt = LiveTransfer(id=row.id, size=row.size_bytes, status=status)
        lt.samples.append((time.monotonic(), 0))
        self._live[row.id] = lt
        self._notify_changed()
        return lt

    def progress(self, lt: LiveTransfer, nbytes: int) -> None:
        if lt.cancel.is_set():
            raise TransferCanceled
        lt.transferred += nbytes
        now = time.monotonic()
        lt.samples.append((now, lt.transferred))
        while len(lt.samples) > 2 and now - lt.samples[0][0] > _SPEED_WINDOW_S:
            lt.samples.popleft()
        self._dirty = True

    async def mark_started(self, lt: LiveTransfer) -> None:
        lt.status = "transferring"
        lt.samples.clear()
        lt.samples.append((time.monotonic(), lt.transferred))
        async with SessionLocal() as db:
            row = await db.get(Transfer, lt.id)
            if row:
                row.status, row.started_at = "transferring", utcnow()
                await db.commit()
        self._notify_changed()

    async def finish(self, lt: LiveTransfer, status: str, error: str | None = None) -> None:
        if self._live.pop(lt.id, None) is None:
            return
        lt.status = status
        async with SessionLocal() as db:
            row = await db.get(Transfer, lt.id)
            if row:
                row.status, row.error, row.ended_at = status, error, utcnow()
                row.transferred_bytes = lt.transferred
                if status == "completed" and row.size_bytes is None:
                    row.size_bytes = lt.transferred
                await db.commit()
        self._notify_changed()

    def finish_soon(self, lt: LiveTransfer, status: str, error: str | None = None) -> None:
        """Finish from a context that may be cancelled (e.g. a disconnected stream)."""
        task = asyncio.create_task(self.finish(lt, status, error))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def live(self, transfer_id: int) -> LiveTransfer | None:
        return self._live.get(transfer_id)

    def live_snapshot(self) -> list[dict[str, Any]]:
        return [lt.to_json() for lt in self._live.values()]

    def cancel(self, transfer_id: int) -> bool:
        lt = self._live.get(transfer_id)
        if lt is None:
            return False
        lt.cancel.set()
        return True

    # ------------------------------------------------------------------ pub/sub

    def subscribe(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        self._subscribers.discard(queue)

    def _broadcast(self, frame: dict[str, Any]) -> None:
        payload = json.dumps(frame)
        for queue in self._subscribers:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(payload)

    def _notify_changed(self) -> None:
        self._broadcast({"type": "changed", "live": self.live_snapshot()})

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(_BROADCAST_INTERVAL_S)
            if self._live and self._dirty:
                self._dirty = False
                self._broadcast({"type": "live", "live": self.live_snapshot()})
            now = time.monotonic()
            stale = [lt for lt in self._live.values() if now - lt.last_persist > _PERSIST_INTERVAL_S]
            if stale:
                with contextlib.suppress(Exception):
                    async with SessionLocal() as db:
                        for lt in stale:
                            lt.last_persist = now
                            row = await db.get(Transfer, lt.id)
                            if row:
                                row.transferred_bytes = lt.transferred
                        await db.commit()

    # ------------------------------------------------------------------ server -> server

    async def start_copy(self, source: Server, source_path: str, dest: Server, dest_dir: str) -> int:
        """Queue a backend-mediated copy of a file or directory into ``dest_dir``."""
        src_attrs = await self.sftp.stat(source, source_path)
        is_dir = bool(src_attrs.permissions is not None and (src_attrs.permissions & 0o170000) == 0o040000)
        if not await self.sftp.is_dir(dest, dest_dir):
            raise RemoteFileError(f"Destination is not a directory: {dest_dir}")
        name = posixpath.basename(source_path.rstrip("/")) or "root"
        target = posixpath.join(dest_dir, name)
        if await self.sftp.exists(dest, target):
            raise RemoteFileError(f"Already exists on {dest.name}: {target}", 409)
        size = None if is_dir else src_attrs.size
        lt = await self.begin(
            status="queued", direction="server_to_server", filename=name + ("/" if is_dir else ""),
            is_directory=is_dir, source_server_id=source.id, source_path=source_path,
            dest_server_id=dest.id, dest_path=target, size_bytes=size,
        )
        self._spawn_copy(lt, source, dest)
        return lt.id

    async def retry_copy(self, row: Transfer, source: Server, dest: Server) -> None:
        async with SessionLocal() as db:
            fresh = await db.get(Transfer, row.id)
            assert fresh is not None
            fresh.status, fresh.error, fresh.transferred_bytes = "queued", None, 0
            fresh.started_at = fresh.ended_at = None
            await db.commit()
        lt = LiveTransfer(id=row.id, size=row.size_bytes, status="queued")
        self._live[row.id] = lt
        self._notify_changed()
        self._spawn_copy(lt, source, dest)

    def _spawn_copy(self, lt: LiveTransfer, source: Server, dest: Server) -> None:
        task = asyncio.create_task(self._run_copy(lt, source, dest), name=f"copy-{lt.id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run_copy(self, lt: LiveTransfer, source: Server, dest: Server) -> None:
        async with SessionLocal() as db:
            row = await db.get(Transfer, lt.id)
            assert row is not None
            source_path, target, is_dir = row.source_path, row.dest_path, row.is_directory
        try:
            async with self._copy_slots:
                if lt.cancel.is_set():
                    raise TransferCanceled
                await self.mark_started(lt)
                if is_dir:
                    await self._copy_tree(lt, source, source_path, dest, target)
                else:
                    await self._copy_file(lt, source, source_path, dest, target)
            await self.finish(lt, "completed")
        except TransferCanceled:
            await self.finish(lt, "canceled")
        except asyncio.CancelledError:
            await asyncio.shield(self.finish(lt, "failed", "Interrupted"))
            raise
        except RemoteFileError as exc:
            await self.finish(lt, "failed", str(exc))
        except Exception as exc:  # noqa: BLE001
            log.exception("copy %s failed", lt.id)
            await self.finish(lt, "failed", f"{exc.__class__.__name__}: {exc}")

    async def _copy_file(self, lt: LiveTransfer, source: Server, src: str, dest: Server, target: str) -> None:
        part = target + ".lcc-part"
        src_sftp = await self.sftp.client(source)
        dst_sftp = await self.sftp.client(dest)
        ok = False
        try:
            async with src_sftp.open(src, "rb") as fin, dst_sftp.open(part, "wb") as fout:
                while chunk := await fin.read(CHUNK):
                    await fout.write(chunk)
                    self.progress(lt, len(chunk))
            await self.sftp.rename(dest, part, target, overwrite=True)
            ok = True
        finally:
            if not ok:
                with contextlib.suppress(Exception):
                    await dst_sftp.remove(part)

    async def _copy_tree(self, lt: LiveTransfer, source: Server, src: str, dest: Server, target: str) -> None:
        src_conn = await self.sftp.connection(source)
        dst_conn = await self.sftp.connection(dest)
        # Size estimate for progress/ETA (best effort).
        with contextlib.suppress(Exception):
            du = await asyncio.wait_for(src_conn.run(f"du -sb -- {shlex.quote(src)}", check=False), 30)
            lt.size = int(str(du.stdout).split()[0])
            async with SessionLocal() as db:
                row = await db.get(Transfer, lt.id)
                if row:
                    row.size_bytes = lt.size
                    await db.commit()

        parent, name = posixpath.split(src.rstrip("/"))
        dest_parent = posixpath.dirname(target)
        reader = await src_conn.create_process(
            f"tar -C {shlex.quote(parent or '/')} -cf - -- {shlex.quote(name)}", encoding=None
        )
        writer = await dst_conn.create_process(f"tar -C {shlex.quote(dest_parent)} -xf -", encoding=None)
        try:
            while chunk := await reader.stdout.read(CHUNK):
                writer.stdin.write(chunk)
                await writer.stdin.drain()
                self.progress(lt, len(chunk))
            writer.stdin.write_eof()
            await reader.wait()
            result = await writer.wait()
            if reader.exit_status not in (0, None):
                err = (await reader.stderr.read()).decode(errors="replace")
                raise RemoteFileError(f"tar on {source.name} failed: {err.strip()[-300:]}")
            if result.exit_status not in (0, None):
                err = (result.stderr or b"").decode(errors="replace") if isinstance(result.stderr, bytes) else str(result.stderr or "")
                raise RemoteFileError(f"tar on {dest.name} failed: {err.strip()[-300:]}")
        except BaseException:
            reader.terminate()
            writer.terminate()
            with contextlib.suppress(Exception):
                await dst_conn.run(f"rm -rf -- {shlex.quote(target)}", check=False)
            raise


__all__ = ["CHUNK", "LiveTransfer", "TransferCanceled", "TransferManager", "asyncssh"]
