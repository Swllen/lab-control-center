from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# tmux rejects ':' and '.' in session names; control characters would garble the listing.
TMUX_NAME_PATTERN = r"^[^:.\x00-\x1f\x7f]+$"


class TerminalCreate(BaseModel):
    server_id: int
    name: str = Field(default="shell", min_length=1, max_length=64)
    cols: int = Field(default=120, ge=2, le=1000)
    rows: int = Field(default=32, ge=1, le=500)
    # Alternate login account (a ~/.ssh/config alias for the same machine); None = default login.
    account: str | None = Field(default=None, max_length=255)
    # Run the shell inside tmux (``lcc-<id>``) so it survives control-center restarts.
    tmux: bool = False
    # Attach to (or create) this tmux session instead of a new ``lcc-<id>`` one; implies tmux.
    tmux_session: str | None = Field(default=None, min_length=1, max_length=128, pattern=TMUX_NAME_PATTERN)


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
    tmux: str | None = Field(default=None, description="tmux session name, or null for a plain shell")
    state: Literal["starting", "running", "closed"]
    exit_status: int | None
    error: str | None
    created_at: float
    attached: int = Field(description="Number of browser connections currently attached")


class TmuxSession(BaseModel):
    name: str
    created: float
    attached: int = Field(description="tmux clients attached (any terminal, not just the control center)")
    windows: int
    managed: bool = Field(description="Created by the control center (lcc-* prefix)")
    terminal_ids: list[str] = Field(default_factory=list, description="Your open control-center terminals attached to it")


class TmuxSessionList(BaseModel):
    server_id: int
    account: str | None
    available: bool = Field(description="False when tmux is not installed for this login")
    sessions: list[TmuxSession]
