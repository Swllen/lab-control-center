"""Jobs, sweeps and queue status.

Commands are executed on the target server by design: this is an explicitly authorized API
(operator role), with environment variable names validated and values shell-quoted.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.api.deps import get_server_or_404
from app.config import get_settings
from app.core.deps import CurrentUser, DbSession, OperatorUser
from app.models import Job, Server, Sweep
from app.schemas.job import (
    JobCreate,
    JobOut,
    JobStatusLiteral,
    LogTail,
    ServerQueueStatus,
    SweepCreate,
    SweepJobPreview,
    SweepPreview,
)
from app.services.job_scheduler import LocalGpuScheduler, free_gpus
from app.services.metrics_collector import MetricsHub
from app.services.sftp_manager import RemoteFileError, SFTPManager
from app.services.sweeps import SweepError, expand, parse_parameters

router = APIRouter(tags=["jobs"])

_ACTIVE = ("queued", "running")
_LOG_TAIL_MAX = 256 * 1024


def _scheduler(request: Request) -> LocalGpuScheduler:
    return request.app.state.scheduler


def _out(job: Job, scheduler: LocalGpuScheduler) -> JobOut:
    out = JobOut.model_validate(job)
    if job.status == "queued":
        out.wait_reason = scheduler.wait_reason(job.id) or "Waiting for scheduler"
    return out


async def _job_or_404(db: DbSession, job_id: int) -> Job:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


async def _check_server(db: DbSession, server_id: int) -> Server:
    server = await get_server_or_404(server_id, db)
    if server.transport != "ssh":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Simulated servers cannot run jobs")
    return server


def _check_gpu_selection(request: Request, server_id: int, indices: list[int] | None) -> None:
    if indices is None:
        return
    runtime = request.app.state.hub.get(server_id)
    inventory = runtime.static.gpus if runtime and runtime.static else None
    if inventory is not None:
        invalid = set(indices) - {g.index for g in inventory}
        if invalid:
            raise HTTPException(422, f"GPU indices not found on this server: {sorted(invalid)}")


# ---------------------------------------------------------------- jobs


@router.get("/api/jobs", response_model=list[JobOut])
async def list_jobs(
    request: Request,
    _: CurrentUser,
    db: DbSession,
    server_id: int | None = None,
    sweep_id: int | None = None,
    status_: Annotated[list[JobStatusLiteral] | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
) -> list[JobOut]:
    stmt = select(Job).order_by(Job.created_at.desc(), Job.id.desc()).limit(limit)
    if server_id is not None:
        stmt = stmt.where(Job.server_id == server_id)
    if sweep_id is not None:
        stmt = stmt.where(Job.sweep_id == sweep_id)
    if status_:
        stmt = stmt.where(Job.status.in_(status_))
    scheduler = _scheduler(request)
    return [_out(j, scheduler) for j in await db.scalars(stmt)]


@router.post("/api/jobs", response_model=JobOut, status_code=status.HTTP_201_CREATED)
async def create_job(body: JobCreate, request: Request, _: OperatorUser, db: DbSession) -> JobOut:
    await _check_server(db, body.server_id)
    _check_gpu_selection(request, body.server_id, body.requested_gpu_indices)
    job = Job(
        name=body.name, server_id=body.server_id, working_dir=body.working_dir, command=body.command,
        env=body.env, gpus_requested=body.gpus, requested_gpu_indices=body.requested_gpu_indices, status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    _scheduler(request).wake()
    return _out(job, _scheduler(request))


@router.get("/api/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: int, request: Request, _: CurrentUser, db: DbSession) -> JobOut:
    return _out(await _job_or_404(db, job_id), _scheduler(request))


@router.post("/api/jobs/{job_id}/cancel", response_model=JobOut)
async def cancel_job(job_id: int, request: Request, _: OperatorUser, db: DbSession) -> JobOut:
    job = await _job_or_404(db, job_id)
    if job.status not in _ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Job is already {job.status}")
    await _scheduler(request).cancel(job_id)
    await db.refresh(job)
    return _out(job, _scheduler(request))


@router.post("/api/jobs/{job_id}/retry", response_model=JobOut)
async def retry_job(job_id: int, request: Request, _: OperatorUser, db: DbSession) -> JobOut:
    """Re-queue the same job (its logs will be overwritten on the next run)."""
    job = await _job_or_404(db, job_id)
    if job.status in _ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Job is still active")
    job.status, job.exit_code, job.error, job.pid, job.progress = "queued", None, None, None, None
    job.gpu_indices = None
    job.started_at = job.ended_at = None
    await db.commit()
    await db.refresh(job)
    _scheduler(request).wake()
    return _out(job, _scheduler(request))


@router.post("/api/jobs/{job_id}/duplicate", response_model=JobOut, status_code=status.HTTP_201_CREATED)
async def duplicate_job(job_id: int, request: Request, _: OperatorUser, db: DbSession) -> JobOut:
    src = await _job_or_404(db, job_id)
    job = Job(
        name=f"{src.name}-copy"[:128], server_id=src.server_id, working_dir=src.working_dir, command=src.command,
        env=dict(src.env), params=dict(src.params), gpus_requested=src.gpus_requested,
        requested_gpu_indices=src.requested_gpu_indices, status="queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    _scheduler(request).wake()
    return _out(job, _scheduler(request))


@router.delete("/api/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(job_id: int, _: OperatorUser, db: DbSession) -> None:
    """Remove a finished job from the history (remote logs are left in place)."""
    job = await _job_or_404(db, job_id)
    if job.status in _ACTIVE:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cancel the job first")
    await db.delete(job)
    await db.commit()


@router.get("/api/jobs/{job_id}/logs", response_model=LogTail)
async def job_logs(
    job_id: int,
    request: Request,
    _: CurrentUser,
    db: DbSession,
    stream: Annotated[str, Query(pattern="^(stdout|stderr)$")] = "stdout",
    tail_bytes: Annotated[int, Query(ge=1024, le=_LOG_TAIL_MAX)] = 64 * 1024,
) -> LogTail:
    """Last ``tail_bytes`` of a job's stdout/stderr (read with SFTP; never the whole file)."""
    job = await _job_or_404(db, job_id)
    path = job.stdout_path if stream == "stdout" else job.stderr_path
    if not path:
        return LogTail(job_id=job.id, stream=stream, path=None, size=0, offset=0, content="", truncated=False)  # type: ignore[arg-type]
    server = await get_server_or_404(job.server_id, db)
    sftp: SFTPManager = request.app.state.sftp
    try:
        size = (await sftp.stat(server, path)).size or 0
        offset = max(0, size - tail_bytes)
        client = await sftp.client(server)
        async with client.open(path, "rb") as f:
            data = await f.read(size - offset, offset)
    except RemoteFileError as exc:
        if exc.status == 404:
            return LogTail(job_id=job.id, stream=stream, path=path, size=0, offset=0, content="", truncated=False)  # type: ignore[arg-type]
        raise HTTPException(exc.status, str(exc)) from exc
    text = data.decode("utf-8", errors="replace")
    if offset and "\n" in text:
        text = text.split("\n", 1)[1]  # drop the partial first line
    return LogTail(job_id=job.id, stream=stream, path=path, size=size, offset=offset, content=text, truncated=offset > 0)  # type: ignore[arg-type]


# ---------------------------------------------------------------- sweeps


def _expand(body: SweepCreate) -> tuple[dict[str, list], list[tuple[str, str, dict]]]:
    try:
        params = parse_parameters(body.parameters_yaml, body.parameters)
        return params, expand(body.name, body.command, params, get_settings().max_sweep_jobs)
    except SweepError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.post("/api/sweeps/preview", response_model=SweepPreview)
async def preview_sweep(body: SweepCreate, _: CurrentUser) -> SweepPreview:
    params, jobs = _expand(body)
    return SweepPreview(
        count=len(jobs),
        parameters=params,
        jobs=[SweepJobPreview(name=n, command=c, params=p) for n, c, p in jobs[:50]],
    )


@router.post("/api/sweeps", response_model=list[JobOut], status_code=status.HTTP_201_CREATED)
async def create_sweep(body: SweepCreate, request: Request, _: OperatorUser, db: DbSession) -> list[JobOut]:
    await _check_server(db, body.server_id)
    _check_gpu_selection(request, body.server_id, body.requested_gpu_indices)
    params, expanded = _expand(body)
    sweep = Sweep(
        name=body.name,
        template={"command": body.command, "working_dir": body.working_dir, "env": body.env,
                  "gpus": body.gpus, "requested_gpu_indices": body.requested_gpu_indices, "server_id": body.server_id},
        parameters=params,
    )
    db.add(sweep)
    await db.flush()
    jobs = [
        Job(
            name=name, server_id=body.server_id, sweep_id=sweep.id, working_dir=body.working_dir,
            command=command, env=dict(body.env), params=point, gpus_requested=body.gpus,
            requested_gpu_indices=body.requested_gpu_indices, status="queued",
        )
        for name, command, point in expanded
    ]
    db.add_all(jobs)
    await db.commit()
    for job in jobs:
        await db.refresh(job)
    _scheduler(request).wake()
    scheduler = _scheduler(request)
    return [_out(j, scheduler) for j in jobs]


# ---------------------------------------------------------------- queue status


@router.get("/api/scheduler/status", response_model=list[ServerQueueStatus])
async def queue_status(request: Request, _: CurrentUser, db: DbSession) -> list[ServerQueueStatus]:
    hub: MetricsHub = request.app.state.hub
    settings = get_settings()
    counts = {
        (sid, st): n
        for sid, st, n in await db.execute(
            select(Job.server_id, Job.status, func.count()).where(Job.status.in_(_ACTIVE)).group_by(Job.server_id, Job.status)
        )
    }
    in_use: dict[int, set[int]] = {}
    for job in await db.scalars(select(Job).where(Job.status == "running")):
        in_use.setdefault(job.server_id, set()).update(job.gpu_indices or [])
    out = []
    for server in await db.scalars(select(Server).where(Server.transport == "ssh").order_by(Server.id)):
        runtime = hub.get(server.id)
        snap = runtime.latest if runtime and runtime.status.state == "online" else None
        used = in_use.get(server.id, set())
        out.append(ServerQueueStatus(
            server_id=server.id, max_jobs=server.max_jobs,
            running=counts.get((server.id, "running"), 0), queued=counts.get((server.id, "queued"), 0),
            gpu_count=len(snap.gpus) if snap else 0, gpus_in_use=sorted(used),
            gpus_free=free_gpus(snap, used, settings.gpu_free_max_mem_frac, settings.gpu_free_max_util),
            online=snap is not None,
        ))
    return out


