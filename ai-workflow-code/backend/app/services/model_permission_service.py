from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_config import ModelConfig
from app.models.user import User
from app.models.user_model_permission import UserModelPermission


async def _active_model_ids(db: AsyncSession) -> list[int]:
    result = await db.execute(select(ModelConfig.id).where(ModelConfig.active.is_(True)))
    return [row[0] for row in result.all()]


async def ensure_user_model_permissions(db: AsyncSession, user: User) -> int:
    """Grant every active model to the user. Returns number of new permission rows."""
    model_ids = await _active_model_ids(db)
    if not model_ids:
        return 0

    existing_result = await db.execute(
        select(UserModelPermission.model_config_id).where(UserModelPermission.user_id == user.id)
    )
    existing_ids = {row[0] for row in existing_result.all()}
    missing_ids = [model_id for model_id in model_ids if model_id not in existing_ids]
    if not missing_ids:
        return 0

    for model_id in missing_ids:
        db.add(
            UserModelPermission(
                user_id=user.id,
                model_config_id=model_id,
                granted_by=None,
            )
        )
    await db.commit()
    return len(missing_ids)


async def sync_all_users_model_permissions(db: AsyncSession) -> int:
    """Ensure every active user has permissions for all active models."""
    users_result = await db.execute(select(User).where(User.status.is_(True)))
    users = users_result.scalars().all()
    inserted = 0
    for user in users:
        inserted += await ensure_user_model_permissions(db, user)
    return inserted
