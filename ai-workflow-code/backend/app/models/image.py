from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.review import ReviewLog
    from app.models.stats import PublishStat
    from app.models.task import Task
    from app.models.user import User


class TaskImage(Base):
    __tablename__ = "task_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    model_provider: Mapped[str | None] = mapped_column(String(50))
    model_name: Mapped[str | None] = mapped_column(String(100))
    prompt_used: Mapped[str | None] = mapped_column(Text)
    token_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task: Mapped["Task | None"] = relationship(back_populates="images")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="image")
    final_images: Mapped[list["FinalImage"]] = relationship(back_populates="task_image")
    publish_stats: Mapped[list["PublishStat"]] = relationship(back_populates="image")


class FinalImage(Base):
    __tablename__ = "final_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_image_id: Mapped[int | None] = mapped_column(
        ForeignKey("task_images.id", ondelete="SET NULL")
    )
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_used: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(50), default="expression", server_default="expression")
    sub_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    style_tag: Mapped[str | None] = mapped_column(String(50), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task_image: Mapped[TaskImage | None] = relationship(back_populates="final_images")
    task: Mapped["Task | None"] = relationship(back_populates="final_images")
    creator: Mapped["User | None"] = relationship(back_populates="final_images")
    publish_stats: Mapped[list["PublishStat"]] = relationship(back_populates="final_image")


class GenerationLog(Base):
    __tablename__ = "generation_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    model_provider: Mapped[str | None] = mapped_column(String(50))
    model_name: Mapped[str | None] = mapped_column(String(100))
    prompt: Mapped[str | None] = mapped_column(Text)
    image_count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    token_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(20), default="success", server_default="success")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    task: Mapped["Task | None"] = relationship(back_populates="generation_logs")
    operator: Mapped["User | None"] = relationship(back_populates="generation_logs")
