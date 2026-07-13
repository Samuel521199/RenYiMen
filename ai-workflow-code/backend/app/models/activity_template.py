from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.model_config import ModelConfig
    from app.models.task import Task
    from app.models.user import User


class ActivityTemplateType(Base):
    __tablename__ = "activity_template_types"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    templates: Mapped[list["ActivityTemplate"]] = relationship(back_populates="template_type")


class ActivityTemplate(Base):
    __tablename__ = "activity_templates"
    __table_args__ = (
        CheckConstraint(
            r"template_no ~ '^T(0[1-9]|1[0-9]|2[0-5])$'",
            name="ck_activity_templates_template_no",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    template_no: Mapped[str] = mapped_column(String(3), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type_id: Mapped[int] = mapped_column(
        ForeignKey("activity_template_types.id"),
        nullable=False,
    )
    structure_layer1: Mapped[str] = mapped_column(Text, nullable=False)
    structure_layer2: Mapped[str] = mapped_column(Text, nullable=False)
    structure_layer3: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    usage_scenario: Mapped[str | None] = mapped_column(Text, nullable=True)
    scenario_en: Mapped[str | None] = mapped_column(Text, nullable=True)
    bg_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    forbidden_rules: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_character: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_scene: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_visual: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_copy: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_button: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_quality: Mapped[str | None] = mapped_column(Text, nullable=True)
    rule_forbidden: Mapped[str | None] = mapped_column(Text, nullable=True)
    style_guide: Mapped[str | None] = mapped_column(Text, nullable=True)
    style_tag: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    template_type: Mapped["ActivityTemplateType"] = relationship(back_populates="templates")
    field_definitions: Mapped[list["ActivityFieldDefinition"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by=lambda: (ActivityFieldDefinition.sort_order.asc(), ActivityFieldDefinition.id.asc()),
    )
    creator: Mapped["User | None"] = relationship()
    generation_jobs: Mapped[list["ActivityGenerationJob"]] = relationship(back_populates="template")

    @property
    def type_name(self) -> str | None:
        return self.template_type.name if self.template_type is not None else None


class ActivityFieldDefinition(Base):
    __tablename__ = "activity_field_definitions"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("activity_templates.id", ondelete="CASCADE")
    )
    field_key: Mapped[str] = mapped_column(String(50), nullable=False)
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    field_type: Mapped[str] = mapped_column(String(20), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    hint: Mapped[str | None] = mapped_column(Text, nullable=True)
    options_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    template: Mapped["ActivityTemplate | None"] = relationship(back_populates="field_definitions")


class ActivityVariablePreset(Base):
    __tablename__ = "activity_variable_presets"
    __table_args__ = (
        CheckConstraint(
            "var_type IN ('reward_amount', 'bonus_type', 'element')",
            name="ck_activity_variable_presets_var_type",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    var_type: Mapped[str] = mapped_column(String(20), nullable=False)
    value: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ActivityGenerationJob(Base):
    __tablename__ = "activity_generation_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int | None] = mapped_column(
        ForeignKey("activity_templates.id", ondelete="SET NULL")
    )
    task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    variables_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    prompt_rendered: Mapped[str] = mapped_column(Text, nullable=False)
    model_config_id: Mapped[int | None] = mapped_column(
        ForeignKey("model_configs.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    qc_result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    reject_reason: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(Text)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 4), default=0, server_default="0")
    token_used: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    template: Mapped["ActivityTemplate | None"] = relationship(back_populates="generation_jobs")
    task: Mapped["Task | None"] = relationship()
    operator: Mapped["User | None"] = relationship()
    model_config: Mapped["ModelConfig | None"] = relationship()
