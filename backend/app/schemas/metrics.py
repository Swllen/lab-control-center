"""Metric payloads. These mirror the JSON emitted by the remote probe (see probe_script.py)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ConnectionState = Literal["connecting", "online", "offline", "error"]


class GpuStatic(BaseModel):
    index: int
    name: str
    uuid: str = ""
    memory_total: int = 0  # bytes
    power_limit_w: float | None = None


class NetInterfaceStatic(BaseModel):
    name: str
    addresses: list[str] = []
    mac: str = ""
    speed_mbps: int | None = None


class ServerStatic(BaseModel):
    hostname: str = ""
    os_name: str = ""
    kernel: str = ""
    arch: str = ""
    cpu_model: str = ""
    cpu_cores: int = 0  # physical
    cpu_threads: int = 0  # logical
    mem_total: int = 0
    gpu_driver: str | None = None
    cuda_version: str | None = None
    gpu_backend: Literal["pynvml", "nvidia-smi", "none"] = "none"
    gpus: list[GpuStatic] = []
    interfaces: list[NetInterfaceStatic] = []


class CpuMetrics(BaseModel):
    percent: float
    per_core: list[float] = []
    load: tuple[float, float, float] = (0.0, 0.0, 0.0)


class MemoryMetrics(BaseModel):
    total: int
    used: int
    available: int
    percent: float
    swap_total: int = 0
    swap_used: int = 0


class GpuMetrics(BaseModel):
    index: int
    utilization: float  # %
    memory_used: int  # bytes
    memory_total: int
    temperature_c: float | None = None
    power_w: float | None = None
    power_limit_w: float | None = None
    fan_percent: float | None = None
    processes: int | None = None


class DiskMetrics(BaseModel):
    mount: str
    device: str
    fstype: str
    total: int
    used: int
    percent: float


class NetInterfaceMetrics(BaseModel):
    name: str
    rx_bps: float  # bytes/s
    tx_bps: float
    rx_total: int
    tx_total: int


class NetMetrics(BaseModel):
    rx_bps: float
    tx_bps: float
    interfaces: list[NetInterfaceMetrics] = []


class MetricsSnapshot(BaseModel):
    ts: float = Field(description="Unix timestamp (seconds) on the control-center host")
    uptime_s: float
    cpu: CpuMetrics
    memory: MemoryMetrics
    gpus: list[GpuMetrics] = []
    disks: list[DiskMetrics] = []
    net: NetMetrics


class ServerStatus(BaseModel):
    state: ConnectionState
    error: str | None = None
    since: float  # unix ts of last state change


class ServerMetricsOut(BaseModel):
    server_id: int
    status: ServerStatus
    static: ServerStatic | None = None
    latest: MetricsSnapshot | None = None


class MetricsHistoryOut(BaseModel):
    server_id: int
    history: list[MetricsSnapshot]
