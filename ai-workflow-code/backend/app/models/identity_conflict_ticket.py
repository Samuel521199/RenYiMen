from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class IdentityConflictTicket(Base):
    __tablename__ = "identity_conflict_tickets"

    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open")
    conflict_key: Mapped[str] = mapped_column(String(191), unique=True, nullable=False)
    conflict_reason: Mapped[str] = mapped_column(String(64), nullable=False)
    platform_user_id: Mapped[str | None] = mapped_column(String(191), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lookup_username: Mapped[str | None] = mapped_column(String(50), nullable=True)
    candidate_user_ids: Mapped[list[int]] = mapped_column(JSON, default=list, server_default="[]")
    conflict_payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    occur_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    rebind_to_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    resolver: Mapped["User | None"] = relationship(foreign_keys=[resolved_by])
    rebound_user: Mapped["User | None"] = relationship(foreign_keys=[rebind_to_user_id])
