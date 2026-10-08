from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TerminalCreate(BaseModel):
    server_id: int
    name: str = Field(default="shell", min_length=1, max_length=64)
    cols: int = Field(default=120, ge=2, le=1000)
    rows: int = Field(default=32, ge=1, le=500)
    # Alternate login account (a ~/.ssh/config alias for the same machine); None = default login.
    account: str | None = Field(default=None, max_length=255)


class TerminalAccount(BaseModel):
    server_id: int
    account: str | None  # None = the server's own login
    username: str | None
    primary: bool


class TerminalRename(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class TerminalOut(BaseModel):
    id: str
    server_id: int
    server_name: str
    name: str
    account: str | None = None
    username: str | None = None
    state: Literal["starting", "running", "closed"]
    exit_status: int | None
    error: str | None
    created_at: float
    attached: int = Field(description="Number of browser connections currently attached")
