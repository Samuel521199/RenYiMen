from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from datetime import date

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.asset import Asset
    from app.models.audit import AuditLog
    from app.models.image import FinalImage, GenerationLog
    from app.models.prompt import PromptTemplate
    from app.models.review import ReviewLog
    from app.models.stats import DailyCostStat
    from app.models.task import Task


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    platform_user_id: Mapped[str | None] = mapped_column(String(191), unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    auth_source: Mapped[str] = mapped_column(String(20), default="local", server_default="local")
    last_sso_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    role_sync_strategy: Mapped[str] = mapped_column(
        String(40),
        default="platform_authoritative",
        server_default="platform_authoritative",
    )
    role_sync_locked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    role_last_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    role_last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="operator", server_default="operator")
    status: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    permissions: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    daily_token_limit: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    daily_cost_limit: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    used_today_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    used_today_cost: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    usage_reset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="user")
    tasks: Mapped[list["Task"]] = relationship(back_populates="creator")
    prompt_templates: Mapped[list["PromptTemplate"]] = relationship(back_populates="creator")
    assets: Mapped[list["Asset"]] = relationship(back_populates="uploader")
    generation_logs: Mapped[list["GenerationLog"]] = relationship(back_populates="operator")
    review_logs: Mapped[list["ReviewLog"]] = relationship(back_populates="reviewer")
    final_images: Mapped[list["FinalImage"]] = relationship(back_populates="creator")
    publish_cost_stats: Mapped[list["DailyCostStat"]] = relationship(back_populates="user")
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    api_key: Mapped[str] = mapped_column(Text, nullable=False)
    daily_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    used_today: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped[User | None] = relationship(back_populates="api_keys")
