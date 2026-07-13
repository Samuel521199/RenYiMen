from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ActivityBatchImageResponse(BaseModel):
    id: int
    batch_id: int
    image_url: str | None = None
    extra_prompt: str | None = None
    refine_prompt: str | None = None
    parent_image_id: int | None = None
    prompt_rendered: str | None = None
    status: str
    cost_usd: float = 0
    token_used: int = 0
    sort_order: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityBatchCreate(BaseModel):
    template_id: int
    task_id: int
    variables_json: dict[str, Any]
    global_extra_prompt: str | None = None
    model_config_id: int
    ad_size: str = "1080x1080"
    reference_asset_ids: list[int] = Field(default_factory=list)
    image_configs: list[dict[str, Any]] = Field(default_factory=list)


class ActivityBatchResponse(BaseModel):
    id: int
    template_id: int
    task_id: int
    status: str
    ad_size: str
    global_extra_prompt: str | None = None
    model_config_id: int
    images: list[ActivityBatchImageResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityBatchRefineRequest(BaseModel):
    image_id: int
    refine_prompt: str


class ActivityBatchArchiveRequest(BaseModel):
    image_id: int
