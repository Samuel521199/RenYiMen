from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AssetTagCreate(BaseModel):
    name_en: str
    name_zh: str | None = None
    category: str = "general"
    tag_group: str | None = None


class AssetTagUpdate(BaseModel):
    name_en: str | None = None
    name_zh: str | None = None
    tag_group: str | None = None


class AssetTagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_en: str | None = None
    name_zh: str | None = None
    category: str
    tag_group: str | None = None
    image_count: int = 0
    created_at: datetime | None = None
