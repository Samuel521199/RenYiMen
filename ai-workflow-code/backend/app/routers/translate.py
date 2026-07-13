import json
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.asset_tag import AssetTag
from app.models.gallery_tag import GalleryTag
from app.models.model_config import ModelConfig


router = APIRouter(prefix="/api/translate", tags=["translate"])
logger = logging.getLogger(__name__)


class TranslateRequest(BaseModel):
    names: list[str]
    tag_type: Literal["asset", "gallery"] = "asset"


class TranslateResponse(BaseModel):
    translations: dict[str, str]


def get_tag_model(tag_type: Literal["asset", "gallery"]):
    return AssetTag if tag_type == "asset" else GalleryTag


async def _translate_batch(names: list[str], db: AsyncSession) -> dict[str, str]:
    if not names:
        return {}

    config_result = await db.execute(
        select(ModelConfig)
        .where(
            ModelConfig.provider == "openai",
            ModelConfig.active.is_(True),
            ~ModelConfig.base_url.contains("pucoding"),
        )
        .order_by(ModelConfig.id.desc())
        .limit(1)
    )
    config = config_result.scalars().first()
    if not config or not config.api_key:
        logger.warning("No active openai model config found; returning original tag names")
        return {name: name for name in names}

    api_key = config.api_key
    base_url = config.base_url or "https://api.openai.com/v1"

    prompt = (
        "You are a translator. Translate each Chinese tag name below into a short, "
        "clear English label suitable for an image management system (1-4 words each). "
        "Respond only with a JSON object mapping each original Chinese name to its English "
        "translation.\n\n"
        f"Tags: {json.dumps(names, ensure_ascii=False)}"
    )

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{base_url.rstrip('/')}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        translations = json.loads(raw)
        return {name: translations.get(name, name) for name in names}
    except Exception as exc:
        logger.error("Translation API error: %s", exc)
        return {name: name for name in names}


async def _write_translations(
    db: AsyncSession,
    tag_type: Literal["asset", "gallery"],
    mapping: dict[str, str],
) -> None:
    model = get_tag_model(tag_type)
    for zh_name, en_name in mapping.items():
        await db.execute(
            update(model)
            .where(model.name == zh_name)
            .values(name_en=en_name)
        )
    await db.commit()


@router.post("/tags", response_model=TranslateResponse)
async def translate_tags(
    body: TranslateRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: dict[str, str] = Depends(get_current_user),
):
    model = get_tag_model(body.tag_type)

    result = await db.execute(select(model).where(model.name.in_(body.names)))
    rows = list(result.scalars().all())

    cached: dict[str, str] = {}
    missing: list[str] = []
    for name in body.names:
        row = next((item for item in rows if item.name == name), None)
        if row and row.name_en:
            cached[name] = row.name_en
        else:
            missing.append(name)

    if missing:
        translations = await _translate_batch(missing, db)
        await _write_translations(db, body.tag_type, translations)
        cached.update(translations)

    return TranslateResponse(translations=cached)


@router.post("/tags/fill-all")
async def fill_all_translations(
    tag_type: Literal["asset", "gallery"] = "asset",
    db: AsyncSession = Depends(get_db),
    _current_user: dict[str, str] = Depends(get_current_user),
):
    model = get_tag_model(tag_type)
    result = await db.execute(select(model).where(model.name_en.is_(None)))
    rows = list(result.scalars().all())
    names = [row.name for row in rows]
    if not names:
        return {"filled": 0}

    total = 0
    batch_size = 50
    for index in range(0, len(names), batch_size):
        batch = names[index : index + batch_size]
        translations = await _translate_batch(batch, db)
        await _write_translations(db, tag_type, translations)
        total += len(batch)

    return {"filled": total}
