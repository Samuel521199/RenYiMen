from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_config import ModelConfig
from app.models.user_model_api_key import UserModelApiKey

CUSTOMIZABLE_MODEL_CONFIG_IDS: frozenset[int] = frozenset({6, 7, 8, 9, 10, 13, 14, 15})


def mask_api_key_last4(api_key: str | None) -> str:
    value = (api_key or "").strip()
    if not value:
        return "----"
    return value[-4:]


def is_customizable_model_config_id(model_config_id: int) -> bool:
    return model_config_id in CUSTOMIZABLE_MODEL_CONFIG_IDS


async def resolve_effective_api_key(
    db: AsyncSession,
    user_id: int | None,
    model_config: ModelConfig,
) -> str:
    default_key = (model_config.api_key or "").strip()
    if user_id is None or not is_customizable_model_config_id(model_config.id):
        return default_key

    result = await db.execute(
        select(UserModelApiKey).where(
            UserModelApiKey.user_id == user_id,
            UserModelApiKey.model_config_id == model_config.id,
        )
    )
    override = result.scalar_one_or_none()
    if override is None:
        return default_key

    custom_key = (override.api_key or "").strip()
    return custom_key or default_key


async def apply_user_api_key_override(
    db: AsyncSession,
    user_id: int | None,
    model_config: ModelConfig,
) -> ModelConfig:
    if user_id is None:
        return model_config
    model_config.api_key = await resolve_effective_api_key(db, user_id, model_config)
    return model_config
