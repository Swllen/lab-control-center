"""Synthetic metrics for ``transport='demo'`` servers.

Produces the exact same message shapes as ``remote_probe.py`` so the whole pipeline
(hub -> WebSocket -> UI) is exercised without real hardware.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass
from typing import Any

GiB = 1024**3
TiB = 1024**4


@dataclass(frozen=True)
class DemoProfile:
    os_name: str
    cpu_model: str
    cores: int
    mem_total: int
    gpu_name: str
    gpu_count: int
    gpu_mem: int
    gpu_power_limit: float
    disk_total: int
    nic_speed_mbps: int
    base_load: float  # 0..1 typical utilization level


PROFILES = [
    DemoProfile(
        "Ubuntu 22.04.4 LTS", "AMD EPYC 9354 32-Core Processor", 32, 256 * GiB,
        "NVIDIA H100 80GB HBM3", 4, 80 * GiB, 700.0, 8 * TiB, 10000, 0.72,
    ),
    DemoProfile(
        "Ubuntu 22.04.4 LTS", "Intel(R) Xeon(R) Gold 6438Y+", 64, 512 * GiB,
        "NVIDIA RTX A6000", 8, 48 * GiB, 300.0, 16 * TiB, 25000, 0.45,
    ),
    DemoProfile(
        "Rocky Linux 9.3 (Blue Onyx)", "AMD EPYC 7763 64-Core Processor", 64, 1024 * GiB,
        "NVIDIA A100-SXM4-80GB", 8, 80 * GiB, 400.0, 32 * TiB, 100000, 0.3,
    ),
]


class _Walk:
    """Mean-reverting random walk clamped to [lo, hi]."""

    def __init__(self, rng: random.Random, mean: float, lo: float = 0.0, hi: float = 100.0, vol: float = 4.0):
        self.rng, self.mean, self.lo, self.hi, self.vol = rng, mean, lo, hi, vol
        self.value = mean + rng.uniform(-vol, vol)

    def step(self) -> float:
        self.value += 0.15 * (self.mean - self.value) + self.rng.gauss(0, self.vol)
        self.value = min(max(self.value, self.lo), self.hi)
        return self.value


class DemoSource:
    def __init__(self, server_id: int, name: str) -> None:
        self.profile = PROFILES[(server_id - 1) % len(PROFILES)]
        self.name = name
        self.rng = random.Random(server_id * 7919)
        p, rng = self.profile, self.rng
        self.boot_time = time.time() - rng.uniform(2, 14) * 86400
        self.cpu = _Walk(rng, p.base_load * 35, vol=3)
        self.cores = [_Walk(rng, p.base_load * 35, vol=10) for _ in range(p.cores)]
        self.mem = _Walk(rng, 35 + p.base_load * 35, vol=0.8)
        self.gpu = [_Walk(rng, p.base_load * 100 + rng.uniform(-15, 10), vol=6) for _ in range(p.gpu_count)]
        self.vram = [_Walk(rng, 30 + p.base_load * 55, vol=1.2) for _ in range(p.gpu_count)]
        self.rx = _Walk(rng, 70 * p.base_load, vol=12)
        self.tx = _Walk(rng, 75 * p.base_load, vol=12)
        self.disk_used = p.disk_total * rng.uniform(0.2, 0.3)
        self.net_rx_total = rng.randint(10, 500) * GiB
        self.net_tx_total = rng.randint(10, 500) * GiB

    def static(self) -> dict[str, Any]:
        p = self.profile
        return {
            "hostname": self.name,
            "os_name": p.os_name,
            "kernel": "5.15.0-105-generic",
            "arch": "x86_64",
            "cpu_model": p.cpu_model,
            "cpu_cores": p.cores,
            "cpu_threads": p.cores * 2,
            "mem_total": p.mem_total,
            "gpu_driver": "550.54.15",
            "cuda_version": "12.4",
            "gpu_backend": "pynvml",
            "gpus": [
                {
                    "index": i,
                    "name": p.gpu_name,
                    "uuid": f"GPU-demo-{self.name}-{i}",
                    "memory_total": p.gpu_mem,
                    "power_limit_w": p.gpu_power_limit,
                }
                for i in range(p.gpu_count)
            ],
            "interfaces": [
                {"name": "eno1", "addresses": ["10.0.0.0/24"], "mac": "3c:ec:ef:00:00:01", "speed_mbps": p.nic_speed_mbps},
                {"name": "ib0", "addresses": [], "mac": "", "speed_mbps": 200000},
            ],
        }

    def sample(self, dt: float) -> dict[str, Any]:
        p = self.profile
        mbit = 1_000_000 / 8
        # Slow sinusoid makes the sparkline look like real workload phases.
        phase = math.sin(time.time() / 45.0) * 8
        gpus = []
        for i in range(p.gpu_count):
            util = min(max(self.gpu[i].step() + phase, 0), 100)
            vram = self.vram[i].step()
            gpus.append({
                "index": i,
                "utilization": round(util, 1),
                "memory_used": int(p.gpu_mem * vram / 100),
                "memory_total": p.gpu_mem,
                "temperature_c": round(34 + util * 0.42 + self.rng.uniform(-1, 1)),
                "power_w": round(p.gpu_power_limit * (0.12 + 0.8 * util / 100), 1),
                "power_limit_w": p.gpu_power_limit,
                "fan_percent": round(30 + util * 0.5) if p.gpu_power_limit < 500 else None,
                "processes": 1 if util > 20 else 0,
            })
        rx = self.rx.step() * 10 * mbit
        tx = self.tx.step() * 10 * mbit
        self.net_rx_total += int(rx * dt)
        self.net_tx_total += int(tx * dt)
        self.disk_used = min(self.disk_used + self.rng.uniform(0, 4) * 1024**2 * dt, p.disk_total * 0.95)
        mem_pct = self.mem.step()
        mem_used = int(p.mem_total * mem_pct / 100)
        per_core = [round(c.step(), 1) for c in self.cores]
        return {
            "uptime_s": time.time() - self.boot_time,
            "cpu": {
                "percent": round(self.cpu.step(), 1),
                "per_core": per_core,
                "load": [round(p.cores * self.cpu.value / 100 * f, 2) for f in (1.0, 0.95, 0.9)],
            },
            "memory": {
                "total": p.mem_total,
                "used": mem_used,
                "available": p.mem_total - mem_used,
                "percent": round(mem_pct, 1),
                "swap_total": 8 * GiB,
                "swap_used": int(0.02 * 8 * GiB),
            },
            "gpus": gpus,
            "disks": [
                {"mount": "/", "device": "/dev/nvme0n1p2", "fstype": "ext4", "total": 1 * TiB,
                 "used": int(0.41 * TiB), "percent": 41.0},
                {"mount": "/data", "device": "/dev/md0", "fstype": "xfs", "total": p.disk_total - TiB,
                 "used": int(self.disk_used), "percent": round(100 * self.disk_used / (p.disk_total - TiB), 1)},
            ],
            "net": {
                "rx_bps": round(rx),
                "tx_bps": round(tx),
                "interfaces": [
                    {"name": "eno1", "rx_bps": round(rx), "tx_bps": round(tx),
                     "rx_total": self.net_rx_total, "tx_total": self.net_tx_total},
                    {"name": "ib0", "rx_bps": 0, "tx_bps": 0, "rx_total": 0, "tx_total": 0},
                ],
            },
        }
