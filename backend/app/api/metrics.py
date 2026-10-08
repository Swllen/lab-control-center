from __future__ import annotations

import asyncio
import contextlib

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status

from app.api.deps import Hub, ServerDep
from app.core.deps import CurrentUser, reject_websocket, websocket_user
from app.schemas.metrics import MetricsHistoryOut, ServerMetricsOut
from app.services.metrics_collector import MetricsHub, ServerRuntime

router = APIRouter(tags=["metrics"])


def _runtime(hub: MetricsHub, server_id: int) -> ServerRuntime:
    runtime = hub.get(server_id)
    if runtime is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No collector for this server")
    return runtime


@router.get("/api/metrics/summary", response_model=list[ServerMetricsOut])
async def summary(_: CurrentUser, hub: Hub) -> list[ServerMetricsOut]:
    return [rt.to_out() for rt in hub.all()]


@router.get("/api/servers/{server_id}/metrics", response_model=ServerMetricsOut)
async def latest(server: ServerDep, _: CurrentUser, hub: Hub) -> ServerMetricsOut:
    return _runtime(hub, server.id).to_out()


@router.get("/api/servers/{server_id}/metrics/history", response_model=MetricsHistoryOut)
async def history(server: ServerDep, _: CurrentUser, hub: Hub) -> MetricsHistoryOut:
    return MetricsHistoryOut(server_id=server.id, history=list(_runtime(hub, server.id).history))


@router.websocket("/ws/servers/{server_id}/metrics")
async def metrics_ws(ws: WebSocket, server_id: int) -> None:
    """Frames: ``hello`` (status, static, history) then ``snapshot`` / ``status`` / ``static``."""
    if await websocket_user(ws) is None:
        await reject_websocket(ws, 4401, "Not authenticated")
        return
    hub: MetricsHub = ws.app.state.hub
    runtime = hub.get(server_id)
    if runtime is None:
        await reject_websocket(ws, 4404, "Unknown server")
        return

    await ws.accept()
    queue = hub.subscribe(server_id)
    # Drain client messages so disconnects are noticed promptly.
    receiver = asyncio.create_task(_drain(ws))
    try:
        await ws.send_text(hub.hello_frame(runtime))
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
        hub.unsubscribe(server_id, queue)
        receiver.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await receiver


async def _drain(ws: WebSocket) -> None:
    with contextlib.suppress(WebSocketDisconnect):
        while True:
            await ws.receive_text()
