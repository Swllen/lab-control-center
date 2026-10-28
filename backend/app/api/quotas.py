"""On-demand user quota reports. No changes to quotas or remote filesystem."""
import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import asyncssh
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import ServerDep, SSH
from app.core.deps import AdminUser
from app.services.ssh_manager import SSHTarget, SSHError, probe_command

router = APIRouter(prefix='/api/servers/{server_id}', tags=['quotas'])
SOURCE = Path(__file__).parents[1].joinpath('services/quota_probe.py').read_text(encoding='utf-8')


class QuotaEntry(BaseModel):
    uid: int
    username: str
    filesystem: str
    used_bytes: int = Field(ge=0)
    soft_bytes: int = Field(ge=0)
    hard_bytes: int = Field(ge=0)
    grace_expires: int | None = None
    files_used: int = Field(ge=0)
    files_soft: int = Field(ge=0)
    files_hard: int = Field(ge=0)
    files_grace_expires: int | None = None


class QuotaReport(BaseModel):
    server_id: int
    checked_at: datetime
    state: str
    entries: list[QuotaEntry]
    message: str | None = None
    setup_command: str | None = None


_cache: dict[int, tuple[float, SSHTarget, QuotaReport]] = {}
_locks: dict[int, asyncio.Lock] = {}


@router.get('/quotas', response_model=QuotaReport)
async def get_quotas(server: ServerDep, ssh: SSH, _: AdminUser) -> QuotaReport:
    if server.transport != 'ssh':
        return QuotaReport(server_id=server.id, checked_at=datetime.now(timezone.utc),
                           state='unavailable', entries=[], message='Quota reports require a real SSH server.')
    target = SSHTarget.from_model(server)
    async with _locks.setdefault(server.id, asyncio.Lock()):
        cached = _cache.get(server.id)
        if cached and cached[1] == target and time.monotonic() - cached[0] < 30:
            return cached[2]
        try:
            conn = await ssh.get(server.id, target)
            result = await asyncio.wait_for(conn.run(probe_command(''), input=SOURCE, check=False), timeout=30)
            if result.exit_status != 0:
                raise HTTPException(502, 'Could not run the quota probe. The remote server needs python3.')
            data = json.loads(str(result.stdout).strip())
            report = QuotaReport(server_id=server.id, checked_at=datetime.now(timezone.utc), **data)
        except (SSHError, asyncssh.Error, OSError, asyncio.TimeoutError) as exc:
            raise HTTPException(502, f'Quota connection failed: {exc}') from exc
        except (ValueError, TypeError) as exc:
            raise HTTPException(502, 'Invalid quota report returned by server') from exc
        _cache[server.id] = (time.monotonic(), target, report)
        return report
