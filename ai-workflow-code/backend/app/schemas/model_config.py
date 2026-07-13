from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


ModelUsageType = Literal["draft", "final", "both"]
ModelPurposeType = Literal["image", "video_draft", "video_final", "video_analysis"]


class ModelConfigCreate(BaseModel):
    name: str
    provider: str
    model_name: str
    api_key: str
    base_url: str | None = None
    purpose: ModelPurposeType = "image"
    usage_type: ModelUsageType = "both"
    price_per_image: Decimal = Decimal("0")
    daily_limit: Decimal = Decimal("0")


class ModelConfigUpdate(BaseModel):
    name: str | None = None
    provider: str | None = None
    model_name: str | None = None
    api_key: str | None = None
    base_url: str | None = None
    purpose: ModelPurposeType | None = None
    usage_type: ModelUsageType | None = None
    price_per_image: Decimal | None = None
    daily_limit: Decimal | None = None


class ModelConfigResponse(BaseModel):
    id: int
    name: str
    provider: str
    model_name: str
    api_key: str
    base_url: str | None = None
    purpose: ModelPurposeType = "image"
    usage_type: ModelUsageType = "both"
    price_per_image: Decimal
    daily_limit: Decimal
    used_today: Decimal
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_model(cls, model: Any) -> "ModelConfigResponse":
        payload = cls.model_validate(model)
        payload.api_key = (getattr(model, "api_key", "") or "")[-4:]
        return payload
