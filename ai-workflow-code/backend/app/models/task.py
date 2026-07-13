from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.image import FinalImage, GenerationLog, TaskImage
    from app.models.user import User


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    scene: Mapped[str | None] = mapped_column(String(100))
    size: Mapped[str | None] = mapped_column(String(50))
    purpose: Mapped[str | None] = mapped_column(String(100))
    budget: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0")
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="created", server_default="created")
    creator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    creator: Mapped["User | None"] = relationship(back_populates="tasks")
    images: Mapped[list["TaskImage"]] = relationship(back_populates="task")
    final_images: Mapped[list["FinalImage"]] = relationship(back_populates="task")
    generation_logs: Mapped[list["GenerationLog"]] = relationship(back_populates="task")
