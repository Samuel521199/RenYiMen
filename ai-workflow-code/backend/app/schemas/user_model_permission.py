from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class PermissionGrant(BaseModel):
    user_id: int
    model_config_id: int
    daily_token_limit: int = Field(default=0, ge=0)
    daily_cost_limit: Decimal = Field(default=Decimal("0"), ge=0)
    daily_image_limit: int = Field(default=0, ge=0)


class PermissionLimitsUpdate(BaseModel):
    user_id: int
    model_config_id: int
    daily_token_limit: int = Field(default=0, ge=0)
    daily_cost_limit: Decimal = Field(default=Decimal("0"), ge=0)
    daily_image_limit: int = Field(default=0, ge=0)


class PermissionResponse(BaseModel):
    user_id: int
    model_config_id: int
    model_name: str
    username: str
    daily_token_limit: int = 0
    daily_cost_limit: Decimal = Decimal("0")
    daily_image_limit: int = 0
    used_today_tokens: int = 0
    used_today_cost: Decimal = Decimal("0")
    used_today_images: int = 0
    usage_reset_date: date | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserQuotaUpdate(BaseModel):
    daily_token_limit: int = Field(default=0, ge=0)
    daily_cost_limit: Decimal = Field(default=Decimal("0"), ge=0)
