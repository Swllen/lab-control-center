"""MetricsHub: one collector task per server, a history ring buffer, and WebSocket fan-out.

Collection happens exactly once per server regardless of how many browsers are watching.
Each subscriber gets a small bounded queue of pre-serialized JSON frames; slow consumers
drop their oldest frames instead of applying backpressure to the collector.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

import asyncssh
from pydantic import ValidationError

from app.config import get_settings
from app.schemas.metrics import (
    ConnectionState,
    MetricsSnapshot,
    ServerMetricsOut,
    ServerStatic,
    ServerStatus,
)
from app.services.demo_source import DemoSource
from app.services.ssh_manager import PROBE_SOURCE, SSHError, SSHManager, SSHTarget, probe_command

log = logging.getLogger(__name__)

_SUBSCRIBER_QUEUE = 32
_MAX_BACKOFF_S = 30.0


@dataclass(frozen=True, slots=True)
class CollectorConfig:
    server_id: int
    name: str
    transport: str
    target: SSHTarget

    @classmethod
    def from_model(cls, server: Any) -> CollectorConfig:
        return cls(server.id, server.name, server.transport, SSHTarget.from_model(server))


@dataclass
class ServerRuntime:
    config: CollectorConfig
    history: deque[MetricsSnapshot]
    status: ServerStatus = field(
        default_factory=lambda: ServerStatus(state="connecting", since=time.time())
    )
    static: ServerStatic | None = None
    latest: MetricsSnapshot | None = None
    subscribers: set[asyncio.Queue[str]] = field(default_factory=set)
    task: asyncio.Task[None] | None = None
    # Demo servers: simulated downtime (reboot) until this timestamp.
    offline_until: float = 0.0

    def to_out(self) -> ServerMetricsOut:
        return ServerMetricsOut(
            server_id=self.config.server_id, status=self.status, static=self.static, latest=self.latest
        )


class ProbeExited(Exception):
    pass


class MetricsHub:
    def __init__(self, ssh: SSHManager) -> None:
        self._ssh = ssh
        self._runtimes: dict[int, ServerRuntime] = {}
        settings = get_settings()
        self._interval = settings.metrics_interval_s
        self._history_len = settings.metrics_history_len

    # ------------------------------------------------------------------ lifecycle

    def upsert(self, server: Any) -> None:
        """Start (or restart, if the connection config changed) the collector for a server."""
        config = CollectorConfig.from_model(server)
        runtime = self._runtimes.get(config.server_id)
        if runtime and runtime.config == config and runtime.task and not runtime.task.done():
            return
        if runtime is None:
            runtime = ServerRuntime(config=config, history=deque(maxlen=self._history_len))
            self._runtimes[config.server_id] = runtime
        else:
            if runtime.task:
                runtime.task.cancel()
            runtime.config = config
            runtime.static, runtime.latest = None, None
            runtime.history.clear()
        runtime.task = asyncio.create_task(self._run(runtime), name=f"metrics-{config.server_id}")

    async def remove(self, server_id: int) -> None:
        runtime = self._runtimes.pop(server_id, None)
        if runtime and runtime.task:
            runtime.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await runtime.task
        await self._ssh.invalidate(server_id)

    async def stop(self) -> None:
        for server_id in list(self._runtimes):
            await self.remove(server_id)

    # ------------------------------------------------------------------ queries

    def get(self, server_id: int) -> ServerRuntime | None:
        return self._runtimes.get(server_id)

    def all(self) -> list[ServerRuntime]:
        return list(self._runtimes.values())

    def simulate_downtime(self, server_id: int, seconds: float) -> None:
        runtime = self._runtimes.get(server_id)
        if runtime:
            runtime.offline_until = time.time() + seconds

    # ------------------------------------------------------------------ pub/sub

    def subscribe(self, server_id: int) -> asyncio.Queue[str]:
        runtime = self._runtimes[server_id]
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE)
        runtime.subscribers.add(queue)
        return queue

    def unsubscribe(self, server_id: int, queue: asyncio.Queue[str]) -> None:
        runtime = self._runtimes.get(server_id)
        if runtime:
            runtime.subscribers.discard(queue)

    def hello_frame(self, runtime: ServerRuntime) -> str:
        return json.dumps({
            "type": "hello",
            "server_id": runtime.config.server_id,
            "status": runtime.status.model_dump(mode="json"),
            "static": runtime.static.model_dump(mode="json") if runtime.static else None,
            "history": [s.model_dump(mode="json") for s in runtime.history],
        })

    @staticmethod
    def _broadcast(runtime: ServerRuntime, frame: dict[str, Any]) -> None:
        if not runtime.subscribers:
            return
        payload = json.dumps(frame)
        for queue in runtime.subscribers:
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(payload)

    def _set_status(self, runtime: ServerRuntime, state: ConnectionState, error: str | None = None) -> None:
        if runtime.status.state == state and runtime.status.error == error:
            return
        runtime.status = ServerStatus(state=state, error=error, since=time.time())
        self._broadcast(runtime, {"type": "status", "status": runtime.status.model_dump(mode="json")})

    def _on_static(self, runtime: ServerRuntime, data: dict[str, Any]) -> None:
        runtime.static = ServerStatic.model_validate(data)
        self._broadcast(runtime, {"type": "static", "static": runtime.static.model_dump(mode="json")})

    def _on_sample(self, runtime: ServerRuntime, data: dict[str, Any]) -> None:
        snapshot = MetricsSnapshot.model_validate({**data, "ts": time.time()})
        runtime.latest = snapshot
        runtime.history.append(snapshot)
        self._set_status(runtime, "online")
        self._broadcast(runtime, {"type": "snapshot", "snapshot": snapshot.model_dump(mode="json")})

    # ------------------------------------------------------------------ collectors

    async def _run(self, runtime: ServerRuntime) -> None:
        if runtime.config.transport == "demo":
            await self._run_demo(runtime)
        else:
            await self._run_ssh(runtime)

    async def _run_demo(self, runtime: ServerRuntime) -> None:
        source = DemoSource(runtime.config.server_id, runtime.config.name)
        await asyncio.sleep(0.3)
        self._on_static(runtime, source.static())
        while True:
            if time.time() < runtime.offline_until:
                self._set_status(runtime, "offline", "Rebooting (simulated)")
                source.boot_time = runtime.offline_until
            else:
                self._on_sample(runtime, source.sample(self._interval))
            await asyncio.sleep(self._interval)

    async def _run_ssh(self, runtime: ServerRuntime) -> None:
        cfg = runtime.config
        backoff = 2.0
        while True:
            if runtime.status.state != "online":
                self._set_status(runtime, "connecting", runtime.status.error)
            try:
                conn = await self._ssh.get(cfg.server_id, cfg.target)
                async with conn.create_process(probe_command(str(self._interval))) as proc:
                    proc.stdin.write(PROBE_SOURCE)
                    proc.stdin.write_eof()
                    async for line in proc.stdout:
                        self._handle_line(runtime, line)
                        backoff = 2.0
                    stderr = (await proc.stderr.read())[-400:]
                    if proc.exit_status == 127:
                        raise ProbeExited("python3 not found on server")
                    raise ProbeExited(stderr.strip() or f"probe exited ({proc.exit_status})")
            except asyncio.CancelledError:
                raise
            except SSHError as exc:
                self._set_status(runtime, "offline" if exc.unreachable else "error", str(exc))
            except ProbeExited as exc:
                self._set_status(runtime, "error", f"Metrics probe stopped: {exc}")
            except (asyncssh.Error, OSError) as exc:
                self._set_status(runtime, "offline", f"Connection lost: {exc}")
                await self._ssh.invalidate(cfg.server_id)
            except Exception as exc:  # noqa: BLE001 - keep collector alive no matter what
                log.exception("collector %s crashed", cfg.name)
                self._set_status(runtime, "error", f"Internal error: {exc}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, _MAX_BACKOFF_S)

    def _handle_line(self, runtime: ServerRuntime, line: str) -> None:
        try:
            msg = json.loads(line)
            kind = msg.pop("type", None)
            if kind == "static":
                self._on_static(runtime, msg)
            elif kind == "sample":
                self._on_sample(runtime, msg)
        except (ValueError, ValidationError) as exc:
            log.warning("bad probe line from %s: %s", runtime.config.name, exc)
