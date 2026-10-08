"""FastAPI application factory.

Run (from backend/):  uv run uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import assistant, auth, files, jobs, metrics, servers, terminals, transfers
from app.config import get_settings
from app.db.init_db import create_schema, ensure_admin, seed_demo
from app.db.session import SessionLocal, engine
from app.models import Server
from app.services.job_scheduler import LocalGpuScheduler
from app.services.metrics_collector import MetricsHub
from app.services.ssh_manager import SSHManager
from app.services.sftp_manager import SFTPManager
from app.services.terminal_manager import TerminalManager
from app.services.transfer_manager import TransferManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await create_schema()
    await ensure_admin()
    await seed_demo()

    ssh = SSHManager()
    hub = MetricsHub(ssh)
    terminals_mgr = TerminalManager(ssh)
    sftp = SFTPManager(ssh)
    transfers_mgr = TransferManager(sftp)
    app.state.ssh, app.state.hub, app.state.terminals = ssh, hub, terminals_mgr
    scheduler = LocalGpuScheduler(sftp, hub)
    app.state.sftp, app.state.transfers, app.state.scheduler = sftp, transfers_mgr, scheduler
    terminals_mgr.start()
    transfers_mgr.start()
    async with SessionLocal() as db:
        for server in await db.scalars(select(Server)):
            hub.upsert(server)
    await scheduler.start()
    try:
        yield
    finally:
        await scheduler.stop()
        await transfers_mgr.stop()
        await terminals_mgr.stop()
        await hub.stop()
        await ssh.close_all()
        await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Lab Server Control Center", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    @app.middleware("http")
    async def reject_cross_origin_writes(request: Request, call_next):  # type: ignore[no-untyped-def]
        # CSRF hardening: state-changing requests must come from an allowed origin.
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin and origin not in settings.allowed_origins:
            return JSONResponse({"detail": "Cross-origin request rejected"}, status_code=403)
        return await call_next(request)

    for module in (auth, servers, metrics, terminals, files, jobs, transfers, assistant):
        app.include_router(module.router)

    @app.get("/api/health", tags=["meta"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
