from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class DashboardStats(BaseModel):
    today_tasks: int = 0
    today_cost_usd: Decimal = Decimal("0")
    today_images: int = 0
    pending_reviews: int = 0

    model_config = ConfigDict(from_attributes=True)


class DailyCostStat(BaseModel):
    id: int | None = None
    stat_date: date
    user_id: int | None = None
    model_provider: str | None = None
    total_tokens: int = 0
    total_cost: Decimal = Decimal("0")
    image_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ModelStat(BaseModel):
    model_name: str = "unknown"
    model_provider: str
    total_tokens: int = 0
    total_cost: Decimal = Decimal("0")
    image_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class UserStat(BaseModel):
    user_id: int
    username: str | None = None
    total_tokens: int = 0
    total_cost: Decimal = Decimal("0")
    image_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class PublishStatCreate(BaseModel):
    image_id: int | None = None
    final_image_id: int | None = None
    publish_date: date
    channel: str | None = None
    likes: int = 0
    comments: int = 0
    shares: int = 0
    notes: str | None = None


class PublishStatResponse(BaseModel):
    id: int
    image_id: int | None = None
    final_image_id: int | None = None
    publish_date: date
    channel: str | None = None
    likes: int
    comments: int
    shares: int
    notes: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
