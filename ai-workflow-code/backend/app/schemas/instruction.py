from datetime import datetime

from pydantic import BaseModel, ConfigDict


class WorkflowTypeCreate(BaseModel):
    name: str
    slug: str
    description: str | None = None
    active: bool = True


class WorkflowTypeResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None = None
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InstructionCreate(BaseModel):
    workflow_type_id: int
    name: str
    content: str
    tags: str | None = None
    active: bool = True


class InstructionUpdate(BaseModel):
    workflow_type_id: int | None = None
    name: str | None = None
    content: str | None = None
    tags: str | None = None
    active: bool | None = None


class InstructionResponse(BaseModel):
    id: int
    workflow_type_id: int
    name: str
    content: str
    tags: str | None = None
    active: bool
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
