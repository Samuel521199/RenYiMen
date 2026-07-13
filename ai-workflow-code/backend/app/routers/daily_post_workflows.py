from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload
from pydantic import BaseModel

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.daily_post import (
    DailyPostBackground,
    DailyPostBullAction,
    DailyPostColorMood,
    DailyPostJob,
    DailyPostTemplate,
)
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.models.model_config import ModelConfig
from app.models.task import Task
from app.models.workflow_session import WorkflowSession
from app.schemas.daily_post import (
    DailyPostJobCreate,
    DailyPostJobOut,
    DailyPostJobQC,
    DailyPostOptionCreate,
    DailyPostOptionOut,
    DailyPostTemplateCreate,
    DailyPostTemplateOut,
    DailyPostTemplateUpdate,
)
from app.schemas.generate import ImageGenerateRequest
from app.services import ai_gateway
from app.utils.response import err, ok


router = APIRouter()

DAILY_POST_TEMPLATE_TYPES = [
    {"value": "emotion", "label": "情绪互动"},
    {"value": "game", "label": "游戏日常"},
    {"value": "choice", "label": "二选一"},
    {"value": "meme", "label": "梗图互动"},
    {"value": "local", "label": "本地生活"},
    {"value": "character", "label": "角色日常"},
]

DAILY_POST_LANGUAGE_OPTIONS = {
    "english": "English only",
    "taglish": "Taglish (Tagalog-English mix) only",
    "chinese": "Chinese (Simplified) only",
}


class GenerateJobRequest(BaseModel):
    model_config_id: int
    reference_asset_ids: list[int] = []
    extra_prompt: str = ""
    size: str = "1080x1080"


def error_response(message: str, status_code: int) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=err(message, status_code))


def serialize_daily_post_template(template: DailyPostTemplate) -> dict[str, Any]:
    return DailyPostTemplateOut.model_validate(template).model_dump(mode="json")


def serialize_daily_post_option(option: Any) -> dict[str, Any]:
    return DailyPostOptionOut.model_validate(option).model_dump(mode="json")


def serialize_daily_post_job(job: DailyPostJob) -> dict[str, Any]:
    if getattr(job, "image_language", None) is None:
        job.image_language = "english"
    payload = DailyPostJobOut.model_validate(job).model_dump(mode="json")
    if job.template is not None:
        payload["template"] = {
            "id": job.template.id,
            "name": job.template.name,
            "template_type": job.template.template_type,
            "is_enabled": job.template.is_enabled,
        }
    return payload


async def get_template_or_none(db: AsyncSession, template_id: int) -> DailyPostTemplate | None:
    result = await db.execute(select(DailyPostTemplate).where(DailyPostTemplate.id == template_id))
    return result.scalar_one_or_none()


async def get_job_or_none(db: AsyncSession, job_id: int) -> DailyPostJob | None:
    result = await db.execute(
        select(DailyPostJob)
        .options(joinedload(DailyPostJob.template))
        .where(DailyPostJob.id == job_id)
    )
    return result.scalar_one_or_none()


async def get_next_option_sort_order(db: AsyncSession, model: type[Any]) -> int:
    result = await db.execute(select(func.coalesce(func.max(model.sort_order), 0)))
    current_max = result.scalar_one_or_none() or 0
    return int(current_max) + 1


async def list_daily_post_options(db: AsyncSession, model: type[Any]) -> list[dict[str, Any]]:
    result = await db.execute(
        select(model)
        .where(model.is_enabled.is_(True))
        .order_by(model.sort_order.asc(), model.id.asc())
    )
    return [serialize_daily_post_option(item) for item in result.scalars().all()]


async def create_daily_post_option(
    db: AsyncSession,
    model: type[Any],
    req: DailyPostOptionCreate,
) -> dict[str, Any]:
    result = await db.execute(select(model).where(model.value == req.value))
    existing = result.scalar_one_or_none()
    if existing is not None:
        return serialize_daily_post_option(existing)

    option = model(
        value=req.value,
        label_zh=req.label_zh,
        is_preset=False,
        is_enabled=True,
        sort_order=await get_next_option_sort_order(db, model),
    )
    db.add(option)
    await db.commit()
    await db.refresh(option)
    return serialize_daily_post_option(option)


async def resolve_reference_image_urls(
    db: AsyncSession,
    reference_asset_ids: list[int],
) -> list[str]:
    if not reference_asset_ids:
        return []

    selected_ids = reference_asset_ids[:4]
    result = await db.execute(select(Asset).where(Asset.id.in_(selected_ids)))
    assets_by_id = {asset.id: asset for asset in result.scalars().all()}
    return [
        assets_by_id[asset_id].url
        for asset_id in selected_ids
        if asset_id in assets_by_id and assets_by_id[asset_id].url
    ]


def build_daily_post_prompt(template: DailyPostTemplate, job: DailyPostJob, extra_prompt: str = "") -> str:
    option_a = job.option_a_override or template.option_a
    option_b = job.option_b_override or template.option_b
    option_c = job.option_c_override or template.option_c
    bull_action = job.bull_action_override or template.bull_action
    background = job.background_override or template.background

    parts = [
        "Create a single daily social interaction image for a cartoon bull character.",
        f"Template type: {template.template_type}",
        f"Today's theme: {job.today_theme}",
        f"User emotion: {job.user_emotion}",
        f"Main copy: {job.main_copy}",
        f"Interaction question: {job.interaction_question}",
    ]
    if template.title_copy:
        parts.append(f"Template title copy direction: {template.title_copy}")
    if template.interaction_copy:
        parts.append(f"Template interaction copy direction: {template.interaction_copy}")
    if option_a:
        parts.append(f"Option A: {option_a}")
    if option_b:
        parts.append(f"Option B: {option_b}")
    if option_c:
        parts.append(f"Option C: {option_c}")
    if job.aux_copy:
        parts.append(f"Auxiliary copy: {job.aux_copy}")
    if bull_action:
        parts.append(f"Bull action: {bull_action}")
    if background:
        parts.append(f"Background: {background}")
    if template.style:
        parts.append(f"Style: {template.style}")
    if template.color_mood:
        parts.append(f"Color mood: {template.color_mood}")
    if template.brand_weight:
        parts.append(f"Brand weight: {template.brand_weight}")
    if extra_prompt:
        parts.append(f"Additional instructions: {extra_prompt}")
    lang_label = DAILY_POST_LANGUAGE_OPTIONS.get(
        getattr(job, "image_language", "english"),
        "English only",
    )
    parts.append(
        f"IMPORTANT: All text visible in the image must be in {lang_label}. "
        "Do NOT use any other language for on-image text."
    )
    parts.append("The image is for Filipino Facebook audience. Keep all on-image text casual and short.")
    parts.append("Output size: 1080x1080. One finished image only.")
    return "\n".join(parts)


async def ensure_generation_task(db: AsyncSession, job: DailyPostJob, current_user_id: int) -> int:
    if job.task_id is not None:
        return job.task_id

    task = Task(
        title=f"Daily Post - {job.today_theme}",
        purpose="daily_post",
        size="1080x1080",
        description=job.main_copy,
        status="created",
        creator_id=current_user_id,
    )
    db.add(task)
    await db.flush()
    job.task_id = task.id
    return task.id


@router.get("/template-types")
async def list_template_types(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(DAILY_POST_TEMPLATE_TYPES)


@router.get("/options/bull-actions")
async def list_bull_actions(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_daily_post_options(db, DailyPostBullAction))


@router.post("/options/bull-actions")
async def create_bull_action(
    req: DailyPostOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_daily_post_option(db, DailyPostBullAction, req))


@router.get("/options/backgrounds")
async def list_backgrounds(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_daily_post_options(db, DailyPostBackground))


@router.post("/options/backgrounds")
async def create_background(
    req: DailyPostOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_daily_post_option(db, DailyPostBackground, req))


@router.get("/options/color-moods")
async def list_color_moods(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await list_daily_post_options(db, DailyPostColorMood))


@router.post("/options/color-moods")
async def create_color_mood(
    req: DailyPostOptionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(await create_daily_post_option(db, DailyPostColorMood, req))


@router.get("/templates")
async def list_templates(
    type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(DailyPostTemplate).order_by(
        DailyPostTemplate.sort_order.asc(),
        DailyPostTemplate.id.asc(),
    )
    if type is not None:
        query = query.where(DailyPostTemplate.template_type == type)

    result = await db.execute(query)
    payload = [serialize_daily_post_template(item) for item in result.scalars().all()]
    return ok(payload)


@router.post("/templates/create")
async def create_template(
    req: DailyPostTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    template = DailyPostTemplate(**req.model_dump())
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return ok(serialize_daily_post_template(template))


@router.put("/templates/{id}")
async def update_template(
    id: int,
    req: DailyPostTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(template, field, value)
    await db.commit()
    await db.refresh(template)
    return ok(serialize_daily_post_template(template))


@router.patch("/templates/{id}/toggle")
async def toggle_template(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    template.is_enabled = not template.is_enabled
    await db.commit()
    await db.refresh(template)
    return ok(serialize_daily_post_template(template))


@router.delete("/templates/{id}")
async def delete_template(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template = await get_template_or_none(db, id)
    if template is None:
        return error_response("Template not found", 404)

    await db.delete(template)
    await db.commit()
    return ok({"id": id, "deleted": True})


@router.get("/jobs")
async def list_jobs(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = (
        select(DailyPostJob)
        .options(joinedload(DailyPostJob.template))
        .order_by(DailyPostJob.created_at.desc())
        .limit(50)
    )
    if status is not None:
        query = query.where(DailyPostJob.status == status)

    result = await db.execute(query)
    payload = [serialize_daily_post_job(item) for item in result.scalars().all()]
    return ok(payload)


@router.get("/jobs/{id}")
async def get_job(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Job not found", 404)
    return ok(serialize_daily_post_job(job))


@router.post("/jobs/create")
async def create_job(
    req: DailyPostJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    template = await get_template_or_none(db, req.template_id)
    if template is None:
        return error_response("Template not found", 404)

    job = DailyPostJob(
        **req.model_dump(),
        status="draft",
        created_by=int(current_user["id"]),
    )
    db.add(job)
    await db.flush()

    session = WorkflowSession(
        workflow_type="daily_post",
        mode="full",
        status="draft",
        current_step=1,
        state_json=f'{{"job_id": {job.id}}}',
        task_id=job.task_id,
        created_by=int(current_user["id"]),
    )
    db.add(session)
    await db.flush()
    job.session_id = session.id
    await db.commit()

    job = await get_job_or_none(db, job.id)
    if job is None:
        return error_response("Job create failed", 500)
    return ok(serialize_daily_post_job(job))


@router.post("/jobs/{id}/generate")
async def generate_job(
    id: int,
    body: GenerateJobRequest = Body(default_factory=GenerateJobRequest),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Job not found", 404)
    if job.template is None:
        return error_response("Template not found", 404)

    job.model_config_id = body.model_config_id
    await db.commit()

    model_result = await db.execute(select(ModelConfig).where(ModelConfig.id == job.model_config_id))
    model_config = model_result.scalar_one_or_none()
    if model_config is None:
        return error_response("Model config not found", 404)

    task_id = await ensure_generation_task(db, job, int(current_user["id"]))
    prompt = build_daily_post_prompt(job.template, job, body.extra_prompt)
    reference_image_urls = await resolve_reference_image_urls(db, body.reference_asset_ids)
    job.status = "generating"
    await db.commit()

    generation_request = ImageGenerateRequest(
        task_id=task_id,
        model_config_id=model_config.id,
        model_provider=model_config.provider,
        model_name=model_config.model_name,
        mode="final",
        prompt=prompt,
        size=body.size,
        count=1,
        reference_asset_ids=body.reference_asset_ids,
        reference_image_urls=reference_image_urls,
    )

    try:
        generation = await ai_gateway.generate_image(
            db,
            generation_request,
            reference_image_urls,
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
            job.status = "draft"
            await db.commit()
            return error_response("Image generation returned no image URL", 502)

        job.generated_image_url = image_url
        job.cost_usd = Decimal(generation.cost_usd)
        job.status = "done"
        if job.session_id is not None:
            session_result = await db.execute(
                select(WorkflowSession).where(WorkflowSession.id == job.session_id)
            )
            session = session_result.scalar_one_or_none()
            if session is not None:
                session.task_id = job.task_id
                session.current_step = 5
                session.status = "draft"
                session.state_json = f'{{"job_id": {job.id}, "generated": true}}'
        await db.commit()
    except Exception:
        job.status = "draft"
        await db.commit()
        raise

    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Job not found", 404)
    return ok(
        {
            "job": serialize_daily_post_job(job),
            "generation": generation.model_dump(mode="json"),
        }
    )


@router.post("/jobs/{id}/qc")
async def qc_job(
    id: int,
    req: DailyPostJobQC,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> Any:
    job = await get_job_or_none(db, id)
    if job is None:
        return error_response("Job not found", 404)

    job.status = req.status
    job.archived_asset_id = req.archived_asset_id
    final_image = None
    archive_url = req.image_url or job.generated_image_url
    if req.status == "archived" and archive_url:
        gallery_tag_name = job.template.template_type if job.template else "daily_post"
        final_image = FinalImage(
            task_id=job.task_id,
            task_image_id=None,
            image_url=archive_url,
            prompt_used=None,
            tags=None,
            source_type="daily",
            sub_category=job.template.template_type if job.template else None,
            style_tag=None,
            created_by=int(current_user["id"]),
        )
        db.add(final_image)

        tag_result = await db.execute(
            select(GalleryTag).where(
                GalleryTag.name == gallery_tag_name,
                GalleryTag.source_type == "daily",
            )
        )
        existing_tag = tag_result.scalar_one_or_none()
        if existing_tag is not None:
            existing_tag.image_count += 1
        else:
            db.add(
                GalleryTag(
                    name=gallery_tag_name,
                    source_type="daily",
                    image_count=1,
                )
            )

    if job.session_id is not None:
        session_result = await db.execute(
            select(WorkflowSession).where(WorkflowSession.id == job.session_id)
        )
        session = session_result.scalar_one_or_none()
        if session is not None:
            session.current_step = 6
            session.status = "completed" if req.status == "archived" else "draft"
            session.state_json = (
                f'{{"job_id": {job.id}, "status": "{req.status}", "archived_asset_id": {req.archived_asset_id or "null"}}}'
            )
    await db.commit()
    await db.refresh(job)
    if final_image is not None:
        await db.refresh(final_image)
    return ok(serialize_daily_post_job(job))
