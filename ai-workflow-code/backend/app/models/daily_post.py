from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.model_config import ModelConfig
    from app.models.task import Task
    from app.models.user import User
    from app.models.workflow_session import WorkflowSession


class DailyPostTemplate(Base):
    __tablename__ = "daily_post_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    template_type: Mapped[str] = mapped_column(String(50), nullable=False)
    title_copy: Mapped[str | None] = mapped_column(Text, nullable=True)
    interaction_copy: Mapped[str | None] = mapped_column(Text, nullable=True)
    option_a: Mapped[str | None] = mapped_column(Text, nullable=True)
    option_b: Mapped[str | None] = mapped_column(Text, nullable=True)
    option_c: Mapped[str | None] = mapped_column(Text, nullable=True)
    bull_action: Mapped[str | None] = mapped_column(String(50), nullable=True)
    background: Mapped[str | None] = mapped_column(String(50), nullable=True)
    style: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color_mood: Mapped[str | None] = mapped_column(String(50), nullable=True)
    brand_weight: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    jobs: Mapped[list["DailyPostJob"]] = relationship(back_populates="template")


class DailyPostBullAction(Base):
    __tablename__ = "daily_post_bull_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DailyPostBackground(Base):
    __tablename__ = "daily_post_backgrounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DailyPostColorMood(Base):
    __tablename__ = "daily_post_color_moods"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    is_preset: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DailyPostJob(Base):
    __tablename__ = "daily_post_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("daily_post_templates.id", ondelete="SET NULL")
    )
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="SET NULL")
    )
    today_theme: Mapped[str] = mapped_column(Text, nullable=False)
    user_emotion: Mapped[str] = mapped_column(Text, nullable=False)
    main_copy: Mapped[str] = mapped_column(Text, nullable=False)
    interaction_question: Mapped[str] = mapped_column(Text, nullable=False)
    option_a_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    option_b_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    option_c_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    aux_copy: Mapped[str | None] = mapped_column(Text, nullable=True)
    bull_action_override: Mapped[str | None] = mapped_column(String(50), nullable=True)
    background_override: Mapped[str | None] = mapped_column(String(50), nullable=True)
    image_language: Mapped[str] = mapped_column(String(20), nullable=False, server_default="english")
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    generated_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_asset_id: Mapped[int | None] = mapped_column(ForeignKey("assets.id", ondelete="SET NULL"))
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    template: Mapped["DailyPostTemplate | None"] = relationship(back_populates="jobs")
    task: Mapped["Task | None"] = relationship()
    session: Mapped["WorkflowSession | None"] = relationship()
    model_config: Mapped["ModelConfig | None"] = relationship()
    archived_asset: Mapped["Asset | None"] = relationship()
    creator: Mapped["User | None"] = relationship()
