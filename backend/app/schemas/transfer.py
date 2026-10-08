from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class TransferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    direction: Literal["upload", "download", "server_to_server"]
    filename: str
    is_directory: bool
    source_server_id: int | None
    source_path: str
    dest_server_id: int | None
    dest_path: str
    size_bytes: int | None
    transferred_bytes: int
    status: Literal["queued", "transferring", "completed", "failed", "canceled"]
    error: str | None
    created_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    # Live fields (only while queued/transferring)
    speed_bps: float | None = None
    eta_s: float | None = None
