from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class MultiFusionJob(Base):
    __tablename__ = "multi_fusion_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[str] = mapped_column(String(32), nullable=False, default="1024x1024", server_default="1024x1024")
    count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    reference_asset_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="SET NULL"),
        nullable=True,
    )

    images: Mapped[list["MultiFusionImage"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by=lambda: MultiFusionImage.id.asc(),
    )


class MultiFusionImage(Base):
    __tablename__ = "multi_fusion_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("multi_fusion_jobs.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    job: Mapped["MultiFusionJob"] = relationship(back_populates="images")
