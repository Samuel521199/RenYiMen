from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.image import FinalImage, TaskImage
    from app.models.user import User


class PublishStat(Base):
    __tablename__ = "publish_stats"

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int | None] = mapped_column(ForeignKey("task_images.id", ondelete="SET NULL"))
    final_image_id: Mapped[int | None] = mapped_column(
        ForeignKey("final_images.id", ondelete="SET NULL")
    )
    publish_date: Mapped[date] = mapped_column(Date, nullable=False)
    channel: Mapped[str | None] = mapped_column(String(50))
    likes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    comments: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    shares: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    image: Mapped["TaskImage | None"] = relationship(back_populates="publish_stats")
    final_image: Mapped["FinalImage | None"] = relationship(back_populates="publish_stats")


class DailyCostStat(Base):
    __tablename__ = "daily_cost_stats"
    __table_args__ = (
        UniqueConstraint("stat_date", "user_id", "model_provider", name="uq_daily_cost_stats"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stat_date: Mapped[date] = mapped_column(Date, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    model_provider: Mapped[str | None] = mapped_column(String(50))
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    image_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    user: Mapped["User | None"] = relationship(back_populates="publish_cost_stats")
