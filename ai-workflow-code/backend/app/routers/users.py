from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.user import ApiKey, User
from app.schemas.auth import UserInfo
from app.schemas.user_model_permission import UserQuotaUpdate
from app.services.model_permission_service import ensure_user_model_permissions
from app.services.quota_service import refresh_user_quota_counters
from app.services.user_permissions import (
    DENY_ALL_PERMISSIONS,
    user_permissions_or_default,
)
from app.utils.response import ok
from app.utils.security import get_password_hash, verify_password


router = APIRouter()


# Re-export for admin UI baseline (all modules off until explicitly granted).
DEFAULT_PERMISSIONS = DENY_ALL_PERMISSIONS


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"


class UserStatusUpdate(BaseModel):
    status: bool


class PasswordResetRequest(BaseModel):
    new_password: str


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str


class PermissionsUpdateRequest(BaseModel):
    permissions: dict[str, Any]


class RoleSyncPolicyUpdateRequest(BaseModel):
    strategy: str
    locked: bool = False


class ApiKeyCreateRequest(BaseModel):
    provider: str
    api_key: str
    daily_limit: Decimal = Decimal("0")
    active: bool = True


def serialize_api_key(api_key: ApiKey) -> dict[str, Any]:
    last4 = (api_key.api_key or "")[-4:]
    return {
        "id": api_key.id,
        "user_id": api_key.user_id,
        "provider": api_key.provider,
        "api_key": last4,
        "api_key_last4": last4,
        "daily_limit": str(api_key.daily_limit),
        "used_today": str(api_key.used_today),
        "active": api_key.active,
        "created_at": api_key.created_at.isoformat() if api_key.created_at else None,
    }


def is_admin_user(current_user: dict[str, Any]) -> bool:
    return bool(current_user.get("is_admin")) or current_user.get("role") == "admin"


def require_admin(current_user: dict[str, Any]) -> None:
    if not is_admin_user(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


async def get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


async def serialize_user(db: AsyncSession, user: User) -> dict[str, Any]:
    if user.role != "admin":
        await refresh_user_quota_counters(db, user)
    data = UserInfo.model_validate(user).model_dump(mode="json")
    data["is_admin"] = user.role == "admin"
    data["permissions"] = user_permissions_or_default(user)
    data["daily_cost_limit"] = str(data.get("daily_cost_limit") or "0")
    data["used_today_cost"] = str(data.get("used_today_cost") or "0")
    # 管理员已显式授权标记：管理员角色始终为 True；operator 需要 _admin_granted 标记
    if user.role == "admin":
        data["permissions_granted"] = True
    else:
        perms = user.permissions or {}
        data["permissions_granted"] = bool(
            isinstance(perms, dict) and perms.get("_admin_granted", False)
        )
    return data


@router.get("/api/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    result = await db.execute(select(User).order_by(User.id.asc()))
    users = []
    for user in result.scalars().all():
        users.append(await serialize_user(db, user))
    return ok(users)


@router.get("/api/users/me")
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user = await get_user_or_404(db, int(current_user["id"]))
    return ok(await serialize_user(db, user))


@router.post("/api/users/create")
async def create_user(
    req: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = User(
        username=req.username,
        password_hash=get_password_hash(req.password),
        role=req.role,
        status=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await ensure_user_model_permissions(db, user)
    return ok(await serialize_user(db, user))


@router.post("/api/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    req: PasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    user.password_hash = get_password_hash(req.new_password)
    await db.commit()
    return ok({"success": True})


@router.post("/api/users/me/change-password")
async def change_my_password(
    req: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user = await get_user_or_404(db, int(current_user["id"]))
    if not verify_password(req.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="旧密码不正确")
    user.password_hash = get_password_hash(req.new_password)
    await db.commit()
    return ok({"success": True})


@router.get("/api/users/{user_id}/permissions")
async def get_user_permissions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    return ok(user_permissions_or_default(user))


@router.put("/api/users/{user_id}/permissions")
async def update_user_permissions(
    user_id: int,
    req: PermissionsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    if user.role == "admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="管理员权限不可修改")
    # 写入管理员显式授权标记，确保 user_permissions_or_default 不会将其视为历史默认值
    user.permissions = {**req.permissions, "_admin_granted": True}
    await db.commit()
    await db.refresh(user)
    return ok(user_permissions_or_default(user))


@router.get("/api/users/{user_id}/quota")
async def get_user_quota(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    await refresh_user_quota_counters(db, user)
    return ok({
        "user_id": user.id,
        "daily_token_limit": int(user.daily_token_limit or 0),
        "daily_cost_limit": str(user.daily_cost_limit or 0),
        "used_today_tokens": int(user.used_today_tokens or 0),
        "used_today_cost": str(user.used_today_cost or 0),
        "usage_reset_date": user.usage_reset_date.isoformat() if user.usage_reset_date else None,
    })


@router.patch("/api/users/{user_id}/quota")
async def update_user_quota(
    user_id: int,
    req: UserQuotaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    user.daily_token_limit = req.daily_token_limit
    user.daily_cost_limit = req.daily_cost_limit
    await db.commit()
    await db.refresh(user)
    await refresh_user_quota_counters(db, user)
    return ok({
        "user_id": user.id,
        "daily_token_limit": int(user.daily_token_limit or 0),
        "daily_cost_limit": str(user.daily_cost_limit or 0),
        "used_today_tokens": int(user.used_today_tokens or 0),
        "used_today_cost": str(user.used_today_cost or 0),
        "usage_reset_date": user.usage_reset_date.isoformat() if user.usage_reset_date else None,
    })


@router.post("/api/api-keys/create")
async def create_api_key(
    req: ApiKeyCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    api_key = ApiKey(
        user_id=int(current_user["id"]),
        provider=req.provider,
        api_key=req.api_key,
        daily_limit=req.daily_limit,
        active=req.active,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)
    return ok(serialize_api_key(api_key))


@router.get("/api/api-keys")
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(ApiKey).order_by(ApiKey.id.desc()))
    return ok([serialize_api_key(api_key) for api_key in result.scalars().all()])


@router.patch("/api/users/{user_id}")
async def update_user_status(
    user_id: int,
    req: UserStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    user.status = req.status
    await db.commit()
    await db.refresh(user)
    return ok(await serialize_user(db, user))


@router.patch("/api/users/{user_id}/role-sync-policy")
async def update_user_role_sync_policy(
    user_id: int,
    req: RoleSyncPolicyUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    user = await get_user_or_404(db, user_id)
    strategy = (req.strategy or "").strip().lower()
    if strategy not in {"platform_authoritative", "preserve_workbench_admin", "no_auto_downgrade"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported strategy. Use platform_authoritative|preserve_workbench_admin|no_auto_downgrade",
        )
    user.role_sync_strategy = strategy
    user.role_sync_locked = bool(req.locked)
    await db.commit()
    await db.refresh(user)
    payload = await serialize_user(db, user)
    payload["role_sync_strategy"] = user.role_sync_strategy
    payload["role_sync_locked"] = bool(user.role_sync_locked)
    return ok(payload)
