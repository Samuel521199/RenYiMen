from pydantic import BaseModel, ConfigDict


class GalleryTagCreate(BaseModel):
    name_en: str
    name_zh: str | None = None
    source_type: str


class GalleryTagUpdate(BaseModel):
    name_en: str | None = None
    name_zh: str | None = None


class GalleryTagResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    name_en: str | None = None
    name_zh: str | None = None
    source_type: str
    image_count: int
