from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.model_config import ModelConfig
    from app.models.user import User
    from app.models.workflow_session import WorkflowSession


class ShareBullAction(Base):
    __tablename__ = "share_bull_actions"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareBackground(Base):
    __tablename__ = "share_backgrounds"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareColorMood(Base):
    __tablename__ = "share_color_moods"

    id: Mapped[int] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    label_zh: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ShareJob(Base):
    __tablename__ = "share_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_sessions.id", ondelete="SET NULL")
    )
    share_type: Mapped[str] = mapped_column(String(20), nullable=False)
    core_text: Mapped[str] = mapped_column(Text, nullable=False)
    target_audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    game_type: Mapped[str] = mapped_column(String(50), nullable=False, server_default="Tongits")
    image_language: Mapped[str] = mapped_column(String(20), nullable=False, server_default="english")
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="SET NULL")
    )
    size: Mapped[str] = mapped_column(String(20), nullable=False, server_default="1080x1080")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    generated_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    refine_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    session: Mapped["WorkflowSession | None"] = relationship()
    model_config: Mapped["ModelConfig | None"] = relationship()
    creator: Mapped["User | None"] = relationship()


class ShareGameInstruction(Base):
    __tablename__ = "share_game_instructions"

    id: Mapped[int] = mapped_column(primary_key=True)
    game_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
