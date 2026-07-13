from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BackgroundGenerationBatch(Base):
    __tablename__ = "background_generation_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    purpose: Mapped[str] = mapped_column(String(100), nullable=False)
    scene: Mapped[str] = mapped_column(String(100), nullable=False)
    mood: Mapped[list[str]] = mapped_column(ARRAY(String(100)), default=list)
    color_style: Mapped[str] = mapped_column(String(100), nullable=False)
    whitespace_position_legacy: Mapped[str] = mapped_column(
        "whitespace_position",
        String(50),
        nullable=False,
        default="right",
        server_default="right",
    )
    whitespace_positions: Mapped[list[str]] = mapped_column(ARRAY(String(50)), default=list)
    size_ratio: Mapped[str] = mapped_column(String(20), nullable=False)
    localized: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    game_feel: Mapped[str] = mapped_column(String(20), default="medium", server_default="medium")
    count: Mapped[int] = mapped_column(Integer, default=4, server_default="4")
    extra_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="SET NULL"),
        nullable=True,
    )

    images: Mapped[list["BackgroundImage"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by=lambda: BackgroundImage.id.asc(),
    )


class BackgroundImage(Base):
    __tablename__ = "background_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("background_generation_batches.id", ondelete="CASCADE")
    )
    asset_id: Mapped[int | None] = mapped_column(
        ForeignKey("assets.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_status: Mapped[str] = mapped_column(
        String(20),
        default="pending",
        server_default="pending",
    )
    is_recommended: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tags: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    batch: Mapped["BackgroundGenerationBatch"] = relationship(back_populates="images")
