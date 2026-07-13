from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserModelPermission(Base):
    __tablename__ = "user_model_permissions"
    __table_args__ = (UniqueConstraint("user_id", "model_config_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="CASCADE"),
    )
    granted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    daily_token_limit: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    daily_cost_limit: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    daily_image_limit: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    used_today_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    used_today_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    used_today_images: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    usage_reset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
