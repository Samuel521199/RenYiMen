from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ──────────────────────────────────────────
# VideoJob
# ──────────────────────────────────────────


class VideoJobCreate(BaseModel):
    task_id: Optional[int] = None
    session_id: Optional[int] = None
    video_language: Optional[str] = "english"
    notes: Optional[str] = None


class VideoJobStatusUpdate(BaseModel):
    status: Optional[str] = None
    current_step: Optional[int] = None
    notes: Optional[str] = None
    aspect_ratio: Optional[str] = None
    export_url: Optional[str] = None


class VideoJobResponse(BaseModel):
    id: UUID
    session_id: Optional[int]
    task_id: Optional[int]
    created_by: Optional[int]
    status: str
    current_step: int
    first_frame_asset_id: Optional[int]
    first_frame_url: Optional[str]
    first_frame_source_type: Optional[str]
    first_frame_status: str
    aspect_ratio: Optional[str]
    export_url: Optional[str]
    video_language: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VideoJobListResponse(BaseModel):
    items: List[VideoJobResponse]
    total: int


# ──────────────────────────────────────────
# First Frame
# ──────────────────────────────────────────


class FirstFrameFromLibrary(BaseModel):
    """从库中选择首帧 · Select first frame from existing library"""

    asset_id: int
    url: str
    source_type: str = Field(..., description="gallery | asset | frame")
    width: Optional[int] = None
    height: Optional[int] = None
    tags: Optional[List[Any]] = []


class FirstFrameAwaitingMake(BaseModel):
    """跳转图片工作台制作首帧 · Set status to awaiting_make before leaving"""

    pass


class FirstFrameWriteback(BaseModel):
    """图片工作台完成后回写首帧 · Called by image workflow on archive"""

    asset_id: int
    url: str
    source_type: str = "frame"
    width: Optional[int] = None
    height: Optional[int] = None
    tags: Optional[List[Any]] = []


class FirstFrameStatusResponse(BaseModel):
    video_job_id: UUID
    first_frame_status: str
    first_frame_url: Optional[str]
    first_frame_asset_id: Optional[int]


# ──────────────────────────────────────────
# VideoMotionData
# ──────────────────────────────────────────


class MotionKeypoint(BaseModel):
    timestamp: float
    label: str


class VideoMotionDataCreate(BaseModel):
    raw_keypoints: List[MotionKeypoint] = []
    camera: Optional[str] = None
    emotion: Optional[str] = None
    scene: Optional[str] = None


class VideoMotionDataResponse(BaseModel):
    id: UUID
    video_job_id: UUID
    motion_sequence: List[str]
    timing: dict
    camera: Optional[str]
    emotion: Optional[str]
    scene: Optional[str]
    raw_keypoints: List[Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ──────────────────────────────────────────
# VideoDraft
# ──────────────────────────────────────────


class VideoDraftResponse(BaseModel):
    id: UUID
    video_job_id: UUID
    model: str
    draft_type: str = "draft"
    video_url: Optional[str]
    thumbnail_url: Optional[str]
    duration_seconds: Optional[float]
    status: str
    selected: bool
    generation_cost: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True


class VideoDraftSelect(BaseModel):
    """标记选中的草稿 · Mark a draft as selected (QG1)"""

    draft_id: UUID
