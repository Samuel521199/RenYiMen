from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class TaskCreate(BaseModel):
    title: str
    scene: str | None = None
    size: str | None = None
    purpose: str | None = None
    budget: Decimal = Decimal("0")
    description: str | None = None
    creator_id: int | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    scene: str | None = None
    size: str | None = None
    purpose: str | None = None
    budget: Decimal | None = None
    description: str | None = None
    status: str | None = None


class TaskStatusUpdate(BaseModel):
    status: str


class TaskResponse(BaseModel):
    id: int
    title: str
    scene: str | None = None
    size: str | None = None
    purpose: str | None = None
    budget: Decimal
    description: str | None = None
    status: str
    creator_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
