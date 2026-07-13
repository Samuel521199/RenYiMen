from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.model_config import ModelConfig
from app.models.user_model_api_key import UserModelApiKey
from app.schemas.user_model_api_key import UserModelApiKeyItemResponse, UserModelApiKeyUpsertRequest
from app.services.user_model_api_key_service import (
    CUSTOMIZABLE_MODEL_CONFIG_IDS,
    is_customizable_model_config_id,
    mask_api_key_last4,
    resolve_effective_api_key,
)
from app.utils.response import ok


router = APIRouter()


def _require_customizable_model(model_config_id: int) -> None:
    if not is_customizable_model_config_id(model_config_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This model does not support custom API keys",
        )


@router.get("/api/user-model-api-keys")
async def list_user_model_api_keys(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    user_id = int(current_user["id"])

    model_result = await db.execute(
        select(ModelConfig)
        .where(ModelConfig.id.in_(CUSTOMIZABLE_MODEL_CONFIG_IDS))
        .order_by(ModelConfig.id.asc())
    )
    models = list(model_result.scalars().all())

    override_result = await db.execute(
        select(UserModelApiKey).where(
            UserModelApiKey.user_id == user_id,
            UserModelApiKey.model_config_id.in_(CUSTOMIZABLE_MODEL_CONFIG_IDS),
        )
    )
    overrides = {
        row.model_config_id: row for row in override_result.scalars().all()
    }

    items: list[dict[str, Any]] = []
    for model in models:
        override = overrides.get(model.id)
        has_custom_key = override is not None and bool((override.api_key or "").strip())
        if has_custom_key and override is not None:
            display_key = override.api_key
            updated_at = override.updated_at
        else:
            display_key = model.api_key
            updated_at = None

        item = UserModelApiKeyItemResponse(
            model_config_id=model.id,
            name=model.name,
            provider=model.provider,
            model_name=model.model_name,
            api_key_last4=mask_api_key_last4(display_key),
            has_custom_key=has_custom_key,
            updated_at=updated_at,
        )
        items.append(item.model_dump(mode="json"))

    return ok(items)


@router.put("/api/user-model-api-keys/{model_config_id}")
async def upsert_user_model_api_key(
    model_config_id: int,
    req: UserModelApiKeyUpsertRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _require_customizable_model(model_config_id)
    user_id = int(current_user["id"])
    api_key = req.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API key is required")

    model_result = await db.execute(
        select(ModelConfig).where(
            ModelConfig.id == model_config_id,
            ModelConfig.active.is_(True),
        )
    )
    model = model_result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model config not found")

    result = await db.execute(
        select(UserModelApiKey).where(
            UserModelApiKey.user_id == user_id,
            UserModelApiKey.model_config_id == model_config_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = UserModelApiKey(
            user_id=user_id,
            model_config_id=model_config_id,
            api_key=api_key,
        )
        db.add(row)
    else:
        row.api_key = api_key

    await db.commit()
    await db.refresh(row)

    item = UserModelApiKeyItemResponse(
        model_config_id=model.id,
        name=model.name,
        provider=model.provider,
        model_name=model.model_name,
        api_key_last4=mask_api_key_last4(api_key),
        has_custom_key=True,
        updated_at=row.updated_at,
    )
    return ok(item.model_dump(mode="json"))


@router.delete("/api/user-model-api-keys/{model_config_id}")
async def delete_user_model_api_key(
    model_config_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _require_customizable_model(model_config_id)
    user_id = int(current_user["id"])

    model_result = await db.execute(
        select(ModelConfig).where(ModelConfig.id == model_config_id)
    )
    model = model_result.scalar_one_or_none()
    if model is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model config not found")

    result = await db.execute(
        select(UserModelApiKey).where(
            UserModelApiKey.user_id == user_id,
            UserModelApiKey.model_config_id == model_config_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()

    effective_key = await resolve_effective_api_key(db, user_id, model)
    item = UserModelApiKeyItemResponse(
        model_config_id=model.id,
        name=model.name,
        provider=model.provider,
        model_name=model.model_name,
        api_key_last4=mask_api_key_last4(effective_key),
        has_custom_key=False,
        updated_at=None,
    )
    return ok(item.model_dump(mode="json"))
