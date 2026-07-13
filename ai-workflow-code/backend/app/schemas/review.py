from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ReviewSubmitRequest(BaseModel):
    image_id: int
    score: int = Field(ge=0, le=100)
    status: str
    reason: str | None = None
    tags: list[str] = Field(default_factory=list)


class ReviewResponse(BaseModel):
    id: int
    image_id: int | None = None
    reviewer_id: int | None = None
    score: int | None = Field(default=None, ge=0, le=100)
    status: str
    reason: str | None = None
    tags: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
