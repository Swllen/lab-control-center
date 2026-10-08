"""Accessors for long-lived services stored on ``app.state``."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from app.core.deps import DbSession
from app.models import Server
from app.services.metrics_collector import MetricsHub
from app.services.ssh_manager import SSHManager


def get_hub(request: Request) -> MetricsHub:
    return request.app.state.hub


def get_ssh(request: Request) -> SSHManager:
    return request.app.state.ssh


Hub = Annotated[MetricsHub, Depends(get_hub)]
SSH = Annotated[SSHManager, Depends(get_ssh)]


async def get_server_or_404(server_id: int, db: DbSession) -> Server:
    server = await db.get(Server, server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Server not found")
    return server


ServerDep = Annotated[Server, Depends(get_server_or_404)]
