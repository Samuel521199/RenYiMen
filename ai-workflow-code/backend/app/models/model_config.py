from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class ModelConfig(Base):
    __tablename__ = "model_configs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    api_key: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(255))
    purpose: Mapped[str] = mapped_column(String(50), default="image", server_default="image")
    usage_type: Mapped[str] = mapped_column(String(20), default="both", server_default="both")
    price_per_image: Mapped[Decimal] = mapped_column(
        Numeric(12, 6),
        default=0,
        server_default="0",
    )
    daily_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    used_today: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
    )
