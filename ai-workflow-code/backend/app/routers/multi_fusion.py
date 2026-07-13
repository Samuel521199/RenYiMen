import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.model_config import ModelConfig
from app.models.multi_fusion import MultiFusionImage, MultiFusionJob
from app.models.user_model_permission import UserModelPermission
from app.models.workflow_session import WorkflowSession
from app.routers.generate import user_has_model_permission
from app.schemas.generate import ImageGenerateRequest
from app.schemas.model_config import ModelConfigResponse
from app.schemas.multi_fusion import (
    MultiFusionJobCreate,
    MultiFusionJobGenerateRequest,
    MultiFusionJobResponse,
    MultiFusionImageResponse,
)
from app.services import ai_gateway
from app.services.model_config_utils import is_video_model_config
from app.services.multi_fusion_prompt import build_multi_fusion_prompt
from app.utils.response import ok


router = APIRouter()


def serialize_image(image: MultiFusionImage) -> dict[str, Any]:
    return MultiFusionImageResponse.model_validate(image).model_dump(mode="json")


def serialize_job(job: MultiFusionJob) -> dict[str, Any]:
    images = [serialize_image(image) for image in job.images]
    return MultiFusionJobResponse.model_validate(job).model_copy(update={"images": images}).model_dump(
        mode="json"
    )


def job_session_state(
    job_id: int,
    reference_asset_ids: list[int] | None = None,
    prompt: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "job_id": job_id,
        "reference_asset_ids": list(reference_asset_ids or []),
    }
    if prompt:
        payload["taskName"] = prompt[:80]
    return json.dumps(payload, ensure_ascii=False)


def serialize_model_config(config: ModelConfig) -> dict[str, Any]:
    return ModelConfigResponse.from_model(config).model_dump(mode="json")


def image_urls_from_generation(generation: Any) -> list[str]:
    urls: list[str] = []
    for item in generation.images:
        if not isinstance(item, dict):
            continue
        candidate = item.get("url") or item.get("image_url")
        if candidate:
            urls.append(candidate)
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


async def get_job_or_404(db: AsyncSession, job_id: int) -> MultiFusionJob:
    result = await db.execute(
        select(MultiFusionJob)
        .options(selectinload(MultiFusionJob.images))
        .where(MultiFusionJob.id == job_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Multi-fusion job not found")
    return job


async def resolve_model_config(
    db: AsyncSession,
    model_config_id: int,
    current_user: dict[str, Any],
) -> ModelConfig:
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == model_config_id))
    model_config = result.scalar_one_or_none()
    if model_config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model config not found")
    if not model_config.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Model config is not available for multi-fusion generation",
        )
    has_permission = await user_has_model_permission(
        db,
        int(current_user["id"]),
        model_config_id,
        current_user.get("role"),
    )
    if not has_permission:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to use this model")
    return model_config


async def query_available_model_configs(
    db: AsyncSession,
    current_user: dict[str, Any],
    mode: str | None = None,
) -> list[ModelConfig]:
    if current_user.get("role") == "admin":
        query = select(ModelConfig).where(ModelConfig.active.is_(True))
    else:
        query = (
            select(ModelConfig)
            .join(UserModelPermission, UserModelPermission.model_config_id == ModelConfig.id)
            .where(UserModelPermission.user_id == int(current_user["id"]))
            .where(ModelConfig.active.is_(True))
        )
    if mode == "refine":
        query = query.where(ModelConfig.provider == "openai")
        query = query.where(ModelConfig.usage_type.in_(["final", "both"]))
    else:
        query = query.where(ModelConfig.purpose == "image")
    query = query.order_by(ModelConfig.id.desc())
    result = await db.execute(query)
    return [
        config
        for config in result.scalars().all()
        if not is_video_model_config(
            provider=config.provider,
            model_name=config.model_name,
            name=config.name,
        )
    ]


async def upsert_workflow_session(
    db: AsyncSession,
    job: MultiFusionJob,
    current_user: dict[str, Any],
    status_value: str,
    reference_asset_ids: list[int] | None = None,
) -> WorkflowSession:
    session: WorkflowSession | None = None
    if job.session_id is not None:
        result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == job.session_id))
        session = result.scalar_one_or_none()

    if session is None:
        session = WorkflowSession(
            workflow_type="multi_fusion",
            mode="full",
            status=status_value,
            current_step=1,
            state_json=job_session_state(job.id, reference_asset_ids, job.prompt),
            task_id=None,
            created_by=int(current_user["id"]),
        )
        db.add(session)
        await db.flush()
        job.session_id = session.id
    else:
        session.workflow_type = "multi_fusion"
        session.mode = "full"
        session.status = status_value
        session.current_step = 2 if job.images else 1
        session.state_json = job_session_state(job.id, reference_asset_ids, job.prompt)

    return session


@router.post("/jobs/create")
async def create_multi_fusion_job(
    req: MultiFusionJobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    reference_asset_ids = [int(item) for item in req.reference_asset_ids if int(item) > 0][:4]
    if len(reference_asset_ids) < 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one reference image is required",
        )

    job = MultiFusionJob(
        created_by=int(current_user["id"]),
        prompt=req.prompt.strip(),
        size=(req.size or "1024x1024").strip(),
        count=max(int(req.count or 1), 1),
        reference_asset_ids=reference_asset_ids,
        status="draft",
        session_id=req.session_id,
        model_config_id=req.model_config_id,
    )
    db.add(job)
    await db.flush()
    await upsert_workflow_session(db, job, current_user, status_value="draft", reference_asset_ids=reference_asset_ids)
    await db.commit()
    job = await get_job_or_404(db, job.id)
    return ok(serialize_job(job))


@router.get("/jobs/{job_id}")
async def get_multi_fusion_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)
    return ok(serialize_job(job))


@router.get("/available-models")
async def list_available_models(
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    configs = await query_available_model_configs(db, current_user, mode=mode)
    return ok([serialize_model_config(config) for config in configs])


@router.post("/jobs/{job_id}/generate")
async def generate_multi_fusion_images(
    job_id: int,
    req: MultiFusionJobGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    job = await get_job_or_404(db, job_id)
    model_config = await resolve_model_config(db, req.model_config_id, current_user)

    reference_asset_ids = list(req.reference_asset_ids or job.reference_asset_ids or [])[:4]
    if not reference_asset_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one reference image is required",
        )
    reference_image_urls = await resolve_reference_image_urls(db, reference_asset_ids)
    if not reference_image_urls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Reference images could not be resolved",
        )

    generate_count = 1 if req.regenerate_image_id is not None else max(int(req.count or job.count or 1), 1)
    prompt = build_multi_fusion_prompt(job.prompt, len(reference_image_urls))

    if req.regenerate_image_id is not None:
        try:
            generation = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=job.id,
                    model_config_id=model_config.id,
                    model_provider=model_config.provider,
                    model_name=model_config.model_name,
                    mode="final",
                    prompt=prompt,
                    size=job.size,
                    count=1,
                ),
                reference_image_urls=reference_image_urls,
                user_id=int(current_user["id"]),
            )
        except HTTPException as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc.detail)) from exc
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
        image_urls = image_urls_from_generation(generation)
    else:
        image_urls: list[str] = []
        for _ in range(generate_count):
            try:
                generation = await ai_gateway.generate_image(
                    db,
                    ImageGenerateRequest(
                        task_id=job.id,
                        model_config_id=model_config.id,
                        model_provider=model_config.provider,
                        model_name=model_config.model_name,
                        mode="final",
                        prompt=prompt,
                        size=job.size,
                        count=1,
                    ),
                    reference_image_urls=reference_image_urls,
                    user_id=int(current_user["id"]),
                )
            except Exception:
                continue
            image_urls.extend(image_urls_from_generation(generation))

    if not image_urls:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Image generation returned no image URL")

    if req.regenerate_image_id is not None:
        image = await db.get(MultiFusionImage, req.regenerate_image_id)
        if image is None or image.job_id != job.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image does not belong to job")
        image.image_url = image_urls[0]
        image.thumbnail_url = image_urls[0]
    else:
        for image_url in image_urls:
            db.add(
                MultiFusionImage(
                    job_id=job.id,
                    image_url=image_url,
                    thumbnail_url=image_url,
                )
            )

    job.status = "active"
    job.model_config_id = model_config.id
    job.reference_asset_ids = reference_asset_ids
    job.count = generate_count
    await upsert_workflow_session(
        db,
        job,
        current_user,
        status_value="draft",
        reference_asset_ids=reference_asset_ids,
    )
    await db.commit()
    job = await get_job_or_404(db, job.id)
    return ok(serialize_job(job))
