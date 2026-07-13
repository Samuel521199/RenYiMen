from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserModelApiKeyUpsertRequest(BaseModel):
    api_key: str = Field(min_length=1)


class UserModelApiKeyItemResponse(BaseModel):
    model_config_id: int
    name: str
    provider: str
    model_name: str
    api_key_last4: str
    has_custom_key: bool
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)
