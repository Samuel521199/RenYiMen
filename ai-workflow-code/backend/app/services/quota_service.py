from datetime import date
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.user_model_permission import UserModelPermission


def _limit_enabled(value: int | Decimal | None) -> bool:
    if value is None:
        return False
    return Decimal(value) > 0


async def refresh_user_quota_counters(db: AsyncSession, user: User) -> None:
    today = date.today()
    if user.usage_reset_date == today:
        return
    user.used_today_tokens = 0
    user.used_today_cost = Decimal("0")
    user.usage_reset_date = today


async def refresh_permission_quota_counters(
    db: AsyncSession,
    permission: UserModelPermission,
) -> None:
    today = date.today()
    if permission.usage_reset_date == today:
        return
    permission.used_today_tokens = 0
    permission.used_today_cost = Decimal("0")
    permission.used_today_images = 0
    permission.usage_reset_date = today


async def get_user_permission(
    db: AsyncSession,
    user_id: int,
    model_config_id: int,
) -> UserModelPermission | None:
    result = await db.execute(
        select(UserModelPermission).where(
            UserModelPermission.user_id == user_id,
            UserModelPermission.model_config_id == model_config_id,
        )
    )
    return result.scalar_one_or_none()


async def assert_generation_quota(
    db: AsyncSession,
    user_id: int,
    model_config_id: int,
    *,
    image_count: int = 1,
) -> None:
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role == "admin":
        return

    await refresh_user_quota_counters(db, user)
    permission = await get_user_permission(db, user_id, model_config_id)
    if permission is not None:
        await refresh_permission_quota_counters(db, permission)

    if _limit_enabled(user.daily_token_limit):
        if int(user.used_today_tokens or 0) >= int(user.daily_token_limit):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily token limit exceeded for this user",
            )

    if _limit_enabled(user.daily_cost_limit):
        if Decimal(user.used_today_cost or 0) >= Decimal(user.daily_cost_limit):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily cost limit exceeded for this user",
            )

    if permission is None:
        return

    if _limit_enabled(permission.daily_token_limit):
        if int(permission.used_today_tokens or 0) >= int(permission.daily_token_limit):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily token limit exceeded for this model",
            )

    if _limit_enabled(permission.daily_cost_limit):
        if Decimal(permission.used_today_cost or 0) >= Decimal(permission.daily_cost_limit):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily cost limit exceeded for this model",
            )

    if _limit_enabled(permission.daily_image_limit):
        if int(permission.used_today_images or 0) + image_count > int(permission.daily_image_limit):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Daily image limit exceeded for this model",
            )


async def record_generation_quota_usage(
    db: AsyncSession,
    user_id: int,
    model_config_id: int,
    *,
    token_used: int,
    cost_usd: Decimal,
    image_count: int = 1,
) -> None:
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if user is None or user.role == "admin":
        return

    await refresh_user_quota_counters(db, user)
    user.used_today_tokens = int(user.used_today_tokens or 0) + int(token_used or 0)
    user.used_today_cost = Decimal(user.used_today_cost or 0) + Decimal(cost_usd or 0)

    permission = await get_user_permission(db, user_id, model_config_id)
    if permission is not None:
        await refresh_permission_quota_counters(db, permission)
        permission.used_today_tokens = int(permission.used_today_tokens or 0) + int(token_used or 0)
        permission.used_today_cost = Decimal(permission.used_today_cost or 0) + Decimal(cost_usd or 0)
        permission.used_today_images = int(permission.used_today_images or 0) + int(image_count or 0)

    await db.commit()
