from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


TemplateNo = Annotated[str, Field(min_length=1, max_length=20)]
VariablePresetType = Literal["reward_amount", "bonus_type", "element"]
ActivityJobStatus = Literal[
    "pending",
    "generating",
    "qc_pending",
    "passed",
    "rejected",
    "archived",
]


class ActivityTemplateTypeResponse(BaseModel):
    id: int
    name: str
    code: str
    sort_order: int
    created_at: datetime
    template_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ActivityFieldDefinitionCreate(BaseModel):
    template_id: int | None = None
    field_key: str
    field_name: str
    field_type: str
    is_required: bool = True
    default_value: str | None = None
    hint: str | None = None
    options_json: list[str] | None = None
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class ActivityFieldDefinitionResponse(BaseModel):
    id: int
    template_id: int | None = None
    field_key: str
    field_name: str
    field_type: str
    is_required: bool
    default_value: str | None = None
    hint: str | None = None
    options_json: list[str] | None = None
    sort_order: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityTemplateCreate(BaseModel):
    template_no: TemplateNo
    name: str
    name_en: str = ""
    type_id: int
    structure_layer1: str
    structure_layer2: str
    structure_layer3: str
    prompt_template: str
    usage_scenario: str | None = None
    scenario_en: str | None = None
    bg_description: str | None = None
    forbidden_rules: str | None = None
    rule_character: str | None = None
    rule_scene: str | None = None
    rule_visual: str | None = None
    rule_copy: str | None = None
    rule_button: str | None = None
    rule_quality: str | None = None
    rule_forbidden: str | None = None
    style_guide: str | None = None
    style_tag: Optional[str] = None
    fields: list[ActivityFieldDefinitionCreate] | None = None
    is_active: bool = True
    created_by: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ActivityTemplateUpdate(BaseModel):
    template_no: TemplateNo | None = None
    name: str | None = None
    name_en: str = ""
    type_id: int | None = None
    structure_layer1: str | None = None
    structure_layer2: str | None = None
    structure_layer3: str | None = None
    prompt_template: str | None = None
    usage_scenario: str | None = None
    scenario_en: str | None = None
    bg_description: str | None = None
    forbidden_rules: str | None = None
    rule_character: str | None = None
    rule_scene: str | None = None
    rule_visual: str | None = None
    rule_copy: str | None = None
    rule_button: str | None = None
    rule_quality: str | None = None
    rule_forbidden: str | None = None
    style_guide: str | None = None
    style_tag: Optional[str] = None
    fields: list[ActivityFieldDefinitionCreate] | None = None
    is_active: bool | None = None

    model_config = ConfigDict(from_attributes=True)


class ActivityTemplateResponse(BaseModel):
    id: int
    template_no: str
    name: str
    name_en: str | None = None
    type_id: int
    type_name: str | None = None
    structure_layer1: str
    structure_layer2: str
    structure_layer3: str
    prompt_template: str
    usage_scenario: str | None = None
    scenario_en: str | None = None
    bg_description: str | None = None
    forbidden_rules: str | None = None
    rule_character: str | None = None
    rule_scene: str | None = None
    rule_visual: str | None = None
    rule_copy: str | None = None
    rule_button: str | None = None
    rule_quality: str | None = None
    rule_forbidden: str | None = None
    style_guide: str | None = None
    style_tag: Optional[str] = None
    fields: list[ActivityFieldDefinitionResponse] = Field(default_factory=list)
    is_active: bool
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityVariablePresetResponse(BaseModel):
    id: int
    var_type: VariablePresetType
    value: str
    label: str
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class ActivityGenerationJobCreate(BaseModel):
    template_id: int
    task_id: int
    model_config_id: int
    variables_json: dict[str, Any] = Field(default_factory=dict)
    reference_asset_ids: list[int] = Field(default_factory=list)
    ad_size: str = "1080x1080"

    model_config = ConfigDict(from_attributes=True)


class ActivityGenerationJobResponse(BaseModel):
    id: int
    template_id: int | None = None
    task_id: int | None = None
    operator_id: int | None = None
    variables_json: dict[str, Any]
    prompt_rendered: str
    model_config_id: int | None = None
    status: ActivityJobStatus
    qc_result: dict[str, Any] | None = None
    reject_reason: str | None = None
    image_url: str | None = None
    cost_usd: Decimal
    token_used: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QCSubmitRequest(BaseModel):
    reward_visible: bool
    action_clear: bool
    character_consistent: bool
    reject_reason: str | None = None

    model_config = ConfigDict(from_attributes=True)
