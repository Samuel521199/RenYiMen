from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class MultiFusionImageResponse(BaseModel):
    id: int
    job_id: int
    image_url: str | None = None
    thumbnail_url: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MultiFusionJobCreate(BaseModel):
    prompt: str = Field(min_length=2, max_length=8000)
    size: str = "1024x1024"
    count: int = Field(default=1, ge=1, le=4)
    reference_asset_ids: list[int] = Field(default_factory=list)
    model_config_id: int | None = None
    session_id: int | None = None


class MultiFusionJobGenerateRequest(BaseModel):
    model_config_id: int
    reference_asset_ids: list[int] = Field(default_factory=list)
    count: int = Field(default=1, ge=1, le=4)
    regenerate_image_id: int | None = None


class MultiFusionJobResponse(BaseModel):
    id: int
    prompt: str
    size: str
    count: int
    reference_asset_ids: list[int] = Field(default_factory=list)
    status: str
    session_id: int | None = None
    model_config_id: int | None = None
    created_by: int | None = None
    created_at: datetime
    images: list[MultiFusionImageResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
