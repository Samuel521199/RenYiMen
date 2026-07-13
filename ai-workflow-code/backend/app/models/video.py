from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from app.database import Base


class VideoJob(Base):
    __tablename__ = "video_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(Integer, ForeignKey("workflow_sessions.id", ondelete="SET NULL"), nullable=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(32), nullable=False, default="draft")
    current_step = Column(Integer, nullable=False, default=1)
    first_frame_asset_id = Column(Integer, nullable=True)
    first_frame_url = Column(Text, nullable=True)
    export_url = Column(Text, nullable=True)
    first_frame_source_type = Column(String(32), nullable=True)
    first_frame_status = Column(String(32), default="empty")
    aspect_ratio = Column(String(8), default="9:16")
    motion_preset_id = Column(UUID(as_uuid=True), nullable=True)
    video_language = Column(String(16), default="english")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VideoMotionData(Base):
    __tablename__ = "video_motion_data"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    video_job_id = Column(UUID(as_uuid=True), ForeignKey("video_jobs.id", ondelete="CASCADE"), nullable=False)
    motion_sequence = Column(JSONB, nullable=False, default=list)
    timing = Column(JSONB, nullable=False, default=dict)
    camera = Column(String(64), nullable=True)
    emotion = Column(String(64), nullable=True)
    scene = Column(Text, nullable=True)
    raw_keypoints = Column(JSONB, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class VideoDraft(Base):
    __tablename__ = "video_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    video_job_id = Column(UUID(as_uuid=True), ForeignKey("video_jobs.id", ondelete="CASCADE"), nullable=False)
    parent_draft_id = Column(UUID(as_uuid=True), ForeignKey("video_drafts.id"), nullable=True)
    model = Column(String(64), default="kling_v2.6")
    draft_type = Column(String(16), default="draft")
    external_task_id = Column(String(128), nullable=True)
    video_url = Column(Text, nullable=True)
    thumbnail_url = Column(Text, nullable=True)
    duration_seconds = Column(Numeric(5, 2), nullable=True)
    status = Column(String(32), default="pending")
    selected = Column(Boolean, default=False)
    operation = Column(String(32), nullable=True)
    operation_params = Column(JSONB, nullable=True)
    generation_cost = Column(Numeric(10, 4), default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
