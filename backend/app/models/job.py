from __future__ import annotations

import enum
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UTCDateTime


class JobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class Sweep(TimestampMixin, Base):
    """A parameter sweep; its cartesian product expands into Jobs."""

    __tablename__ = "sweeps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    template: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    parameters: Mapped[dict[str, list[Any]]] = mapped_column(JSON, default=dict)


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    server_id: Mapped[int] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), index=True)
    sweep_id: Mapped[int | None] = mapped_column(
        ForeignKey("sweeps.id", ondelete="SET NULL"), nullable=True
    )
    working_dir: Mapped[str] = mapped_column(String(1024), default="~")
    command: Mapped[str] = mapped_column(Text)
    env: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    gpus_requested: Mapped[int] = mapped_column(Integer, default=0)
    requested_gpu_indices: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    gpu_indices: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default=JobStatus.queued.value, index=True)
    # 0..1 progress, reported by the job if it writes a progress file (optional).
    progress: Mapped[float | None] = mapped_column(nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stdout_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    stderr_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
