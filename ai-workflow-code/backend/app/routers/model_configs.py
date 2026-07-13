from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.model_config import ModelConfig
from app.schemas.model_config import (
    ModelConfigCreate,
    ModelConfigResponse,
    ModelConfigUpdate,
)
from app.services.model_config_utils import is_video_model_config
from app.services.model_permission_service import sync_all_users_model_permissions
from app.utils.response import ok


router = APIRouter()


def serialize_model_config(config: ModelConfig) -> dict[str, Any]:
    return ModelConfigResponse.from_model(config).model_dump(mode="json")


async def get_model_config_or_404(db: AsyncSession, config_id: int) -> ModelConfig:
    result = await db.execute(select(ModelConfig).where(ModelConfig.id == config_id))
    config = result.scalar_one_or_none()
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Model config not found",
        )
    return config


@router.post("/api/model-configs/create")
async def create_model_config(
    req: ModelConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    config = ModelConfig(**req.model_dump())
    db.add(config)
    await db.commit()
    await db.refresh(config)
    await sync_all_users_model_permissions(db)
    return ok(serialize_model_config(config))


@router.get("/api/model-configs")
async def list_model_configs(
    purpose: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(ModelConfig)
    if purpose:
        query = query.where(ModelConfig.purpose == purpose)
    result = await db.execute(query.order_by(ModelConfig.id.desc()))
    configs = [serialize_model_config(config) for config in result.scalars().all()]
    return ok(configs)


@router.get("/api/model-configs/video")
async def list_video_model_configs(
    usage: str = "draft",
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Return active video model configs filtered by purpose and keyword match."""
    purpose = "video_draft" if usage == "draft" else "video_final"
    result = await db.execute(
        select(ModelConfig).where(
            ModelConfig.active == True,  # noqa: E712
            ModelConfig.purpose == purpose,
        )
    )
    configs = result.scalars().all()
    filtered = [
        config
        for config in configs
        if config.provider == "kling_video"
        or is_video_model_config(
            provider=config.provider,
            model_name=config.model_name,
            name=config.name,
        )
    ]
    return ok([serialize_model_config(config) for config in filtered])


@router.put("/api/model-configs/{id}")
async def update_model_config(
    id: int,
    req: ModelConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    config = await get_model_config_or_404(db, id)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    await db.commit()
    await db.refresh(config)
    return ok(serialize_model_config(config))


@router.delete("/api/model-configs/{id}")
async def delete_model_config(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    config = await get_model_config_or_404(db, id)
    await db.delete(config)
    await db.commit()
    return ok({"deleted": id})


@router.patch("/api/model-configs/{id}/toggle")
async def toggle_model_config(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    config = await get_model_config_or_404(db, id)
    config.active = not config.active
    await db.commit()
    await db.refresh(config)
    await sync_all_users_model_permissions(db)
    return ok(serialize_model_config(config))
