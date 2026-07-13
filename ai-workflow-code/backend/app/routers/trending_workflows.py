from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.models.model_config import ModelConfig
from app.models.trending import TrendingJob, TrendingTopicTypeConfig
from app.models.workflow_session import WorkflowSession
from app.schemas.generate import ImageGenerateRequest
from app.schemas.trending import (
    TrendingArchiveRequest,
    TrendingGenerateRequest,
    TrendingJobCreate,
    TrendingJobResponse,
    TrendingJobUpdate,
    TrendingRefineRequest,
    TrendingTopicTypeConfigResponse,
)
from app.services import ai_gateway
from app.services.trending_prompt import (
    build_draft_prompt,
    build_final_prompt,
    build_refine_prompt,
)
from app.utils.response import ok


router = APIRouter()

RISK_ORDER = {"HIGH": 2, "MEDIUM": 1, "LOW": 0}


def serialize_job(job: TrendingJob) -> dict[str, Any]:
    return TrendingJobResponse.model_validate(job).model_dump(mode="json")


def serialize_config(config: TrendingTopicTypeConfig) -> dict[str, Any]:
    return TrendingTopicTypeConfigResponse.model_validate(config).model_dump(mode="json")


def extract_image_urls(generation: Any) -> list[str]:
    image_urls = getattr(generation, "image_urls", None)
    if isinstance(image_urls, list):
        return [url for url in image_urls if isinstance(url, str) and url]

    images = getattr(generation, "images", None)
    if not isinstance(images, list):
        return []

    urls: list[str] = []
    for item in images:
        if isinstance(item, dict):
            url = item.get("url")
            if isinstance(url, str) and url:
                urls.append(url)
    return urls


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


async def get_job_or_404(db: AsyncSession, job_id: int) -> TrendingJob:
    result = await db.execute(select(TrendingJob).where(TrendingJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/topic-configs")
async def list_topic_configs(
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(TrendingTopicTypeConfig)
        .where(TrendingTopicTypeConfig.is_active.is_(True))
        .order_by(TrendingTopicTypeConfig.id.asc())
    )
    configs = [serialize_config(item) for item in result.scalars().all()]
    return ok(configs)


@router.post("/jobs/create")
async def create_trending_job(
    body: TrendingJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(TrendingTopicTypeConfig).where(
            TrendingTopicTypeConfig.topic_type == body.topic_type,
            TrendingTopicTypeConfig.is_active.is_(True),
        )
    )
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=400, detail=f"Unknown topic_type: {body.topic_type}")

    risk_level = config.risk_level
    if body.risk_level_override:
        override_order = RISK_ORDER.get(body.risk_level_override, -1)
        config_order = RISK_ORDER.get(config.risk_level, 0)
        if override_order <= config_order:
            risk_level = body.risk_level_override

    allow_game_integration = config.allow_game_integration
    if body.disable_game_integration:
        allow_game_integration = False

    job = TrendingJob(
        news_title=body.news_title,
        publish_time=body.publish_time,
        topic_type=body.topic_type,
        risk_level=risk_level,
        allow_game_integration=allow_game_integration,
        ad_size=body.ad_size or "1080x1080",
        image_language=body.image_language or "english",
        session_id=body.session_id,
        task_id=body.task_id,
        created_by=int(current_user["id"]),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return ok(serialize_job(job))


@router.get("/jobs/{job_id}")
async def get_trending_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)
    return ok(serialize_job(job))


@router.patch("/jobs/{job_id}")
async def update_trending_job(
    job_id: int,
    body: TrendingJobUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)
    if body.selected_angle is not None:
        job.selected_angle = body.selected_angle
    if body.selected_image_type is not None:
        job.selected_image_type = body.selected_image_type
    if body.selected_action is not None:
        job.selected_action = body.selected_action
    if body.copy_text is not None:
        job.copy_text = body.copy_text
    await db.commit()
    await db.refresh(job)
    return ok(serialize_job(job))


@router.post("/jobs/{job_id}/generate-draft")
async def generate_draft(
    job_id: int,
    body: TrendingGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)

    config_result = await db.execute(
        select(TrendingTopicTypeConfig).where(
            TrendingTopicTypeConfig.topic_type == job.topic_type
        )
    )
    config = config_result.scalar_one_or_none()
    copy_style = config.copy_style if config is not None else "NEUTRAL"

    prompt_text = build_draft_prompt(
        news_title=job.news_title,
        selected_angle=job.selected_angle or "REACTION",
        selected_action=job.selected_action or "",
        selected_image_type=job.selected_image_type or "REACTION",
        risk_level=job.risk_level,
        allow_game_integration=job.allow_game_integration,
        copy_style=copy_style,
        image_language=job.image_language,
        extra_prompt=body.extra_prompt,
    )
    reference_image_urls = await resolve_reference_image_urls(db, body.reference_asset_ids or [])

    model_result = await db.execute(
        select(ModelConfig).where(ModelConfig.id == body.model_config_id)
    )
    model_cfg = model_result.scalar_one_or_none()
    if not model_cfg:
        raise HTTPException(status_code=400, detail="Model config not found")

    generation_request = ImageGenerateRequest(
        task_id=job.task_id or 0,
        model_config_id=body.model_config_id,
        model_provider=model_cfg.provider,
        model_name=model_cfg.model_name,
        prompt=prompt_text,
        size=job.ad_size,
        count=body.count,
    )

    job.status = "generating"
    await db.commit()

    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls,
        user_id=int(current_user["id"]),
    )
    image_urls = extract_image_urls(generation)
    job.draft_image_url = image_urls[0] if image_urls else None
    job.status = "draft_done"
    await db.commit()
    await db.refresh(job)

    return ok(
        {
            "job": serialize_job(job),
            "image_urls": image_urls,
        }
    )


@router.post("/jobs/{job_id}/generate-final")
async def generate_final(
    job_id: int,
    body: TrendingGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)

    config_result = await db.execute(
        select(TrendingTopicTypeConfig).where(
            TrendingTopicTypeConfig.topic_type == job.topic_type
        )
    )
    config = config_result.scalar_one_or_none()
    copy_style = config.copy_style if config is not None else "NEUTRAL"

    prompt_text = build_final_prompt(
        news_title=job.news_title,
        selected_angle=job.selected_angle or "REACTION",
        selected_action=job.selected_action or "",
        selected_image_type=job.selected_image_type or "REACTION",
        risk_level=job.risk_level,
        allow_game_integration=job.allow_game_integration,
        copy_style=copy_style,
        ad_size=job.ad_size,
        image_language=job.image_language,
        extra_prompt=body.extra_prompt,
    )
    reference_image_urls = await resolve_reference_image_urls(db, body.reference_asset_ids or [])

    model_result = await db.execute(
        select(ModelConfig).where(ModelConfig.id == body.model_config_id)
    )
    model_cfg = model_result.scalar_one_or_none()
    if not model_cfg:
        raise HTTPException(status_code=400, detail="Model config not found")

    generation_request = ImageGenerateRequest(
        task_id=job.task_id or 0,
        model_config_id=body.model_config_id,
        model_provider=model_cfg.provider,
        model_name=model_cfg.model_name,
        prompt=prompt_text,
        size=job.ad_size,
        count=body.count,
    )

    job.status = "generating"
    await db.commit()

    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls,
        user_id=int(current_user["id"]),
    )
    image_urls = extract_image_urls(generation)
    job.final_image_url = image_urls[0] if image_urls else None
    job.status = "final_done"
    await db.commit()
    await db.refresh(job)

    return ok(
        {
            "job": serialize_job(job),
            "image_urls": image_urls,
        }
    )


@router.post("/jobs/{job_id}/refine")
async def refine_image(
    job_id: int,
    body: TrendingRefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)

    base_value = job.final_image_url or job.draft_image_url or ""
    prompt_text = build_refine_prompt(
        original_prompt=base_value,
        refine_instructions=body.refine_prompt,
    )
    reference_image_urls = await resolve_reference_image_urls(db, body.reference_asset_ids or [])

    model_result = await db.execute(
        select(ModelConfig).where(ModelConfig.id == body.model_config_id)
    )
    model_cfg = model_result.scalar_one_or_none()
    if not model_cfg:
        raise HTTPException(status_code=400, detail="Model config not found")

    generation_request = ImageGenerateRequest(
        task_id=job.task_id or 0,
        model_config_id=body.model_config_id,
        model_provider=model_cfg.provider,
        model_name=model_cfg.model_name,
        prompt=prompt_text,
        size=job.ad_size,
        count=1,
    )

    generation = await ai_gateway.generate_image(
        db,
        generation_request,
        reference_image_urls,
        user_id=int(current_user["id"]),
    )
    image_urls = extract_image_urls(generation)
    if image_urls:
        job.refined_image_url = image_urls[0]
    await db.commit()
    await db.refresh(job)

    return ok(
        {
            "job": serialize_job(job),
            "image_urls": image_urls,
        }
    )


@router.post("/jobs/{job_id}/archive")
async def archive_trending_job(
    job_id: int,
    body: TrendingArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)

    image_url = body.image_url or job.refined_image_url or job.final_image_url
    if not image_url:
        raise HTTPException(status_code=400, detail="No image URL to archive")

    final_image = FinalImage(
        task_id=job.task_id,
        image_url=image_url,
        source_type="trending",
        sub_category=job.topic_type,
        created_by=int(current_user["id"]),
    )
    db.add(final_image)

    tag_result = await db.execute(select(GalleryTag).where(GalleryTag.name == "trending"))
    tag = tag_result.scalar_one_or_none()
    if tag is None:
        db.add(GalleryTag(name="trending", source_type="trending", image_count=1))
    else:
        tag.image_count = int(tag.image_count or 0) + 1

    if job.session_id is not None:
        session_result = await db.execute(
            select(WorkflowSession).where(WorkflowSession.id == job.session_id)
        )
        session = session_result.scalar_one_or_none()
        if session is not None:
            session.status = "completed"

    job.status = "archived"
    await db.commit()

    return ok({"archived": True, "image_url": image_url})
