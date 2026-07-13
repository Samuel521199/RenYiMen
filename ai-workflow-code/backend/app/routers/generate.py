import logging
import traceback
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.image import TaskImage
from app.models.image import GenerationLog
from app.models.user_model_permission import UserModelPermission
from app.schemas.generate import GenerationLogResponse, ImageGenerateRequest
from app.services import ai_gateway, cost_service
from app.utils.response import ok


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def user_has_model_permission(
    db: AsyncSession,
    user_id: int,
    model_config_id: int,
    role: str | None,
) -> bool:
    if role == "admin":
        return True
    result = await db.execute(
        select(UserModelPermission).where(
            UserModelPermission.user_id == user_id,
            UserModelPermission.model_config_id == model_config_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def resolve_reference_image_urls(
    db: AsyncSession | None,
    req: ImageGenerateRequest,
) -> list[str]:
    if db is None:
        return []

    urls: list[str] = []
    if req.reference_asset_ids:
        result = await db.execute(select(Asset).where(Asset.id.in_(req.reference_asset_ids)))
        assets = result.scalars().all()
        assets_by_id = {asset.id: asset for asset in assets}
        urls.extend(
            assets_by_id[asset_id].url
            for asset_id in req.reference_asset_ids
            if asset_id in assets_by_id and assets_by_id[asset_id].url
        )

    if req.draft_image_id is not None:
        result = await db.execute(select(TaskImage).where(TaskImage.id == req.draft_image_id))
        draft_image = result.scalar_one_or_none()
        if draft_image and draft_image.image_url:
            urls.append(draft_image.image_url)

    return urls


@router.post("/api/generate/image")
async def generate_image(
    req: ImageGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        has_permission = await user_has_model_permission(
            db,
            int(current_user["id"]),
            req.model_config_id,
            current_user.get("role"),
        )
        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No permission to use this model",
            )

        reference_image_urls = await resolve_reference_image_urls(db, req)
        response = await ai_gateway.generate_image(
            db,
            req,
            reference_image_urls=reference_image_urls,
            user_id=int(current_user["id"]),
        )
        await cost_service.log_generation_cost(
            db,
            task_id=req.task_id,
            operator_id=int(current_user["id"]),
            provider=response.model_provider,
            model_name=response.model_name,
            prompt=req.prompt,
            image_count=len(response.images),
            token_used=response.token_used,
        )
        return ok(response.model_dump(mode="json"))
    except Exception:
        logger.error(f"Generate route error: {traceback.format_exc()}")
        raise


@router.get("/api/generate/logs")
async def list_generation_logs(
    task_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(GenerationLog).order_by(GenerationLog.id.desc())
    if task_id is not None:
        query = query.where(GenerationLog.task_id == task_id)
    result = await db.execute(query)
    logs = [GenerationLogResponse.model_validate(log) for log in result.scalars().all()]
    return ok([log.model_dump(mode="json") for log in logs])
