"""Read Host entries from the control-center host's ``~/.ssh/config``.

Used only to *list* importable hosts; actual connections are resolved by asyncssh itself,
which implements the full OpenSSH config semantics (Match, Include, ProxyJump, ...).
"""

from __future__ import annotations

import shlex
from dataclasses import dataclass, field
from pathlib import Path

from app.services.ssh_manager import SSH_CONFIG_PATH


@dataclass
class SSHConfigHost:
    alias: str
    hostname: str
    user: str | None = None
    port: int = 22
    identity_file: str | None = None
    proxy_jump: str | None = None
    extra: dict[str, str] = field(default_factory=dict)


def _is_pattern(alias: str) -> bool:
    return any(ch in alias for ch in "*?!")


def alternate_accounts(server: object) -> list[SSHConfigHost]:
    """Other ~/.ssh/config aliases that log into the same machine (same HostName and port)
    as ``server`` under a different account, e.g. ``server-admin`` for ``server``."""
    hostname = getattr(server, "hostname", None)
    port = getattr(server, "port", 22)
    own_alias = getattr(server, "ssh_config_host", None)
    own_user = getattr(server, "username", None)
    return [
        h for h in read_ssh_config()
        if h.hostname == hostname and h.port == port and h.alias != own_alias
        and not (own_alias is None and h.user == own_user)
    ]


def read_ssh_config(path: Path = SSH_CONFIG_PATH) -> list[SSHConfigHost]:
    if not path.is_file():
        return []
    hosts: list[SSHConfigHost] = []
    defaults: dict[str, str] = {}  # values from "Host *" apply to every alias (first value wins)
    current: list[SSHConfigHost] = []
    current_is_wildcard = False

    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.replace("=", " ", 1).partition(" ")
        key, value = key.lower(), value.strip()
        if key == "match":
            current, current_is_wildcard = [], False
            continue
        if key == "host":
            try:
                aliases = shlex.split(value)
            except ValueError:
                aliases = value.split()
            current_is_wildcard = aliases == ["*"]
            current = [SSHConfigHost(alias=a, hostname=a) for a in aliases if not _is_pattern(a)]
            hosts.extend(current)
            continue
        if current_is_wildcard:
            defaults.setdefault(key, value)
            continue
        for host in current:
            if key == "hostname" and host.hostname == host.alias:
                host.hostname = value
            elif key == "user" and host.user is None:
                host.user = value
            elif key == "port" and value.isdigit():
                host.port = int(value)
            elif key == "identityfile" and host.identity_file is None:
                host.identity_file = value
            elif key == "proxyjump" and host.proxy_jump is None:
                host.proxy_jump = value
            else:
                host.extra.setdefault(key, value)

    for host in hosts:
        host.user = host.user or defaults.get("user")
        host.identity_file = host.identity_file or defaults.get("identityfile")
        host.proxy_jump = host.proxy_jump or defaults.get("proxyjump")
    return hosts
