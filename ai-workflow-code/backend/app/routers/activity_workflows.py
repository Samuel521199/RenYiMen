from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.activity_template import (
    ActivityFieldDefinition,
    ActivityGenerationJob,
    ActivityTemplate,
    ActivityTemplateType,
    ActivityVariablePreset,
)
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.models.model_config import ModelConfig
from app.models.task import Task
from app.schemas.activity_template import (
    ActivityFieldDefinitionCreate,
    ActivityFieldDefinitionResponse,
    ActivityGenerationJobCreate,
    ActivityGenerationJobResponse,
    ActivityTemplateCreate,
    ActivityTemplateResponse,
    ActivityTemplateTypeResponse,
    ActivityTemplateUpdate,
    ActivityVariablePresetResponse,
    QCSubmitRequest,
)
from app.schemas.generate import ImageGenerateRequest
from app.services import ai_gateway
from app.utils.response import err, ok


activity_router = APIRouter()
router = activity_router

DEFAULT_FIELDS = [
    {
        "field_key": "title",
        "field_name": "主标题",
        "field_type": "text",
        "is_required": True,
        "default_value": "Come Back & Get Rewards",
        "hint": "最多6个英文词",
        "options_json": None,
        "sort_order": 1,
    },
    {
        "field_key": "subtitle",
        "field_name": "副标题",
        "field_type": "text",
        "is_required": True,
        "default_value": "Your bonus is waiting",
        "hint": "最多10个英文词",
        "options_json": None,
        "sort_order": 2,
    },
    {
        "field_key": "reward_amount",
        "field_name": "奖励数量",
        "field_type": "text",
        "is_required": True,
        "default_value": "20,000",
        "hint": None,
        "options_json": None,
        "sort_order": 3,
    },
    {
        "field_key": "bonus_type",
        "field_name": "奖励类型",
        "field_type": "select",
        "is_required": True,
        "default_value": "Coins",
        "hint": None,
        "options_json": ["Coins", "Bonus", "Gift", "Voucher", "Free Reward"],
        "sort_order": 4,
    },
    {
        "field_key": "cta_text",
        "field_name": "按钮文字",
        "field_type": "select",
        "is_required": True,
        "default_value": "Claim Now",
        "hint": None,
        "options_json": ["Claim Now", "Play Now", "Join Now", "Get Bonus"],
        "sort_order": 5,
    },
]


def error_response(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=err(message, status_code))


def require_admin(current_user: dict[str, Any]) -> JSONResponse | None:
    if current_user.get("role") != "admin":
        return error_response("Admin permission required", 403)
    return None


def build_prompt(
    template: ActivityTemplate,
    user_values: dict[str, Any],
    output_size: str = "1080x1080",
) -> str:
    parts: list[str] = []
    if template.rule_character:
        parts.append(f"[CHARACTER]\n{template.rule_character}")
    if template.style_guide:
        parts.append(f"[STYLE GUIDE]\n{template.style_guide}")
    if template.rule_scene:
        parts.append(f"[SCENE]\n{template.rule_scene}")

    structure: list[str] = []
    if template.structure_layer1:
        structure.append(f"主视觉区：{template.structure_layer1}")
    if template.structure_layer2:
        structure.append(f"文案区：{template.structure_layer2}")
    if template.structure_layer3:
        structure.append(f"行动区：{template.structure_layer3}")
    if template.bg_description:
        structure.append(f"背景区：{template.bg_description}")
    if structure:
        parts.append("[STRUCTURE]\n" + "\n".join(structure))

    if template.rule_visual:
        parts.append(f"[VISUAL]\n{template.rule_visual}")

    content_lines = [f"{key}: {value}" for key, value in user_values.items()]
    if content_lines:
        parts.append("[CONTENT]\n" + "\n".join(content_lines))

    if template.rule_copy:
        parts.append(f"[COPY RULES]\n{template.rule_copy}")
    if template.rule_button:
        parts.append(f"[BUTTON]\n{template.rule_button}")
    if template.rule_quality:
        parts.append(f"[QUALITY]\n{template.rule_quality}")

    forbidden: list[str] = []
    if template.rule_forbidden:
        forbidden.append(template.rule_forbidden)
    if template.forbidden_rules:
        forbidden.append(template.forbidden_rules)
    if forbidden:
        parts.append("[FORBIDDEN]\n" + "\n".join(forbidden))

    parts.append(f"[OUTPUT]\n{output_size.replace('x', ' x ')}\nSingle image")
    return "\n\n".join(parts)


def serialize_template(template: ActivityTemplate) -> dict[str, Any]:
    response = ActivityTemplateResponse.model_validate(template)
    sorted_fields = sorted(
        [
            ActivityFieldDefinitionResponse.model_validate(field)
            for field in template.field_definitions
        ],
        key=lambda item: (item.sort_order, item.id),
    )
    return response.model_copy(update={"fields": sorted_fields}).model_dump(mode="json")


def build_field_definition_models(
    template_id: int,
    fields: list[ActivityFieldDefinitionCreate],
) -> list[ActivityFieldDefinition]:
    return [
        ActivityFieldDefinition(
            template_id=template_id,
            field_key=field.field_key,
            field_name=field.field_name,
            field_type=field.field_type,
            is_required=field.is_required,
            default_value=field.default_value,
            hint=field.hint,
            options_json=field.options_json,
            sort_order=field.sort_order,
        )
        for field in fields
    ]


async def replace_template_fields(
    db: AsyncSession,
    template_id: int,
    fields: list[ActivityFieldDefinitionCreate],
) -> list[ActivityFieldDefinition]:
    await db.execute(
        delete(ActivityFieldDefinition).where(ActivityFieldDefinition.template_id == template_id)
    )
    new_fields = build_field_definition_models(template_id, fields)
    if new_fields:
        db.add_all(new_fields)
    return new_fields


async def get_template_or_none(
    db: AsyncSession,
    template_id: int,
) -> ActivityTemplate | None:
    result = await db.execute(
        select(ActivityTemplate)
        .options(
            joinedload(ActivityTemplate.template_type),
            selectinload(ActivityTemplate.field_definitions),
        )
        .where(ActivityTemplate.id == template_id)
    )
    return result.scalar_one_or_none()


async def get_job_or_none(db: AsyncSession, job_id: int) -> ActivityGenerationJob | None:
    result = await db.execute(select(ActivityGenerationJob).where(ActivityGenerationJob.id == job_id))
    return result.scalar_one_or_none()


async def resolve_activity_reference_image_urls(
    db: AsyncSession | None,
    reference_asset_ids: list[int],
) -> list[str]:
    if db is None or not reference_asset_ids:
        return []

    selected_ids = reference_asset_ids[:4]
    result = await db.execute(select(Asset).where(Asset.id.in_(selected_ids)))
    assets = result.scalars().all()
    assets_by_id = {asset.id: asset for asset in assets}
    return [
        assets_by_id[asset_id].url
        for asset_id in selected_ids
        if asset_id in assets_by_id and assets_by_id[asset_id].url
    ]


@activity_router.get("/template-types")
async def list_template_types(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(ActivityTemplateType, func.count(ActivityTemplate.id).label("template_count"))
        .outerjoin(ActivityTemplate, ActivityTemplate.type_id == ActivityTemplateType.id)
        .group_by(ActivityTemplateType.id)
        .order_by(ActivityTemplateType.sort_order.asc(), ActivityTemplateType.id.asc())
    )
    payload = []
    for template_type, template_count in result.all():
        item = ActivityTemplateTypeResponse.model_validate(template_type).model_copy(
            update={"template_count": int(template_count or 0)}
        )
        payload.append(item.model_dump(mode="json"))
    return ok(payload)


@activity_router.get("/templates")
async def list_templates(
    type_id: int | None = None,
    is_active: bool | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = (
        select(ActivityTemplate)
        .options(
            joinedload(ActivityTemplate.template_type),
            selectinload(ActivityTemplate.field_definitions),
        )
        .order_by(ActivityTemplate.template_no.asc())
    )
    if type_id is not None:
        query = query.where(ActivityTemplate.type_id == type_id)
    if is_active is not None:
        query = query.where(ActivityTemplate.is_active == is_active)

    result = await db.execute(query)
    templates = result.scalars().unique().all()
    payload = [serialize_template(item) for item in templates]
    return ok(payload)


@activity_router.post("/templates/create")
async def create_template(
    req: ActivityTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    denied = require_admin(current_user)
    if denied is not None:
        return denied

    name_en = req.name_en.strip()
    if not name_en:
        return error_response("name_en is required", 400)

    template = ActivityTemplate(
        template_no=req.template_no,
        name=req.name,
        name_en=name_en,
        type_id=req.type_id,
        structure_layer1=req.structure_layer1,
        structure_layer2=req.structure_layer2,
        structure_layer3=req.structure_layer3,
        prompt_template=req.prompt_template,
        usage_scenario=req.usage_scenario,
        scenario_en=req.scenario_en,
        bg_description=req.bg_description,
        forbidden_rules=req.forbidden_rules,
        rule_character=req.rule_character,
        rule_scene=req.rule_scene,
        rule_visual=req.rule_visual,
        rule_copy=req.rule_copy,
        rule_button=req.rule_button,
        rule_quality=req.rule_quality,
        rule_forbidden=req.rule_forbidden,
        style_guide=req.style_guide,
        style_tag=req.style_tag,
        is_active=req.is_active,
        created_by=int(current_user["id"]),
    )
    db.add(template)
    await db.flush()
    if req.fields is not None:
        build_fields = build_field_definition_models(template.id, req.fields)
        if build_fields:
            db.add_all(build_fields)
    await db.commit()
    template = await get_template_or_none(db, template.id)
    if template is None:
        return error_response("Template create failed", 500)
    return ok(serialize_template(template))


@activity_router.put("/templates/{id}")
async def update_template(
    id: int,
    req: ActivityTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    denied = require_admin(current_user)
    if denied is not None:
        return denied

    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)
    if not req.name_en.strip():
        return error_response("name_en is required", 400)

    update_data = req.model_dump(exclude_unset=True)
    if "name_en" in update_data:
        update_data["name_en"] = req.name_en.strip()
    fields = update_data.pop("fields", None)
    for field, value in update_data.items():
        setattr(template, field, value)
    if fields is not None:
        await replace_template_fields(
            db,
            id,
            [ActivityFieldDefinitionCreate(**field) for field in fields],
        )
    await db.commit()
    await db.refresh(template)
    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)
    return ok(serialize_template(template))


@activity_router.delete("/templates/{id}")
async def delete_template(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    denied = require_admin(current_user)
    if denied is not None:
        return denied

    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    await db.delete(template)
    await db.commit()
    return ok({"id": id, "deleted": True})


@activity_router.patch("/templates/{id}/toggle")
async def toggle_template(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    denied = require_admin(current_user)
    if denied is not None:
        return denied

    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    template.is_active = not template.is_active
    await db.commit()
    await db.refresh(template)
    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)
    return ok(serialize_template(template))


@activity_router.post("/templates/{id}/fields/reset-defaults")
async def reset_template_fields_defaults(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    denied = require_admin(current_user)
    if denied is not None:
        return denied

    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    await db.execute(
        delete(ActivityFieldDefinition).where(ActivityFieldDefinition.template_id == id)
    )
    db.add_all(
        [
            ActivityFieldDefinition(template_id=id, **field)
            for field in DEFAULT_FIELDS
        ]
    )
    await db.commit()
    return ok({"template_id": id, "reset_count": len(DEFAULT_FIELDS)})


@activity_router.get("/variable-presets")
async def list_variable_presets(
    var_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(ActivityVariablePreset).order_by(
        ActivityVariablePreset.var_type.asc(),
        ActivityVariablePreset.sort_order.asc(),
        ActivityVariablePreset.id.asc(),
    )
    if var_type is not None:
        query = query.where(ActivityVariablePreset.var_type == var_type)

    result = await db.execute(query)
    payload = [
        ActivityVariablePresetResponse.model_validate(item).model_dump(mode="json")
        for item in result.scalars().all()
    ]
    return ok(payload)


@activity_router.post("/jobs/create")
async def create_generation_job(
    req: ActivityGenerationJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template = await get_template_or_none(db, req.template_id)
    if template is None:
        return error_response("Template not found", 404)

    task_result = await db.execute(select(Task).where(Task.id == req.task_id))
    task = task_result.scalar_one_or_none()
    if task is None:
        return error_response("Task not found", 404)

    model_result = await db.execute(select(ModelConfig).where(ModelConfig.id == req.model_config_id))
    model_config = model_result.scalar_one_or_none()
    if model_config is None:
        return error_response("Model config not found", 404)

    generation_size = req.ad_size or task.size or "1080x1080"
    prompt_rendered = build_prompt(template, req.variables_json, output_size=generation_size)
    reference_image_urls = await resolve_activity_reference_image_urls(db, req.reference_asset_ids)
    generation_request = ImageGenerateRequest(
        task_id=req.task_id,
        model_config_id=req.model_config_id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        mode="final",
        prompt=prompt_rendered,
        size=generation_size,
        count=1,
    )
    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls=reference_image_urls,
        user_id=int(current_user["id"]),
    )
    image_url = next(
        (
            item.get("url")
            for item in generation.images
            if isinstance(item, dict) and item.get("url")
        ),
        None,
    )
    if image_url is None:
        return error_response("Image generation returned no image URL", 502)

    job = ActivityGenerationJob(
        template_id=req.template_id,
        task_id=req.task_id,
        operator_id=int(current_user["id"]),
        variables_json=req.variables_json,
        prompt_rendered=prompt_rendered,
        model_config_id=req.model_config_id,
        status="qc_pending",
        image_url=image_url,
        cost_usd=Decimal(generation.cost_usd),
        token_used=generation.token_used,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return ok(
        {
            "job": ActivityGenerationJobResponse.model_validate(job).model_dump(mode="json"),
            "generation": generation.model_dump(mode="json"),
        }
    )


@activity_router.get("/jobs")
async def list_generation_jobs(
    status: str | None = None,
    template_id: int | None = None,
    operator_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(ActivityGenerationJob).order_by(ActivityGenerationJob.created_at.desc())
    if status is not None:
        query = query.where(ActivityGenerationJob.status == status)
    if template_id is not None:
        query = query.where(ActivityGenerationJob.template_id == template_id)
    if operator_id is not None:
        query = query.where(ActivityGenerationJob.operator_id == operator_id)

    result = await db.execute(query)
    payload = [
        ActivityGenerationJobResponse.model_validate(item).model_dump(mode="json")
        for item in result.scalars().all()
    ]
    return ok(payload)


@activity_router.get("/jobs/{id}")
async def get_generation_job(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Generation job not found", 404)
    return ok(ActivityGenerationJobResponse.model_validate(job).model_dump(mode="json"))


@activity_router.post("/jobs/{id}/qc")
async def submit_generation_qc(
    id: int,
    req: QCSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Generation job not found", 404)

    qc_result = {
        "reward_visible": req.reward_visible,
        "action_clear": req.action_clear,
        "character_consistent": req.character_consistent,
    }
    passed = all(qc_result.values())
    job.qc_result = qc_result
    job.reject_reason = None if passed else req.reject_reason
    job.status = "passed" if passed else "rejected"
    await db.commit()
    await db.refresh(job)
    return ok(ActivityGenerationJobResponse.model_validate(job).model_dump(mode="json"))


@activity_router.post("/jobs/{id}/archive")
async def archive_generation_job(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Generation job not found", 404)
    if job.status != "passed":
        return error_response("Only passed jobs can be archived", 400)
    if not job.image_url:
        return error_response("Generation job has no image URL", 400)

    template = None
    template_type = None
    if job.template_id is not None:
        template_result = await db.execute(
            select(ActivityTemplate).where(ActivityTemplate.id == job.template_id)
        )
        template = template_result.scalar_one_or_none()
        if template is not None:
            template_type_result = await db.execute(
                select(ActivityTemplateType).where(ActivityTemplateType.id == template.type_id)
            )
            template_type = template_type_result.scalar_one_or_none()

    final_image = FinalImage(
        task_id=job.task_id,
        task_image_id=None,
        image_url=job.image_url,
        prompt_used=job.prompt_rendered,
        tags=None,
        source_type="activity",
        sub_category=template_type.code if template_type is not None else None,
        style_tag=template.style_tag if template is not None else None,
        created_by=int(current_user["id"]),
    )
    db.add(final_image)

    if final_image.style_tag:
        tag_result = await db.execute(
            select(GalleryTag).where(
                GalleryTag.name == final_image.style_tag,
                GalleryTag.source_type == final_image.source_type,
            )
        )
        existing_tag = tag_result.scalar_one_or_none()
        if existing_tag is not None:
            existing_tag.image_count += 1
        else:
            db.add(
                GalleryTag(
                    name=final_image.style_tag,
                    source_type=final_image.source_type,
                    image_count=1,
                )
            )

    job.status = "archived"
    await db.commit()
    await db.refresh(job)
    await db.refresh(final_image)
    return ok(
        {
            "job": ActivityGenerationJobResponse.model_validate(job).model_dump(mode="json"),
            "final_image": {
                "id": final_image.id,
                "task_id": final_image.task_id,
                "task_image_id": final_image.task_image_id,
                "image_url": final_image.image_url,
                "source_type": final_image.source_type,
                "sub_category": final_image.sub_category,
                "style_tag": final_image.style_tag,
                "created_by": final_image.created_by,
            },
        }
    )
