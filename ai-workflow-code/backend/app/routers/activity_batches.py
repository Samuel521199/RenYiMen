import json
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.activity_batch import ActivityBatchImage, ActivityGenerationBatch
from app.models.activity_template import ActivityGenerationJob, ActivityTemplate, ActivityTemplateType
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.models.model_config import ModelConfig
from app.models.task import Task
from app.models.workflow_session import WorkflowSession
from app.routers.activity_workflows import build_prompt, resolve_activity_reference_image_urls
from app.schemas.activity_batch import (
    ActivityBatchArchiveRequest,
    ActivityBatchCreate,
    ActivityBatchImageResponse,
    ActivityBatchRefineRequest,
    ActivityBatchResponse,
)
from app.schemas.generate import ImageGenerateRequest
from app.services import ai_gateway
from app.services.image_size_utils import normalize_generation_size
from app.utils.response import err, ok


router = APIRouter()


def error_response(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=err(message, status_code))


def clean_prompt_part(value: str | None) -> str | None:
    clean = (value or "").strip()
    return clean or None


def compose_batch_prompt(
    template: ActivityTemplate,
    variables_json: dict[str, Any],
    ad_size: str,
    global_extra_prompt: str | None,
    image_extra_prompt: str | None,
) -> str:
    parts = [
        build_prompt(template, variables_json, output_size=ad_size),
        clean_prompt_part(global_extra_prompt),
        clean_prompt_part(image_extra_prompt),
    ]
    return "\n\n".join(part for part in parts if part)


def first_generated_image_url(generation: Any) -> str | None:
    return next(
        (
            item.get("url") or item.get("image_url")
            for item in generation.images
            if isinstance(item, dict) and (item.get("url") or item.get("image_url"))
        ),
        None,
    )


def decimal_value(value: Any) -> Decimal:
    return Decimal(str(value or 0))


async def get_batch_or_none(db: AsyncSession, batch_id: int) -> ActivityGenerationBatch | None:
    result = await db.execute(
        select(ActivityGenerationBatch)
        .options(selectinload(ActivityGenerationBatch.images))
        .where(ActivityGenerationBatch.id == batch_id)
    )
    return result.scalar_one_or_none()


async def get_batch_image_or_none(
    db: AsyncSession,
    batch_id: int,
    image_id: int,
) -> ActivityBatchImage | None:
    result = await db.execute(
        select(ActivityBatchImage).where(
            ActivityBatchImage.batch_id == batch_id,
            ActivityBatchImage.id == image_id,
        )
    )
    return result.scalar_one_or_none()


async def get_template_and_type(
    db: AsyncSession,
    template_id: int | None,
) -> tuple[ActivityTemplate | None, ActivityTemplateType | None]:
    if template_id is None:
        return None, None

    template_result = await db.execute(select(ActivityTemplate).where(ActivityTemplate.id == template_id))
    template = template_result.scalar_one_or_none()
    if template is None:
        return None, None

    type_result = await db.execute(
        select(ActivityTemplateType).where(ActivityTemplateType.id == template.type_id)
    )
    return template, type_result.scalar_one_or_none()


def serialize_batch(batch: ActivityGenerationBatch) -> dict[str, Any]:
    images = [
        ActivityBatchImageResponse.model_validate(image).model_dump(mode="json")
        for image in sorted(batch.images, key=lambda item: (item.sort_order, item.id))
    ]
    return ActivityBatchResponse.model_validate(batch).model_copy(update={"images": images}).model_dump(mode="json")


def activity_batch_session_state(batch_id: int) -> str:
    return json.dumps({"batch_id": batch_id}, ensure_ascii=False)


async def find_workflow_session_for_batch(
    db: AsyncSession,
    batch: ActivityGenerationBatch,
) -> WorkflowSession | None:
    if batch.session_id:
        result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == batch.session_id))
        session = result.scalar_one_or_none()
        if session is not None:
            return session

    result = await db.execute(
        select(WorkflowSession).where(
            WorkflowSession.workflow_type == "activity",
            WorkflowSession.state_json.contains(f'"batch_id": {batch.id}'),
        )
    )
    return result.scalar_one_or_none()


async def update_activity_batch_workflow_session(
    db: AsyncSession,
    batch: ActivityGenerationBatch,
    status: str,
    current_step: int,
) -> WorkflowSession | None:
    session = await find_workflow_session_for_batch(db, batch)
    if session is None:
        return None
    session.status = status
    session.current_step = current_step
    session.updated_at = func.now()
    return session


async def complete_activity_batch_workflow_session(
    db: AsyncSession,
    batch: ActivityGenerationBatch,
) -> WorkflowSession | None:
    session = await find_workflow_session_for_batch(db, batch)
    if session is None:
        return None
    session.status = "completed"
    session.current_step = 4
    session.updated_at = func.now()
    return session


async def mark_batch_completed_if_done(db: AsyncSession, batch: ActivityGenerationBatch) -> bool:
    result = await db.execute(
        select(ActivityBatchImage).where(ActivityBatchImage.batch_id == batch.id)
    )
    images = list(result.scalars().all())
    completed = bool(images) and all(image.status in {"archived", "deleted"} for image in images)
    if completed:
        batch.status = "completed"
    return completed


@router.post("/create")
async def create_activity_batch(
    req: ActivityBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template_result = await db.execute(select(ActivityTemplate).where(ActivityTemplate.id == req.template_id))
    template = template_result.scalar_one_or_none()
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

    image_configs = req.image_configs[:8] or [{}]
    normalized_ad_size = normalize_generation_size(req.ad_size)
    batch = ActivityGenerationBatch(
        template_id=req.template_id,
        task_id=req.task_id,
        operator_id=int(current_user["id"]),
        variables_json=req.variables_json,
        global_extra_prompt=req.global_extra_prompt,
        model_config_id=req.model_config_id,
        ad_size=normalized_ad_size,
        status="generating",
        max_images=8,
    )
    db.add(batch)
    await db.flush()

    reference_image_urls = await resolve_activity_reference_image_urls(db, req.reference_asset_ids)
    for index, config in enumerate(image_configs):
        extra_prompt = clean_prompt_part(str(config.get("extra_prompt") or "")) if isinstance(config, dict) else None
        prompt_rendered = compose_batch_prompt(
            template,
            req.variables_json,
            normalized_ad_size,
            req.global_extra_prompt,
            extra_prompt,
        )
        batch_image = ActivityBatchImage(
            batch_id=batch.id,
            extra_prompt=extra_prompt,
            prompt_rendered=prompt_rendered,
            status="generating",
            sort_order=index,
        )
        db.add(batch_image)
        await db.flush()

        generation_request = ImageGenerateRequest(
            task_id=req.task_id,
            model_config_id=req.model_config_id,
            model_provider=model_config.provider,
            model_name=model_config.model_name,
            mode="final",
            prompt=prompt_rendered,
            size=normalized_ad_size,
            count=1,
        )
        try:
            generation = await ai_gateway.generate_image(
                db,
                generation_request,
                reference_image_urls=reference_image_urls,
                user_id=int(current_user["id"]),
            )
        except HTTPException as exc:
            detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
            return error_response(f"AI 生成失败：{detail}", exc.status_code)
        image_url = first_generated_image_url(generation)
        if image_url is None:
            return error_response("AI 生成失败：上游未返回图片，请调整提示词或更换模型后重试", 502)

        job = ActivityGenerationJob(
            template_id=req.template_id,
            task_id=req.task_id,
            operator_id=int(current_user["id"]),
            variables_json=req.variables_json,
            prompt_rendered=prompt_rendered,
            model_config_id=req.model_config_id,
            status="qc_pending",
            image_url=image_url,
            cost_usd=decimal_value(generation.cost_usd),
            token_used=generation.token_used,
        )
        db.add(job)
        await db.flush()

        batch_image.job_id = job.id
        batch_image.image_url = image_url
        batch_image.cost_usd = decimal_value(generation.cost_usd)
        batch_image.token_used = generation.token_used
        batch_image.status = "done"

    batch.status = "reviewing"
    session = WorkflowSession(
        workflow_type="activity",
        mode="full",
        status="draft",
        current_step=3,
        state_json=activity_batch_session_state(batch.id),
        task_id=batch.task_id,
        created_by=int(current_user["id"]),
    )
    db.add(session)
    await db.flush()
    batch.session_id = session.id
    await db.commit()
    batch = await get_batch_or_none(db, batch.id)
    if batch is None:
        return error_response("Batch create failed", 500)
    return ok(serialize_batch(batch))


@router.get("")
async def list_activity_batches(
    status: str | None = None,
    operator_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = (
        select(ActivityGenerationBatch)
        .options(selectinload(ActivityGenerationBatch.images))
        .order_by(ActivityGenerationBatch.created_at.desc())
    )
    if status is not None:
        query = query.where(ActivityGenerationBatch.status == status)
    if operator_id is not None:
        query = query.where(ActivityGenerationBatch.operator_id == operator_id)

    result = await db.execute(query)
    return ok([serialize_batch(batch) for batch in result.scalars().all()])


@router.get("/drafts")
async def list_activity_batch_drafts(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(ActivityGenerationBatch, ActivityTemplate.name, func.count(ActivityBatchImage.id))
        .join(ActivityTemplate, ActivityTemplate.id == ActivityGenerationBatch.template_id, isouter=True)
        .join(ActivityBatchImage, ActivityBatchImage.batch_id == ActivityGenerationBatch.id, isouter=True)
        .where(
            ActivityGenerationBatch.operator_id == int(current_user["id"]),
            ActivityGenerationBatch.status == "draft",
        )
        .group_by(ActivityGenerationBatch.id, ActivityTemplate.name)
        .order_by(ActivityGenerationBatch.created_at.desc())
    )
    return ok(
        [
            {
                "id": batch.id,
                "template_id": batch.template_id,
                "template_name": template_name,
                "created_at": batch.created_at.isoformat() if batch.created_at else None,
                "image_count": int(image_count or 0),
            }
            for batch, template_name, image_count in result.all()
        ]
    )


@router.get("/{id}")
async def get_activity_batch(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    batch = await get_batch_or_none(db, id)
    if batch is None:
        return error_response("Batch not found", 404)
    return ok(serialize_batch(batch))


@router.post("/{id}/refine")
async def refine_activity_batch_image(
    id: int,
    req: ActivityBatchRefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    batch = await get_batch_or_none(db, id)
    if batch is None:
        return error_response("Batch not found", 404)
    if len(batch.images) >= batch.max_images:
        return error_response("Batch image limit reached", 400)

    source_image = next((image for image in batch.images if image.id == req.image_id), None)
    if source_image is None:
        return error_response("Batch image not found", 404)

    model_result = await db.execute(select(ModelConfig).where(ModelConfig.id == batch.model_config_id))
    model_config = model_result.scalar_one_or_none()
    if model_config is None:
        return error_response("Model config not found", 404)

    prompt_rendered = "\n\n".join(
        part
        for part in [clean_prompt_part(source_image.prompt_rendered), clean_prompt_part(req.refine_prompt)]
        if part
    )
    generation_request = ImageGenerateRequest(
        task_id=int(batch.task_id),
        model_config_id=int(batch.model_config_id),
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        mode="final",
        prompt=prompt_rendered,
        size=batch.ad_size,
        count=1,
    )
    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls=[source_image.image_url] if source_image.image_url else [],
        user_id=int(current_user["id"]),
    )
    image_url = first_generated_image_url(generation)
    if image_url is None:
        return error_response("Image generation returned no image URL", 502)

    max_sort_order = max((image.sort_order for image in batch.images), default=-1)
    batch_image = ActivityBatchImage(
        batch_id=batch.id,
        image_url=image_url,
        refine_prompt=req.refine_prompt,
        parent_image_id=source_image.id,
        prompt_rendered=prompt_rendered,
        status="done",
        cost_usd=decimal_value(generation.cost_usd),
        token_used=generation.token_used,
        sort_order=max_sort_order + 1,
    )
    db.add(batch_image)
    await db.commit()
    await db.refresh(batch_image)
    return ok(ActivityBatchImageResponse.model_validate(batch_image).model_dump(mode="json"))


@router.post("/{id}/archive-image")
async def archive_activity_batch_image(
    id: int,
    req: ActivityBatchArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    batch = await get_batch_or_none(db, id)
    if batch is None:
        return error_response("Batch not found", 404)

    image = await get_batch_image_or_none(db, id, req.image_id)
    if image is None:
        return error_response("Batch image not found", 404)
    if not image.image_url:
        return error_response("Batch image has no image URL", 400)

    template, template_type = await get_template_and_type(db, batch.template_id)
    final_image = FinalImage(
        task_id=batch.task_id,
        task_image_id=None,
        image_url=image.image_url,
        prompt_used=image.prompt_rendered,
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
        gallery_tag = tag_result.scalar_one_or_none()
        if gallery_tag is not None:
            gallery_tag.image_count += 1
        else:
            db.add(
                GalleryTag(
                    name=final_image.style_tag,
                    source_type=final_image.source_type,
                    image_count=1,
                )
            )

    image.status = "archived"
    completed = await mark_batch_completed_if_done(db, batch)
    if completed:
        await complete_activity_batch_workflow_session(db, batch)
    await db.commit()
    await db.refresh(image)
    return ok(
        {
            "completed": completed,
            "image": ActivityBatchImageResponse.model_validate(image).model_dump(mode="json"),
        }
    )


@router.post("/{id}/delete-image")
async def delete_activity_batch_image(
    id: int,
    req: ActivityBatchArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    batch = await get_batch_or_none(db, id)
    if batch is None:
        return error_response("Batch not found", 404)

    image = await get_batch_image_or_none(db, id, req.image_id)
    if image is None:
        return error_response("Batch image not found", 404)

    image.status = "deleted"
    completed = await mark_batch_completed_if_done(db, batch)
    if completed:
        await complete_activity_batch_workflow_session(db, batch)
    await db.commit()
    return ok({"completed": completed})


@router.post("/{id}/save-draft")
async def save_activity_batch_draft(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    batch = await get_batch_or_none(db, id)
    if batch is None:
        return error_response("Batch not found", 404)

    batch.status = "draft"
    await update_activity_batch_workflow_session(db, batch, status="draft", current_step=4)
    await db.commit()
    return ok({"id": id, "status": "draft"})
