"""Transfer history, live progress, cancel/retry and server-to-server copies.

WebSocket ``/ws/transfers`` frames:
    {"type": "changed", "live": [...]}  a transfer started/finished (refetch the list)
    {"type": "live", "live": [...]}     progress tick (~2/s while anything is active)
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect, status
from sqlalchemy import delete, select

from app.api.deps import get_server_or_404
from app.core.deps import CurrentUser, DbSession, OperatorUser, reject_websocket, websocket_user
from app.db.session import SessionLocal
from app.models import Transfer
from app.schemas.files import CopyRequest
from app.schemas.transfer import TransferOut
from app.services.sftp_manager import RemoteFileError
from app.services.ssh_manager import SSHError
from app.services.transfer_manager import TransferManager

router = APIRouter(tags=["transfers"])

_ACTIVE = ("queued", "transferring")


def _manager(request: Request) -> TransferManager:
    return request.app.state.transfers


def _with_live(row: Transfer, manager: TransferManager) -> TransferOut:
    out = TransferOut.model_validate(row)
    if lt := manager.live(row.id):
        live = lt.to_json()
        out.status = live["status"]
        out.transferred_bytes = live["transferred_bytes"]
        out.size_bytes = live["size_bytes"]
        out.speed_bps, out.eta_s = live["speed_bps"], live["eta_s"]
    return out


async def transfer_out(transfer_id: int, manager: TransferManager) -> TransferOut:
    async with SessionLocal() as db:
        row = await db.get(Transfer, transfer_id)
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfer not found")
        return _with_live(row, manager)


@router.get("/api/transfers", response_model=list[TransferOut])
async def list_transfers(
    request: Request, _: CurrentUser, db: DbSession, limit: Annotated[int, Query(ge=1, le=500)] = 50
) -> list[TransferOut]:
    rows = await db.scalars(select(Transfer).order_by(Transfer.created_at.desc()).limit(limit))
    manager = _manager(request)
    return [_with_live(r, manager) for r in rows]


@router.post("/api/transfers", response_model=TransferOut, status_code=status.HTTP_201_CREATED)
async def create_copy(body: CopyRequest, request: Request, _: OperatorUser, db: DbSession) -> TransferOut:
    """Server -> server copy of a file or directory into ``dest_dir`` (backend-mediated stream)."""
    source = await get_server_or_404(body.source_server_id, db)
    dest = await get_server_or_404(body.dest_server_id, db)
    if source.transport != "ssh" or dest.transport != "ssh":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Simulated servers have no filesystem")
    manager = _manager(request)
    try:
        src_path = await manager.sftp.resolve(source, body.source_path)
        dest_dir = await manager.sftp.resolve(dest, body.dest_dir)
        transfer_id = await manager.start_copy(source, src_path, dest, dest_dir)
    except RemoteFileError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
    except SSHError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    return await transfer_out(transfer_id, manager)


@router.post("/api/transfers/{transfer_id}/cancel", response_model=TransferOut)
async def cancel(transfer_id: int, request: Request, _: OperatorUser) -> TransferOut:
    manager = _manager(request)
    if not manager.cancel(transfer_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Transfer is not active")
    return await transfer_out(transfer_id, manager)


@router.post("/api/transfers/{transfer_id}/retry", response_model=TransferOut)
async def retry(transfer_id: int, request: Request, _: OperatorUser, db: DbSession) -> TransferOut:
    """Server-side retry for server->server copies. Browser uploads/downloads are retried by the
    client (it holds the file / starts the download), which simply creates a new transfer."""
    manager = _manager(request)
    row = await db.get(Transfer, transfer_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Transfer not found")
    if row.status in _ACTIVE or manager.live(row.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Transfer is still active")
    if row.direction != "server_to_server":
        raise HTTPException(status.HTTP_409_CONFLICT, "Retry uploads/downloads from the browser")
    if row.source_server_id is None or row.dest_server_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Source or destination server no longer exists")
    source = await get_server_or_404(row.source_server_id, db)
    dest = await get_server_or_404(row.dest_server_id, db)
    await manager.retry_copy(row, source, dest)
    return await transfer_out(transfer_id, manager)


@router.delete("/api/transfers", status_code=status.HTTP_204_NO_CONTENT)
async def clear_finished(_: OperatorUser, db: DbSession) -> None:
    """Remove finished transfers from the history."""
    await db.execute(delete(Transfer).where(Transfer.status.not_in(_ACTIVE)))
    await db.commit()


@router.websocket("/ws/transfers")
async def transfers_ws(ws: WebSocket) -> None:
    if await websocket_user(ws) is None:
        await reject_websocket(ws, 4401, "Not authenticated")
        return
    manager: TransferManager = ws.app.state.transfers
    await ws.accept()
    queue = manager.subscribe()

    async def drain() -> None:
        with contextlib.suppress(WebSocketDisconnect):
            while True:
                await ws.receive_text()

    receiver = asyncio.create_task(drain())
    try:
        await ws.send_json({"type": "live", "live": manager.live_snapshot()})
        while not receiver.done():
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({getter, receiver}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                await ws.send_text(getter.result())
            else:
                getter.cancel()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        manager.unsubscribe(queue)
        receiver.cancel()
