from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BackgroundImageResponse(BaseModel):
    id: int
    batch_id: int
    asset_id: int | None = None
    image_url: str | None = None
    thumbnail_url: str | None = None
    review_status: str
    is_recommended: bool = False
    tags: dict[str, Any] | None = None
    use_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BackgroundBatchCreate(BaseModel):
    purpose: str
    scene: str
    mood: list[str] = Field(default_factory=list)
    color_style: str
    whitespace_positions: list[str] = Field(default_factory=list)
    size_ratio: str
    localized: bool = False
    game_feel: str = "medium"
    count: int | None = Field(default=4, ge=1, le=8)
    session_id: int | None = None
    model_config_id: int | None = None
    extra_prompt: str | None = None
    reference_asset_ids: list[int] = Field(default_factory=list)


class BackgroundBatchGenerateRequest(BaseModel):
    model_config_id: int
    reference_asset_ids: list[int] = Field(default_factory=list)
    regenerate_image_id: int | None = None
    count: int = Field(ge=1, le=8)


class BackgroundBatchResponse(BaseModel):
    id: int
    purpose: str
    scene: str
    mood: list[str] = Field(default_factory=list)
    color_style: str
    whitespace_positions: list[str] = Field(default_factory=list)
    size_ratio: str
    localized: bool = False
    game_feel: str = "medium"
    count: int
    status: str
    session_id: int | None = None
    model_config_id: int | None = None
    extra_prompt: str | None = None
    created_by: int | None = None
    created_at: datetime
    images: list[BackgroundImageResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class BackgroundImageReviewRequest(BaseModel):
    review_status: str
    image_url: str | None = None
    thumbnail_url: str | None = None


class BackgroundImageRefineRequest(BaseModel):
    model_config_id: int
    refine_prompt: str | None = None


class BackgroundImageArchiveRequest(BaseModel):
    tags: list[str] = Field(default_factory=list)
    is_recommended: bool = False
