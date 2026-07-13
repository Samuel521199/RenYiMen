from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class TrendingTopicTypeConfigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    topic_type: str
    name_zh: str
    risk_level: str
    allow_game_integration: bool
    allowed_angles: list[str]
    allowed_image_types: list[str]
    allowed_actions: list[str]
    copy_style: str
    notes: Optional[str] = None
    is_active: bool


class TrendingJobCreate(BaseModel):
    news_title: str
    publish_time: Optional[datetime] = None
    topic_type: str
    risk_level_override: Optional[str] = None
    disable_game_integration: bool = False
    ad_size: Optional[str] = "1080x1080"
    image_language: Optional[str] = "english"
    session_id: Optional[int] = None
    task_id: Optional[int] = None


class TrendingJobUpdate(BaseModel):
    selected_angle: Optional[str] = None
    selected_image_type: Optional[str] = None
    selected_action: Optional[str] = None
    copy_text: Optional[str] = None


class TrendingGenerateRequest(BaseModel):
    model_config_id: int
    reference_asset_ids: Optional[list[int]] = None
    count: int = 2
    extra_prompt: Optional[str] = None
    stage: str = "draft"


class TrendingRefineRequest(BaseModel):
    model_config_id: int
    refine_prompt: str
    reference_asset_ids: Optional[list[int]] = None


class TrendingArchiveRequest(BaseModel):
    image_url: str


class TrendingJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: Optional[int] = None
    task_id: Optional[int] = None
    news_title: str
    publish_time: Optional[datetime] = None
    topic_type: str
    risk_level: str
    allow_game_integration: bool
    selected_angle: Optional[str] = None
    selected_image_type: Optional[str] = None
    selected_action: Optional[str] = None
    copy_text: Optional[str] = None
    ad_size: str
    image_language: str
    draft_image_url: Optional[str] = None
    final_image_url: Optional[str] = None
    refined_image_url: Optional[str] = None
    status: str
    created_at: datetime
