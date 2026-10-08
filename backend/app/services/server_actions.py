"""Dangerous host-level actions (reboot / power-off). Callers must have verified confirmation."""

from __future__ import annotations

import asyncio
from typing import Literal

import asyncssh

from app.models import Server
from app.services.metrics_collector import MetricsHub
from app.services.ssh_manager import SSHManager, SSHTarget

PowerActionName = Literal["reboot", "poweroff"]

# Fixed commands only - nothing from the request is interpolated into the shell.
_COMMANDS: dict[PowerActionName, str] = {
    "reboot": "sudo -n systemctl reboot",
    "poweroff": "sudo -n systemctl poweroff",
}


class PowerActionError(Exception):
    pass


async def run_power_action(
    server: Server, action: PowerActionName, ssh: SSHManager, hub: MetricsHub
) -> None:
    if server.transport == "demo":
        hub.simulate_downtime(server.id, 12 if action == "reboot" else 10**9)
        return
    conn = await ssh.get(server.id, SSHTarget.from_model(server))
    try:
        result = await asyncio.wait_for(conn.run(_COMMANDS[action], check=False), timeout=15)
    except (asyncssh.ConnectionLost, asyncssh.DisconnectError, TimeoutError):
        return  # the host went down, which is the expected outcome
    if result.exit_status not in (0, None):
        stderr = str(result.stderr or "").strip()
        if "password is required" in stderr or "a terminal is required" in stderr:
            raise PowerActionError(
                f"Passwordless sudo for `systemctl {action}` is required for user '{server.username}'"
            )
        raise PowerActionError(stderr or f"Command failed with exit status {result.exit_status}")
