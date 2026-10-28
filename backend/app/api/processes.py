"""Cached read-only process snapshots. Admin-only because command lines can be private."""
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import asyncssh
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from app.api.deps import ServerDep, SSH
from app.core.deps import AdminUser
from app.services.ssh_manager import SSHTarget, SSHError, probe_command

router = APIRouter(prefix='/api/servers/{server_id}', tags=['processes'])
SOURCE = Path(__file__).parents[1].joinpath('services/process_probe.py').read_text(encoding='utf-8')


class ProcessEntry(BaseModel):
    pid: int
    ppid: int
    uid: int
    username: str
    state: str
    cpu_percent: float | None = Field(default=None, ge=0)
    memory_percent: float = Field(ge=0)
    rss_bytes: int = Field(ge=0)
    elapsed_seconds: int = Field(ge=0)
    command: str
    command_truncated: bool


class ProcessReport(BaseModel):
    server_id: int
    checked_at: datetime
    ssh_user: str
    entries: list[ProcessEntry]


_cache: dict[int, tuple[float, SSHTarget, ProcessReport]] = {}
_locks: dict[int, asyncio.Lock] = {}


@router.get('/processes', response_model=ProcessReport)
async def get_processes(server: ServerDep, ssh: SSH, _: AdminUser, response: Response) -> ProcessReport:
    response.headers['Cache-Control'] = 'no-store'
    if server.transport != 'ssh':
        raise HTTPException(400, 'Process reports require a real SSH server')
    target = SSHTarget.from_model(server)
    async with _locks.setdefault(server.id, asyncio.Lock()):
        cached = _cache.get(server.id)
        if cached and cached[1] == target and time.monotonic() - cached[0] < 5:
            return cached[2]
        try:
            conn = await ssh.get(server.id, target)
            result = await asyncio.wait_for(conn.run(probe_command(''), input=SOURCE, check=False), timeout=15)
            if result.exit_status != 0:
                raise HTTPException(502, 'Could not read processes. Remote Linux server needs python3, procps (ps), and access to /proc.')
            report = ProcessReport(server_id=server.id, checked_at=datetime.now(timezone.utc),
                                   **json.loads(str(result.stdout).strip()))
        except (SSHError, asyncssh.Error, OSError, asyncio.TimeoutError) as exc:
            raise HTTPException(502, f'Process connection failed: {exc}') from exc
        except (ValueError, TypeError) as exc:
            raise HTTPException(502, 'Invalid process report returned by server') from exc
        _cache[server.id] = (time.monotonic(), target, report)
        return report
