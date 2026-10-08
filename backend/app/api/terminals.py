"""Terminal sessions: REST for lifecycle, WebSocket for the PTY stream.

WebSocket protocol (``/ws/terminals/{id}``):
    server -> client  binary: terminal output (scrollback is replayed first on attach)
                      text:   {"type": "status", "state", "exit_status", "error"}
    client -> server  binary: keystrokes / paste
                      text:   {"type": "resize", "cols", "rows"} | {"type": "input", "data"}
"""

from __future__ import annotations

import asyncio
import contextlib
import json

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, status

from app.api.deps import get_server_or_404
from app.core.deps import DbSession, OperatorUser
from app.core.deps import reject_websocket, websocket_user
from app.models import Role, User
from sqlalchemy import select

from app.models import Server
from app.schemas.terminal import TerminalAccount, TerminalCreate, TerminalOut, TerminalRename
from app.services.ssh_config import alternate_accounts
from app.services.ssh_manager import SSHError
from app.services.terminal_manager import TerminalManager, TerminalSession

router = APIRouter(tags=["terminals"])


def _manager(request: Request) -> TerminalManager:
    return request.app.state.terminals


def _out(s: TerminalSession) -> TerminalOut:
    return TerminalOut(
        id=s.id, server_id=s.server_id, server_name=s.server_name, name=s.name, state=s.state,
        account=s.account, username=s.username,
        exit_status=s.exit_status, error=s.error, created_at=s.created_at, attached=len(s.subscribers),
    )


def _owned(manager: TerminalManager, session_id: str, user: User) -> TerminalSession:
    session = manager.get(session_id)
    if session is None or (session.owner_id != user.id and not user.has_role(Role.admin)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Terminal session not found")
    return session


@router.get("/api/terminals", response_model=list[TerminalOut])
async def list_terminals(request: Request, user: OperatorUser) -> list[TerminalOut]:
    return [_out(s) for s in _manager(request).list(owner_id=user.id)]


@router.get("/api/terminals/accounts", response_model=list[TerminalAccount])
async def list_accounts(_: OperatorUser, db: DbSession) -> list[TerminalAccount]:
    """Login accounts per server: its own login plus other ~/.ssh/config aliases for the same host."""
    out: list[TerminalAccount] = []
    for server in await db.scalars(select(Server).where(Server.transport == "ssh").order_by(Server.id)):
        out.append(TerminalAccount(server_id=server.id, account=None, username=server.username, primary=True))
        out += [
            TerminalAccount(server_id=server.id, account=h.alias, username=h.user, primary=False)
            for h in alternate_accounts(server)
        ]
    return out


@router.post("/api/terminals", response_model=TerminalOut, status_code=status.HTTP_201_CREATED)
async def create_terminal(body: TerminalCreate, request: Request, user: OperatorUser, db: DbSession) -> TerminalOut:
    server = await get_server_or_404(body.server_id, db)
    if server.transport != "ssh":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Simulated servers have no shell")
    account = None
    if body.account:
        account = next((h for h in alternate_accounts(server) if h.alias == body.account), None)
        if account is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{body.account}' is not an account for {server.name}")
    try:
        session = await _manager(request).create(
            server=server, owner_id=user.id, name=body.name, cols=body.cols, rows=body.rows, account=account
        )
    except SSHError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except Exception as exc:  # asyncssh channel errors etc.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Could not open shell: {exc}") from exc
    return _out(session)


@router.get("/api/terminals/{session_id}", response_model=TerminalOut)
async def get_terminal(session_id: str, request: Request, user: OperatorUser) -> TerminalOut:
    return _out(_owned(_manager(request), session_id, user))


@router.patch("/api/terminals/{session_id}", response_model=TerminalOut)
async def rename_terminal(session_id: str, body: TerminalRename, request: Request, user: OperatorUser) -> TerminalOut:
    session = _owned(_manager(request), session_id, user)
    session.name = body.name
    return _out(session)


@router.delete("/api/terminals/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def close_terminal(session_id: str, request: Request, user: OperatorUser) -> None:
    manager = _manager(request)
    _owned(manager, session_id, user)
    await manager.close(session_id)


def _status_frame(s: TerminalSession) -> str:
    return json.dumps({"type": "status", "state": s.state, "exit_status": s.exit_status, "error": s.error})


@router.websocket("/ws/terminals/{session_id}")
async def terminal_ws(ws: WebSocket, session_id: str) -> None:
    user = await websocket_user(ws)
    if user is None or not user.has_role(Role.operator):
        await reject_websocket(ws, 4401, "Not authenticated")
        return
    manager: TerminalManager = ws.app.state.terminals
    session = manager.get(session_id)
    if session is None or (session.owner_id != user.id and not user.has_role(Role.admin)):
        await reject_websocket(ws, 4404, "Unknown session")
        return

    await ws.accept()
    queue = session.attach()
    try:
        await ws.send_text(_status_frame(session))
        if session.scrollback:
            await ws.send_bytes(bytes(session.scrollback))

        async def downstream() -> None:
            while True:
                chunk = await queue.get()
                if chunk is None:  # session closed, or we fell too far behind
                    await ws.send_text(_status_frame(session))
                    if session.state == "closed":
                        return
                    await ws.close(code=4408, reason="Client too slow")
                    return
                # Coalesce queued chunks into one frame to cut per-message overhead.
                parts = [chunk]
                while not queue.empty() and len(parts) < 64:
                    nxt = queue.get_nowait()
                    if nxt is None:
                        queue.put_nowait(None)
                        break
                    parts.append(nxt)
                await ws.send_bytes(b"".join(parts))

        async def upstream() -> None:
            while True:
                msg = await ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                if (data := msg.get("bytes")) is not None:
                    session.write(data)
                elif (text := msg.get("text")) is not None:
                    with contextlib.suppress(ValueError, TypeError, KeyError):
                        frame = json.loads(text)
                        if frame.get("type") == "resize":
                            session.resize(int(frame["cols"]), int(frame["rows"]))
                        elif frame.get("type") == "input":
                            session.write(str(frame["data"]).encode())

        tasks = [asyncio.create_task(downstream()), asyncio.create_task(upstream())]
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError, Exception):
                await task
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        session.detach(queue)
