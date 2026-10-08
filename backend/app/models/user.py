from __future__ import annotations

import enum

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Role(str, enum.Enum):
    admin = "admin"
    operator = "operator"
    viewer = "viewer"


ROLE_RANK = {Role.viewer: 0, Role.operator: 1, Role.admin: 2}


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(128), default="")
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(16), default=Role.admin.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    def has_role(self, minimum: Role) -> bool:
        return ROLE_RANK[Role(self.role)] >= ROLE_RANK[minimum]
