from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ImageGenerateRequest(BaseModel):
    task_id: int
    model_config_id: int
    model_provider: str
    model_name: str
    mode: str | None = None
    prompt: str
    size: str
    count: int = 4
    reference_asset_ids: list[int] = Field(default_factory=list)
    draft_image_id: int | None = None


class ImageGenerateResponse(BaseModel):
    task_id: int
    model_provider: str
    model_name: str
    images: list[dict[str, Any]] = Field(default_factory=list)
    token_used: int = 0
    cost_usd: Decimal = Decimal("0")

    model_config = ConfigDict(from_attributes=True)


class GenerationLogResponse(BaseModel):
    id: int
    task_id: int | None = None
    operator_id: int | None = None
    model_provider: str | None = None
    model_name: str | None = None
    prompt: str | None = None
    image_count: int
    token_used: int
    cost_usd: Decimal
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
