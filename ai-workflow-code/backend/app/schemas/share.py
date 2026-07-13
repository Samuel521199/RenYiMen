from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ShareType = Literal["benefit", "emotion", "identity", "information"]
ShareJobStatus = Literal["pending", "archived", "refine", "deleted"]


class ShareJobCreate(BaseModel):
    session_id: int | None = None
    share_type: ShareType
    core_text: str
    target_audience: str | None = None
    game_type: str | None = "Tongits"
    image_language: str = "english"
    size: str = "1080x1080"
    reference_asset_ids: list[int] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ShareJobResponse(BaseModel):
    id: int
    session_id: int | None = None
    share_type: ShareType
    core_text: str
    target_audience: str | None = None
    game_type: str
    image_language: str
    model_config_id: int | None = None
    size: str
    status: ShareJobStatus | str
    generated_image_url: str | None = None
    refine_prompt: str | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareJobQCRequest(BaseModel):
    status: Literal["archived", "refine", "deleted"]

    model_config = ConfigDict(from_attributes=True)


class ShareJobRefineRequest(BaseModel):
    refine_prompt: str

    model_config = ConfigDict(from_attributes=True)


class ShareBullActionCreate(BaseModel):
    value: str
    label_zh: str


class ShareBullActionResponse(BaseModel):
    id: int
    value: str
    label_zh: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareBackgroundCreate(BaseModel):
    value: str
    label_zh: str


class ShareBackgroundResponse(BaseModel):
    id: int
    value: str
    label_zh: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareColorMoodCreate(BaseModel):
    value: str
    label_zh: str


class ShareColorMoodResponse(BaseModel):
    id: int
    value: str
    label_zh: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ShareGameInstructionCreate(BaseModel):
    game_type: str
    label: str
    content: str
    sort_order: int = 0


class ShareGameInstructionUpdate(BaseModel):
    label: str | None = None
    content: str | None = None
    sort_order: int | None = None
    enabled: bool | None = None


class ShareGameInstructionResponse(BaseModel):
    id: int
    game_type: str
    label: str
    content: str
    sort_order: int
    enabled: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
