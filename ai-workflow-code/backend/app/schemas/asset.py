from datetime import datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class AssetUpdate(BaseModel):
    filename: str | None = None
    category: str | None = None
    tags: str | None = None
    url: str | None = None


class AssetResponse(BaseModel):
    id: int
    filename: str
    category: str
    tags: str | None = None
    url: str
    use_count: int | None = 0
    uploaded_by: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssetTagRecord(BaseModel):
    name: str
    group: str | None = Field(
        default=None,
        validation_alias=AliasChoices("group", "tag_group"),
        serialization_alias="group",
    )

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
