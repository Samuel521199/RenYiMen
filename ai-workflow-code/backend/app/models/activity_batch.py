from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ActivityGenerationBatch(Base):
    __tablename__ = "activity_generation_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("activity_templates.id"))
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[int | None] = mapped_column(ForeignKey("workflow_sessions.id"), nullable=True)
    variables_json: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    global_extra_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_config_id: Mapped[int | None] = mapped_column(ForeignKey("model_configs.id"))
    ad_size: Mapped[str] = mapped_column(String(20), default="1080x1080", server_default="1080x1080")
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    max_images: Mapped[int] = mapped_column(Integer, default=8, server_default="8")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    images: Mapped[list["ActivityBatchImage"]] = relationship(
        back_populates="batch",
        cascade="all, delete-orphan",
        order_by=lambda: (ActivityBatchImage.sort_order.asc(), ActivityBatchImage.id.asc()),
    )


class ActivityBatchImage(Base):
    __tablename__ = "activity_batch_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("activity_generation_batches.id", ondelete="CASCADE")
    )
    job_id: Mapped[int | None] = mapped_column(
        ForeignKey("activity_generation_jobs.id"),
        nullable=True,
    )
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    refine_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_image_id: Mapped[int | None] = mapped_column(
        ForeignKey("activity_batch_images.id"),
        nullable=True,
    )
    prompt_rendered: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 6), default=0, server_default="0")
    token_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    batch: Mapped["ActivityGenerationBatch | None"] = relationship(back_populates="images")
