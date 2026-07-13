from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


DailyPostTemplateType = Literal["emotion", "game", "choice", "meme", "local", "character"]
DailyPostBullAction = Literal["happy", "helpless", "sweating", "umbrella", "payday", "celebrate"]
DailyPostBackground = Literal["rain", "home", "street", "jeepney", "basketball"]
DailyPostStyle = Literal["3d_cartoon", "social"]
DailyPostColorMood = Literal["warm", "fresh", "night", "rainy"]
DailyPostBrandWeight = Literal["light", "medium"]
DailyPostJobStatus = Literal["draft", "generating", "done", "archived"]


class DailyPostTemplateOut(BaseModel):
    id: int
    name: str
    template_type: DailyPostTemplateType
    title_copy: str | None = None
    interaction_copy: str | None = None
    option_a: str | None = None
    option_b: str | None = None
    option_c: str | None = None
    bull_action: str | None = None
    background: str | None = None
    style: DailyPostStyle | None = None
    color_mood: str | None = None
    brand_weight: DailyPostBrandWeight | None = None
    is_enabled: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DailyPostTemplateCreate(BaseModel):
    name: str
    template_type: DailyPostTemplateType
    title_copy: str | None = None
    interaction_copy: str | None = None
    option_a: str | None = None
    option_b: str | None = None
    option_c: str | None = None
    bull_action: str | None = None
    background: str | None = None
    style: DailyPostStyle | None = None
    color_mood: str | None = None
    brand_weight: DailyPostBrandWeight | None = None
    is_enabled: bool = True
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class DailyPostTemplateUpdate(BaseModel):
    name: str | None = None
    template_type: DailyPostTemplateType | None = None
    title_copy: str | None = None
    interaction_copy: str | None = None
    option_a: str | None = None
    option_b: str | None = None
    option_c: str | None = None
    bull_action: str | None = None
    background: str | None = None
    style: DailyPostStyle | None = None
    color_mood: str | None = None
    brand_weight: DailyPostBrandWeight | None = None
    is_enabled: bool | None = None
    sort_order: int | None = None

    model_config = ConfigDict(from_attributes=True)


class DailyPostJobCreate(BaseModel):
    template_id: int
    today_theme: str
    user_emotion: str
    main_copy: str
    interaction_question: str
    image_language: str = "english"
    task_id: int | None = None
    model_config_id: int | None = None
    option_a_override: str | None = None
    option_b_override: str | None = None
    option_c_override: str | None = None
    aux_copy: str | None = None
    bull_action_override: str | None = None
    background_override: str | None = None

    model_config = ConfigDict(from_attributes=True)


class DailyPostOptionOut(BaseModel):
    id: int
    value: str
    label_zh: str
    is_preset: bool
    is_enabled: bool
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class DailyPostOptionCreate(BaseModel):
    value: str
    label_zh: str


class DailyPostTemplateSummary(BaseModel):
    id: int
    name: str
    template_type: DailyPostTemplateType
    is_enabled: bool

    model_config = ConfigDict(from_attributes=True)


class DailyPostJobOut(BaseModel):
    id: int
    template_id: int | None = None
    task_id: int | None = None
    session_id: int | None = None
    today_theme: str
    user_emotion: str
    main_copy: str
    interaction_question: str
    option_a_override: str | None = None
    option_b_override: str | None = None
    option_c_override: str | None = None
    aux_copy: str | None = None
    bull_action_override: str | None = None
    background_override: str | None = None
    image_language: str
    model_config_id: int | None = None
    status: DailyPostJobStatus
    generated_image_url: str | None = None
    archived_asset_id: int | None = None
    cost_usd: Decimal | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime
    template: DailyPostTemplateSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class DailyPostJobQC(BaseModel):
    status: Literal["done", "archived"]
    archived_asset_id: int | None = None
    image_url: str | None = None  # 新增：前端传入的实际归档图片 URL

    model_config = ConfigDict(from_attributes=True)
