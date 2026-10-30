from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

JobStatusLiteral = Literal["queued", "running", "completed", "failed", "canceled"]

_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _check_env(env: dict[str, str]) -> dict[str, str]:
    for key, value in env.items():
        if not _ENV_KEY.match(key):
            raise ValueError(f"Invalid environment variable name: {key!r}")
        if key == "CUDA_VISIBLE_DEVICES":
            raise ValueError("CUDA_VISIBLE_DEVICES is assigned by the scheduler; use 'gpus' instead")
        if "\x00" in value:
            raise ValueError(f"Invalid value for {key}")
    return env


class JobSpec(BaseModel):
    server_id: int
    working_dir: str = Field(default="~", min_length=1, max_length=1024)
    command: str = Field(min_length=1, max_length=20_000)
    env: dict[str, str] = Field(default_factory=dict)
    gpus: int = Field(default=0, ge=0, le=16, description="Number of GPUs; assigned via CUDA_VISIBLE_DEVICES")
    requested_gpu_indices: list[Annotated[int, Field(ge=0, strict=True)]] | None = Field(default=None, max_length=16)

    @model_validator(mode="after")
    def _gpu_selection(self):
        if self.requested_gpu_indices is not None:
            if not self.requested_gpu_indices or len(set(self.requested_gpu_indices)) != len(self.requested_gpu_indices):
                raise ValueError("Select at least one GPU, without duplicate indices")
            if len(self.requested_gpu_indices) != self.gpus:
                raise ValueError("GPU count must match the number of selected GPUs")
        return self

    _env = field_validator("env")(lambda v: _check_env(v))

    @field_validator("working_dir")
    @classmethod
    def _wd(cls, v: str) -> str:
        if "\x00" in v or "\n" in v:
            raise ValueError("Invalid working directory")
        return v.strip()


class JobCreate(JobSpec):
    name: str = Field(min_length=1, max_length=128)


class SweepCreate(JobSpec):
    name: str = Field(min_length=1, max_length=96)
    # Either a YAML document (``parameters: {lr: [..], bs: [..]}`` or just the mapping) or a dict.
    parameters_yaml: str | None = Field(default=None, max_length=50_000)
    parameters: dict[str, list[Any]] | None = None


class SweepJobPreview(BaseModel):
    name: str
    command: str
    params: dict[str, Any]


class SweepPreview(BaseModel):
    count: int
    jobs: list[SweepJobPreview]  # first N only
    parameters: dict[str, list[Any]]


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    server_id: int
    sweep_id: int | None
    working_dir: str
    command: str
    env: dict[str, str]
    params: dict[str, Any]
    gpus_requested: int
    requested_gpu_indices: list[int] | None = None
    gpu_indices: list[int] | None
    status: JobStatusLiteral
    progress: float | None
    exit_code: int | None
    error: str | None = None
    pid: int | None = None
    stdout_path: str | None
    stderr_path: str | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    wait_reason: str | None = Field(default=None, description="Why a queued job has not started yet")


class LogTail(BaseModel):
    job_id: int
    stream: Literal["stdout", "stderr"]
    path: str | None
    size: int
    offset: int
    content: str
    truncated: bool


class ServerQueueStatus(BaseModel):
    supports_gpu_selection: bool = True
    server_id: int
    max_jobs: int
    running: int
    queued: int
    gpu_count: int
    gpus_in_use: list[int]  # assigned to control-center jobs
    gpus_free: list[int]  # idle by live metrics and unassigned
    online: bool
