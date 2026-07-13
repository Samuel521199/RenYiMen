from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.image import TaskImage
    from app.models.user import User


class ReviewLog(Base):
    __tablename__ = "review_logs"
    __table_args__ = (CheckConstraint("score >= 0 AND score <= 100", name="ck_review_score_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    image_id: Mapped[int | None] = mapped_column(
        ForeignKey("task_images.id", ondelete="CASCADE")
    )
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    score: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    image: Mapped["TaskImage | None"] = relationship(back_populates="review_logs")
    reviewer: Mapped["User | None"] = relationship(back_populates="review_logs")
