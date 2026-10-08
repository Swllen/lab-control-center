from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UTCDateTime


class TransferDirection(str, enum.Enum):
    upload = "upload"  # local -> server
    download = "download"  # server -> local
    server_to_server = "server_to_server"


class TransferStatus(str, enum.Enum):
    queued = "queued"
    transferring = "transferring"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class Transfer(TimestampMixin, Base):
    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(primary_key=True)
    direction: Mapped[str] = mapped_column(String(24))
    filename: Mapped[str] = mapped_column(String(512))
    is_directory: Mapped[bool] = mapped_column(default=False)
    source_server_id: Mapped[int | None] = mapped_column(
        ForeignKey("servers.id", ondelete="SET NULL"), nullable=True
    )
    source_path: Mapped[str] = mapped_column(String(2048), default="")
    dest_server_id: Mapped[int | None] = mapped_column(
        ForeignKey("servers.id", ondelete="SET NULL"), nullable=True
    )
    dest_path: Mapped[str] = mapped_column(String(2048), default="")
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    transferred_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    status: Mapped[str] = mapped_column(String(16), default=TransferStatus.queued.value, index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime(), nullable=True)
