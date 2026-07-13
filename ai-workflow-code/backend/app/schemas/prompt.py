from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PromptTemplateCreate(BaseModel):
    name: str
    mode: str
    content: str
    active: bool = True
    created_by: int | None = None


class PromptTemplateUpdate(BaseModel):
    name: str | None = None
    mode: str | None = None
    content: str | None = None
    active: bool | None = None


class PromptTemplateResponse(BaseModel):
    id: int
    name: str
    mode: str
    content: str
    active: bool
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PromptBuildRequest(BaseModel):
    task_id: int
    mode: str
    theme: str | None = None
    scene: str | None = None
    size: str | None = None
    asset_ids: list[int] = Field(default_factory=list)


class PromptBuildResponse(BaseModel):
    task_id: int
    mode: str
    prompt: str

    model_config = ConfigDict(from_attributes=True)
