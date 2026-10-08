"""SSH connection pool.

One ``asyncssh`` connection per server is cached and shared by every feature (metrics probe,
terminals, SFTP, jobs). Each feature opens its own *channel* on that connection.
Private keys are referenced by path on this host and never leave the backend.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time
from dataclasses import dataclass
from pathlib import Path

import asyncssh

from app.config import get_settings
from app.core.paths import PathError, resolve_key_path
from app.schemas.server import ConnectionTestResult

log = logging.getLogger(__name__)

SSH_CONFIG_PATH = Path("~/.ssh/config").expanduser()

PROBE_SOURCE = (Path(__file__).with_name("remote_probe.py")).read_text(encoding="utf-8")


@dataclass(frozen=True, slots=True)
class SSHTarget:
    hostname: str
    port: int
    username: str
    key_path: str | None
    config_host: str | None = None

    @classmethod
    def from_model(cls, server: object) -> SSHTarget:
        return cls(
            hostname=server.hostname,  # type: ignore[attr-defined]
            port=server.port,  # type: ignore[attr-defined]
            username=server.username,  # type: ignore[attr-defined]
            key_path=server.key_path,  # type: ignore[attr-defined]
            config_host=getattr(server, "ssh_config_host", None),
        )

    @property
    def label(self) -> str:
        return self.config_host or f"{self.hostname}:{self.port}"


class SSHError(Exception):
    """Connection failure with a user-presentable message."""

    def __init__(self, message: str, *, unreachable: bool = False) -> None:
        super().__init__(message)
        self.unreachable = unreachable


def _known_hosts_option() -> str | None:
    setting = get_settings().ssh_known_hosts
    if setting == "ignore":
        return None
    if setting == "auto":
        default = Path("~/.ssh/known_hosts").expanduser()
        if default.exists():
            return str(default)
        log.warning("~/.ssh/known_hosts not found: host keys will NOT be verified")
        return None
    return str(Path(setting).expanduser())


def probe_command(arg: str) -> str:
    """Run the probe with python3 (or python) reading the script from stdin, in a POSIX shell."""
    inner = f'PY=$(command -v python3 || command -v python) || exit 127; exec "$PY" -u - {shlex.quote(arg)}'
    return f"sh -c {shlex.quote(inner)}"


async def open_connection(target: SSHTarget) -> asyncssh.SSHClientConnection:
    settings = get_settings()
    options: dict[str, object] = {
        "known_hosts": _known_hosts_option(),
        "keepalive_interval": settings.ssh_keepalive_interval_s,
        "keepalive_count_max": 3,
        "connect_timeout": settings.ssh_connect_timeout_s,
    }
    if target.config_host:
        # asyncssh resolves the alias from ~/.ssh/config (HostName, User, Port, IdentityFile, ProxyJump).
        options["host"] = target.config_host
        options["config"] = [str(SSH_CONFIG_PATH)]
    else:
        options.update(host=target.hostname, port=target.port, username=target.username)
    if target.key_path and not target.config_host:
        try:
            options["client_keys"] = [str(resolve_key_path(target.key_path))]
        except PathError as exc:
            raise SSHError(str(exc)) from exc
    try:
        return await asyncssh.connect(**options)  # type: ignore[arg-type]
    except asyncssh.PermissionDenied as exc:
        raise SSHError("Authentication failed (check username and key)") from exc
    except asyncssh.HostKeyNotVerifiable as exc:
        raise SSHError(
            "Host key not trusted. Connect once with `ssh` from this machine to add it to known_hosts."
        ) from exc
    except asyncssh.KeyImportError as exc:
        raise SSHError(f"Cannot load private key: {exc} (passphrase keys: use ssh-agent)") from exc
    except (OSError, TimeoutError, asyncssh.ConnectionLost) as exc:
        raise SSHError(
            f"Cannot reach {target.label} ({exc.__class__.__name__}: {exc})",
            unreachable=True,
        ) from exc
    except asyncssh.Error as exc:
        raise SSHError(f"SSH error: {exc.reason}") from exc


class SSHManager:
    def __init__(self) -> None:
        # Keyed by server id, or "<id>@<alias>" for alternate login accounts on the same server.
        self._conns: dict[int | str, tuple[SSHTarget, asyncssh.SSHClientConnection]] = {}
        self._locks: dict[int | str, asyncio.Lock] = {}

    async def get(self, server_id: int | str, target: SSHTarget) -> asyncssh.SSHClientConnection:
        lock = self._locks.setdefault(server_id, asyncio.Lock())
        async with lock:
            cached = self._conns.get(server_id)
            if cached:
                cached_target, conn = cached
                if cached_target == target and not conn.is_closed():
                    return conn
                conn.close()
            conn = await open_connection(target)
            self._conns[server_id] = (target, conn)
            return conn

    async def invalidate(self, server_id: int | str) -> None:
        cached = self._conns.pop(server_id, None)
        if cached:
            cached[1].close()

    async def close_all(self) -> None:
        conns = [conn for _, conn in self._conns.values()]
        self._conns.clear()
        for conn in conns:
            conn.close()
        await asyncio.gather(*(c.wait_closed() for c in conns), return_exceptions=True)

    @staticmethod
    async def test(target: SSHTarget) -> ConnectionTestResult:
        """Open a fresh connection, run the probe once, and report capabilities."""
        started = time.perf_counter()
        try:
            conn = await open_connection(target)
        except SSHError as exc:
            return ConnectionTestResult(ok=False, error=str(exc))
        latency = (time.perf_counter() - started) * 1000
        try:
            async with conn:
                result = await asyncio.wait_for(
                    conn.run(probe_command("--test"), input=PROBE_SOURCE, check=False), timeout=20
                )
        except (asyncssh.Error, OSError, TimeoutError) as exc:
            return ConnectionTestResult(ok=False, latency_ms=latency, error=f"Probe failed: {exc}")

        if result.exit_status == 127:
            return ConnectionTestResult(
                ok=False, latency_ms=latency, error="Connected, but python3 is not installed on the server"
            )
        try:
            info = json.loads(str(result.stdout).strip().splitlines()[-1])
        except (ValueError, IndexError):
            stderr = str(result.stderr or "").strip()[-300:]
            return ConnectionTestResult(ok=False, latency_ms=latency, error=f"Probe failed: {stderr or 'no output'}")
        return ConnectionTestResult(
            ok=True,
            latency_ms=round(latency, 1),
            hostname=info.get("hostname"),
            os_name=info.get("os_name"),
            kernel=info.get("kernel"),
            python=info.get("python"),
            has_nvidia_smi=bool(info.get("has_nvidia_smi")),
            has_pynvml=bool(info.get("has_pynvml")),
            gpu_count=len(info.get("gpus") or []),
        )
