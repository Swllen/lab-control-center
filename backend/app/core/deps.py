"""FastAPI dependencies for authentication and authorization (RBAC-ready)."""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, WebSocket, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.security import SESSION_COOKIE, read_session_token
from app.db.session import SessionLocal, get_db
from app.models import Role, User

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def current_user(request: Request, db: DbSession) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    uid = read_session_token(token) if token else None
    user = await db.get(User, uid) if uid is not None else None
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_role(minimum: Role) -> Callable[..., Coroutine[Any, Any, User]]:
    async def _dep(user: CurrentUser) -> User:
        if not user.has_role(minimum):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role '{minimum.value}'")
        return user

    return _dep


OperatorUser = Annotated[User, Depends(require_role(Role.operator))]
AdminUser = Annotated[User, Depends(require_role(Role.admin))]


async def websocket_user(ws: WebSocket) -> User | None:
    """Authenticate a WebSocket by session cookie and reject cross-site origins (CSWSH)."""
    origin = ws.headers.get("origin")
    if origin and origin not in get_settings().allowed_origins:
        return None
    token = ws.cookies.get(SESSION_COOKIE)
    uid = read_session_token(token) if token else None
    if uid is None:
        return None
    async with SessionLocal() as db:
        user = await db.get(User, uid)
    return user if user and user.is_active else None


async def reject_websocket(ws: WebSocket, code: int, reason: str) -> None:
    """Close with an application code the browser can see. Closing *before* accept() turns into an
    HTTP 403 during the handshake, which browsers report only as a generic 1006 failure."""
    await ws.accept()
    await ws.close(code=code, reason=reason)
