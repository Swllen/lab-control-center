from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

_HOST_RE = re.compile(r"^[A-Za-z0-9.\-:\[\]]+$")
_USER_RE = re.compile(r"^[a-z_][a-z0-9_.\-]*\$?$", re.IGNORECASE)


def _validate_host(v: str) -> str:
    v = v.strip()
    if not _HOST_RE.match(v):
        raise ValueError("Invalid hostname or IP address")
    return v


def _validate_user(v: str) -> str:
    v = v.strip()
    if not _USER_RE.match(v):
        raise ValueError("Invalid username")
    return v


def _validate_key(v: str | None) -> str | None:
    v = (v or "").strip()
    return v or None


class ServerConnectionFields(BaseModel):
    hostname: str = Field(min_length=1, max_length=255)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=64)
    key_path: str | None = Field(default=None, max_length=512)
    transport: Literal["ssh", "demo"] = "ssh"
    # ~/.ssh/config Host alias; when set it overrides hostname/port/username/key_path.
    ssh_config_host: str | None = Field(default=None, max_length=255, pattern=r"^[A-Za-z0-9._\-@]+$")

    _host = field_validator("hostname")(lambda v: _validate_host(v))
    _user = field_validator("username")(lambda v: _validate_user(v))
    _key = field_validator("key_path")(lambda v: _validate_key(v))


class ServerCreate(ServerConnectionFields):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._\-]*$")
    tags: list[str] = Field(default_factory=list, max_length=16)
    description: str = Field(default="", max_length=500)
    max_jobs: int = Field(default=4, ge=1, le=64)


class ServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9._\-]*$")
    hostname: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = None
    key_path: str | None = None
    tags: list[str] | None = None
    description: str | None = Field(default=None, max_length=500)
    max_jobs: int | None = Field(default=None, ge=1, le=64)

    # key_path: "" clears the key (fall back to SSH agent); None leaves it unchanged.
    _host = field_validator("hostname")(lambda v: None if v is None else _validate_host(v))
    _user = field_validator("username")(lambda v: None if v is None else _validate_user(v))


class ServerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    hostname: str
    port: int
    username: str
    key_path: str | None
    ssh_config_host: str | None
    transport: Literal["ssh", "demo"]
    tags: list[str]
    description: str
    max_jobs: int
    created_at: datetime
    updated_at: datetime


class ConnectionTestResult(BaseModel):
    ok: bool
    latency_ms: float | None = None
    error: str | None = None
    hostname: str | None = None
    os_name: str | None = None
    kernel: str | None = None
    python: str | None = None
    has_nvidia_smi: bool = False
    has_pynvml: bool = False
    gpu_count: int = 0


class SSHConfigHostOut(BaseModel):
    alias: str
    hostname: str
    user: str | None
    port: int
    identity_file: str | None
    proxy_jump: str | None
    imported_as: int | None = Field(description="Server id if this alias is already configured")


class SSHConfigImport(BaseModel):
    aliases: list[str] = Field(min_length=1, max_length=64)


class PowerAction(BaseModel):
    action: Literal["reboot", "poweroff"]
    confirm: str = Field(description="Must equal the server name")
