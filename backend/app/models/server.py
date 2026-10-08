from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import JSON, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UTCDateTime, utcnow


class Transport(str, enum.Enum):
    ssh = "ssh"
    demo = "demo"  # simulated server, no network access


class Server(TimestampMixin, Base):
    __tablename__ = "servers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    hostname: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer, default=22)
    username: Mapped[str] = mapped_column(String(64))
    # Path to a private key on the control-center host. Never the key contents.
    key_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # When set, connect via this ~/.ssh/config Host alias: HostName/User/Port/IdentityFile/ProxyJump
    # all come from the config file; hostname/username/port above are kept for display only.
    ssh_config_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    transport: Mapped[str] = mapped_column(String(16), default=Transport.ssh.value)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    max_jobs: Mapped[int] = mapped_column(Integer, default=4)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=utcnow, onupdate=utcnow
    )
