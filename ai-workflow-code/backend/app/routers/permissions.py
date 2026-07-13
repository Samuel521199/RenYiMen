from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.model_config import ModelConfig
from app.models.user import User
from app.models.user_model_permission import UserModelPermission
from app.schemas.model_config import ModelConfigResponse
from app.schemas.user_model_permission import PermissionGrant, PermissionLimitsUpdate
from app.services.model_config_utils import is_video_model_config
from app.services.quota_service import refresh_permission_quota_counters, refresh_user_quota_counters
from app.utils.response import ok


router = APIRouter()


def is_admin_user(current_user: dict[str, Any]) -> bool:
    return bool(current_user.get("is_admin")) or current_user.get("role") == "admin"


def require_admin(current_user: dict[str, Any]) -> None:
    if not is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def serialize_permission(
    permission: UserModelPermission,
    user: User,
    model_config: ModelConfig,
) -> dict[str, Any]:
    return {
        "user_id": permission.user_id,
        "model_config_id": permission.model_config_id,
        "model_name": model_config.model_name,
        "username": user.username,
        "daily_token_limit": int(permission.daily_token_limit or 0),
        "daily_cost_limit": str(permission.daily_cost_limit or 0),
        "daily_image_limit": int(permission.daily_image_limit or 0),
        "used_today_tokens": int(permission.used_today_tokens or 0),
        "used_today_cost": str(permission.used_today_cost or 0),
        "used_today_images": int(permission.used_today_images or 0),
        "usage_reset_date": permission.usage_reset_date.isoformat() if permission.usage_reset_date else None,
        "created_at": permission.created_at.isoformat() if permission.created_at else None,
    }


async def ensure_user_and_model(
    db: AsyncSession,
    user_id: int,
    model_config_id: int,
) -> tuple[User, ModelConfig]:
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    model_result = await db.execute(select(ModelConfig).where(ModelConfig.id == model_config_id))
    model_config = model_result.scalar_one_or_none()
    if model_config is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model config not found")

    return user, model_config


@router.post("/api/permissions/grant")
async def grant_permission(
    req: PermissionGrant,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user, model_config = await ensure_user_and_model(db, req.user_id, req.model_config_id)

    existing_result = await db.execute(
        select(UserModelPermission).where(
            UserModelPermission.user_id == req.user_id,
            UserModelPermission.model_config_id == req.model_config_id,
        )
    )
    permission = existing_result.scalar_one_or_none()
    if permission is None:
        permission = UserModelPermission(
            user_id=req.user_id,
            model_config_id=req.model_config_id,
            granted_by=int(current_user["id"]),
        )
        db.add(permission)

    permission.daily_token_limit = req.daily_token_limit
    permission.daily_cost_limit = req.daily_cost_limit
    permission.daily_image_limit = req.daily_image_limit
    await db.commit()
    await db.refresh(permission)
    await refresh_permission_quota_counters(db, permission)

    return ok(serialize_permission(permission, user, model_config))


@router.put("/api/permissions/limits")
async def update_permission_limits(
    req: PermissionLimitsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user, model_config = await ensure_user_and_model(db, req.user_id, req.model_config_id)

    result = await db.execute(
        select(UserModelPermission).where(
            UserModelPermission.user_id == req.user_id,
            UserModelPermission.model_config_id == req.model_config_id,
        )
    )
    permission = result.scalar_one_or_none()
    if permission is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Permission not found")

    permission.daily_token_limit = req.daily_token_limit
    permission.daily_cost_limit = req.daily_cost_limit
    permission.daily_image_limit = req.daily_image_limit
    await db.commit()
    await db.refresh(permission)
    await refresh_permission_quota_counters(db, permission)

    return ok(serialize_permission(permission, user, model_config))


@router.delete("/api/permissions/revoke")
async def revoke_permission(
    req: PermissionGrant,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    result = await db.execute(
        delete(UserModelPermission)
        .where(UserModelPermission.user_id == req.user_id)
        .where(UserModelPermission.model_config_id == req.model_config_id)
    )
    await db.commit()
    return ok({"revoked": result.rowcount or 0})


@router.get("/api/permissions/user/{user_id}")
async def list_user_permissions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    result = await db.execute(
        select(UserModelPermission, User, ModelConfig)
        .join(User, User.id == UserModelPermission.user_id)
        .join(ModelConfig, ModelConfig.id == UserModelPermission.model_config_id)
        .where(UserModelPermission.user_id == user_id)
        .order_by(UserModelPermission.id.desc())
    )
    permissions = []
    for permission, user, model_config in result.all():
        await refresh_permission_quota_counters(db, permission)
        permissions.append(serialize_permission(permission, user, model_config))
    return ok(permissions)


@router.get("/api/model-configs/available")
async def list_available_model_configs(
    purpose: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if current_user.get("role") == "admin":
        query = select(ModelConfig).where(ModelConfig.active.is_(True)).order_by(ModelConfig.id.desc())
    else:
        query = (
            select(ModelConfig)
            .join(
                UserModelPermission,
                UserModelPermission.model_config_id == ModelConfig.id,
            )
            .where(UserModelPermission.user_id == int(current_user["id"]))
            .where(ModelConfig.active.is_(True))
            .order_by(ModelConfig.id.desc())
        )

    if purpose:
        query = query.where(ModelConfig.purpose == purpose)

    result = await db.execute(query)
    configs = [
        ModelConfigResponse.from_model(config).model_dump(mode="json")
        for config in result.scalars().all()
        if not (purpose == "image" and is_video_model_config(
            provider=config.provider,
            model_name=config.model_name,
            name=config.name,
        ))
    ]
    return ok(configs)
