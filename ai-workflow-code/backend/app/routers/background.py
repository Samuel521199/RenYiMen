import json
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import distinct, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.dependencies import get_current_user, get_db
from app.models.asset import Asset
from app.models.asset_tag import AssetTag, asset_tag_relations
from app.models.background import BackgroundGenerationBatch, BackgroundImage
from app.models.model_config import ModelConfig
from app.models.user_model_permission import UserModelPermission
from app.models.workflow_session import WorkflowSession
from app.routers.generate import user_has_model_permission
from app.services.model_config_utils import is_video_model_config
from app.schemas.background import (
    BackgroundBatchCreate,
    BackgroundBatchGenerateRequest,
    BackgroundBatchResponse,
    BackgroundImageArchiveRequest,
    BackgroundImageRefineRequest,
    BackgroundImageResponse,
    BackgroundImageReviewRequest,
)
from app.schemas.generate import ImageGenerateRequest
from app.schemas.model_config import ModelConfigResponse
from app.services import ai_gateway
from app.services.background_prompt import (
    append_refinement_instructions,
    build_background_prompt,
    map_size_ratio_to_pixels,
)
from app.utils.response import ok


router = APIRouter()

def serialize_background_image(image: BackgroundImage) -> dict[str, Any]:
    return BackgroundImageResponse.model_validate(image).model_dump(mode="json")


def serialize_background_batch(batch: BackgroundGenerationBatch) -> dict[str, Any]:
    images = [serialize_background_image(image) for image in batch.images]
    return BackgroundBatchResponse.model_validate(batch).model_copy(update={"images": images}).model_dump(
        mode="json"
    )


def background_batch_session_state(
    batch_id: int,
    reference_asset_ids: list[int] | None = None,
    step: int | None = None,
) -> str:
    payload: dict[str, Any] = {
        "batch_id": batch_id,
        "reference_asset_ids": list(reference_asset_ids or []),
    }
    if step is not None:
        payload["step"] = step
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


def background_asset_filename(image_url: str, image_id: int) -> str:
    path = unquote(urlparse(image_url).path)
    filename = path.split("/")[-1] if path else ""
    return filename or f"background-{image_id}.png"


async def get_background_batch_or_404(
    db: AsyncSession,
    batch_id: int,
) -> BackgroundGenerationBatch:
    result = await db.execute(
        select(BackgroundGenerationBatch)
        .options(selectinload(BackgroundGenerationBatch.images))
        .where(BackgroundGenerationBatch.id == batch_id)
    )
    batch = result.scalar_one_or_none()
    if batch is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Background batch not found")
    return batch


async def get_background_image_or_404(
    db: AsyncSession,
    image_id: int,
) -> BackgroundImage:
    result = await db.execute(select(BackgroundImage).where(BackgroundImage.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Background image not found")
    return image


async def resolve_background_model_config(
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
            detail="Model config is not available for background generation",
        )
    has_permission = await user_has_model_permission(
        db,
        int(current_user["id"]),
        model_config_id,
        current_user.get("role"),
    )
    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to use this model",
        )
    return model_config


async def query_available_background_model_configs(
    db: AsyncSession,
    current_user: dict[str, Any],
    mode: str | None = None,
) -> list[ModelConfig]:
    if current_user.get("role") == "admin":
        query = (
            select(ModelConfig)
            .where(ModelConfig.active.is_(True))
        )
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


async def upsert_background_workflow_session(
    db: AsyncSession,
    batch: BackgroundGenerationBatch,
    current_user: dict[str, Any],
    current_step: int,
    status_value: str,
    reference_asset_ids: list[int] | None = None,
) -> WorkflowSession:
    session: WorkflowSession | None = None
    if batch.session_id is not None:
        result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == batch.session_id))
        session = result.scalar_one_or_none()

    if session is None:
        session = WorkflowSession(
            workflow_type="background",
            mode="full",
            status=status_value,
            current_step=current_step,
            state_json=background_batch_session_state(batch.id, reference_asset_ids, step=current_step),
            task_id=None,
            created_by=int(current_user["id"]),
        )
        db.add(session)
        await db.flush()
        batch.session_id = session.id
    else:
        session.workflow_type = "background"
        session.mode = "full"
        session.status = status_value
        session.current_step = current_step
        session.state_json = background_batch_session_state(batch.id, reference_asset_ids, step=current_step)

    return session


async def sync_background_archive_completion(
    db: AsyncSession,
    batch: BackgroundGenerationBatch,
) -> bool:
    approved_images = [image for image in batch.images if image.review_status in {"approved", "refine"}]
    all_archived = bool(approved_images) and all(image.asset_id is not None for image in approved_images)
    batch.status = "archived" if all_archived else "active"
    if batch.session_id is None:
        return all_archived

    session_result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == batch.session_id))
    session = session_result.scalar_one_or_none()
    if session is None:
        return all_archived

    session.workflow_type = "background"
    session.mode = "full"
    session.status = "completed" if all_archived else "draft"
    session.current_step = 4
    session.state_json = background_batch_session_state(batch.id, step=4)
    return all_archived


def build_background_archive_tags(
    batch: BackgroundGenerationBatch,
    review_status: str,
    request_tags: list[str],
    is_recommended: bool,
) -> list[str]:
    whitespace_tags = [f"留白-{item}" for item in list(batch.whitespace_positions or []) if str(item or "").strip()]
    if not whitespace_tags and batch.whitespace_position_legacy:
        whitespace_tags = [f"留白-{batch.whitespace_position_legacy}"]
    tags = [
        batch.purpose,
        batch.scene,
        *list(batch.mood or []),
        batch.color_style,
        *whitespace_tags,
        f"比例-{batch.size_ratio}",
        f"审核-{review_status}",
        f"游戏感-{batch.game_feel}",
        *(["本地化"] if batch.localized else []),
        *(["推荐"] if is_recommended else []),
        *request_tags,
    ]
    deduped: list[str] = []
    seen: set[str] = set()
    for raw_tag in tags:
        tag = str(raw_tag or "").strip()
        if not tag or tag in seen:
            continue
        deduped.append(tag)
        seen.add(tag)
    return deduped


def build_background_image_tags(batch: BackgroundGenerationBatch) -> dict[str, Any]:
    return {
        "purpose": batch.purpose,
        "scene": batch.scene,
        "mood": list(batch.mood or []),
        "color_style": batch.color_style,
        "whitespace_positions": list(batch.whitespace_positions or []) or [batch.whitespace_position_legacy],
        "size_ratio": batch.size_ratio,
        "localized": batch.localized,
        "game_feel": batch.game_feel,
    }


async def link_existing_background_asset_tags(
    db: AsyncSession,
    asset_id: int,
    tag_names: list[str],
) -> None:
    if not tag_names:
        return
    result = await db.execute(
        select(AssetTag).where(
            AssetTag.category == "background",
            AssetTag.name.in_(tag_names),
        )
    )
    tags_by_name = {tag.name: tag for tag in result.scalars().all()}
    for tag_name in tag_names:
        tag = tags_by_name.get(tag_name)
        if tag is None:
            continue
        await db.execute(insert(asset_tag_relations).values(asset_id=asset_id, tag_id=tag.id))


@router.post("/batches/create")
async def create_background_batch(
    req: BackgroundBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    whitespace_positions = [item.strip() for item in req.whitespace_positions if item.strip()]
    if not whitespace_positions:
        whitespace_positions = ["right"]
    batch = BackgroundGenerationBatch(
        created_by=int(current_user["id"]),
        purpose=req.purpose.strip(),
        scene=req.scene.strip(),
        mood=[item.strip() for item in req.mood if item.strip()],
        color_style=req.color_style.strip(),
        whitespace_position_legacy=whitespace_positions[0],
        whitespace_positions=whitespace_positions,
        size_ratio=req.size_ratio.strip(),
        localized=req.localized,
        game_feel=req.game_feel.strip() or "medium",
        count=max(int(req.count or 4), 1),
        extra_prompt=(req.extra_prompt or "").strip() or None,
        status="draft",
        session_id=req.session_id,
        model_config_id=req.model_config_id,
    )
    db.add(batch)
    await db.flush()
    await upsert_background_workflow_session(
        db,
        batch,
        current_user,
        current_step=1,
        status_value="draft",
        reference_asset_ids=req.reference_asset_ids,
    )
    await db.commit()
    batch = await get_background_batch_or_404(db, batch.id)
    return ok(serialize_background_batch(batch))


@router.get("/batches")
async def list_background_batches(
    page: int = 1,
    page_size: int = 20,
    status_value: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    safe_page = max(page, 1)
    safe_page_size = max(min(page_size, 100), 1)
    base_query = select(BackgroundGenerationBatch)
    if status_value is not None:
        base_query = base_query.where(BackgroundGenerationBatch.status == status_value)
    if current_user.get("role") != "admin":
        base_query = base_query.where(BackgroundGenerationBatch.created_by == int(current_user["id"]))

    count_query = select(func.count()).select_from(base_query.subquery())
    total = int((await db.execute(count_query)).scalar_one() or 0)
    result = await db.execute(
        base_query
        .options(selectinload(BackgroundGenerationBatch.images))
        .order_by(BackgroundGenerationBatch.created_at.desc(), BackgroundGenerationBatch.id.desc())
        .offset((safe_page - 1) * safe_page_size)
        .limit(safe_page_size)
    )
    return ok(
        {
            "items": [serialize_background_batch(batch) for batch in result.scalars().all()],
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
        }
    )


@router.get("/batches/{id}")
async def get_background_batch(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    batch = await get_background_batch_or_404(db, id)
    return ok(serialize_background_batch(batch))


@router.get("/available-models")
async def list_available_background_model_configs(
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    configs = await query_available_background_model_configs(db, current_user, mode=mode)
    return ok([serialize_model_config(config) for config in configs])


@router.post("/batches/{id}/generate")
async def generate_background_batch_images(
    id: int,
    req: BackgroundBatchGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    batch = await get_background_batch_or_404(db, id)
    if batch.status == "archived":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Archived background batch cannot generate")
    model_config = await resolve_background_model_config(db, req.model_config_id, current_user)

    reference_asset_ids = list(req.reference_asset_ids or [])
    reference_image_urls = []
    if reference_asset_ids:
        asset_result = await db.execute(select(Asset).where(Asset.id.in_(reference_asset_ids[:3])))
        reference_image_urls = [asset.url for asset in asset_result.scalars().all() if asset.url]

    generate_count = 1 if req.regenerate_image_id is not None else max(int(req.count or 4), 1)
    if req.regenerate_image_id is None:
        batch.count = generate_count
    prompt = build_background_prompt(batch)
    mapped_size = map_size_ratio_to_pixels(batch.size_ratio)

    if req.regenerate_image_id is not None:
        try:
            generation = await ai_gateway.generate_image(
                db,
                ImageGenerateRequest(
                    task_id=batch.id,
                    model_config_id=model_config.id,
                    model_provider=model_config.provider,
                    model_name=model_config.model_name,
                    mode="final",
                    prompt=prompt,
                    size=mapped_size,
                    count=generate_count,
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
                        task_id=batch.id,
                        model_config_id=model_config.id,
                        model_provider=model_config.provider,
                        model_name=model_config.model_name,
                        mode="final",
                        prompt=prompt,
                        size=mapped_size,
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
        image = await get_background_image_or_404(db, req.regenerate_image_id)
        if image.batch_id != batch.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Background image does not belong to batch")
        image.image_url = image_urls[0]
        image.thumbnail_url = image_urls[0]
        image.review_status = "pending"
        image.tags = build_background_image_tags(batch)
        image.asset_id = None
        image.is_recommended = False
    else:
        for image_url in image_urls:
            image = BackgroundImage(
                batch_id=batch.id,
                image_url=image_url,
                thumbnail_url=image_url,
                review_status="pending",
                is_recommended=False,
                tags=build_background_image_tags(batch),
                use_count=0,
            )
            db.add(image)

    batch.status = "active"
    batch.model_config_id = model_config.id
    await upsert_background_workflow_session(
        db,
        batch,
        current_user,
        current_step=2,
        status_value="draft",
        reference_asset_ids=reference_asset_ids,
    )
    await db.commit()
    batch = await get_background_batch_or_404(db, batch.id)
    return ok(serialize_background_batch(batch))


@router.patch("/images/{id}/review")
async def review_background_image(
    id: int,
    req: BackgroundImageReviewRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    image = await get_background_image_or_404(db, id)
    image.review_status = req.review_status.strip()
    if req.image_url:
        image.image_url = req.image_url.strip() or image.image_url
    if req.thumbnail_url:
        image.thumbnail_url = req.thumbnail_url.strip() or image.thumbnail_url
    batch = await get_background_batch_or_404(db, image.batch_id)
    await upsert_background_workflow_session(
        db,
        batch,
        current_user,
        current_step=3 if image.review_status in {"approved", "refine"} else 2,
        status_value="draft",
    )
    await db.commit()
    await db.refresh(image)
    return ok(serialize_background_image(image))


@router.post("/images/{id}/refine")
async def refine_background_image(
    id: int,
    req: BackgroundImageRefineRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    image = await get_background_image_or_404(db, id)
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Background image has no image URL")

    batch = await get_background_batch_or_404(db, image.batch_id)
    model_config = await resolve_background_model_config(db, req.model_config_id, current_user)
    prompt = append_refinement_instructions(build_background_prompt(batch), req.refine_prompt)
    mapped_size = map_size_ratio_to_pixels(batch.size_ratio)

    try:
        generation = await ai_gateway.generate_image(
            db,
            ImageGenerateRequest(
                task_id=batch.id,
                model_config_id=model_config.id,
                model_provider=model_config.provider,
                model_name=model_config.model_name,
                mode="final",
                prompt=prompt,
                size=mapped_size,
                count=1,
            ),
            reference_image_urls=[image.image_url],
            user_id=int(current_user["id"]),
        )
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc.detail)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc

    image_urls = image_urls_from_generation(generation)
    if not image_urls:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Image generation returned no image URL")

    image.image_url = image_urls[0]
    image.thumbnail_url = image_urls[0]
    image.tags = build_background_image_tags(batch)
    image.asset_id = None
    image.is_recommended = False
    batch.model_config_id = model_config.id
    await upsert_background_workflow_session(
        db,
        batch,
        current_user,
        current_step=3,
        status_value="draft",
    )
    await db.commit()
    await db.refresh(image)
    return ok(serialize_background_image(image))


@router.post("/images/{id}/archive")
async def archive_background_image(
    id: int,
    req: BackgroundImageArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    image = await get_background_image_or_404(db, id)
    batch = await get_background_batch_or_404(db, image.batch_id)
    if not image.image_url:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Background image has no image URL")

    merged_tags = build_background_archive_tags(
        batch,
        image.review_status,
        req.tags,
        req.is_recommended,
    )
    try:
        asset = Asset(
            filename=background_asset_filename(image.image_url, image.id),
            category="background",
            tags=",".join(merged_tags) if merged_tags else None,
            url=image.image_url,
            use_count=image.use_count,
            uploaded_by=int(current_user["id"]),
        )
        db.add(asset)
        await db.flush()
        await link_existing_background_asset_tags(db, asset.id, merged_tags)

        image.asset_id = asset.id
        image.is_recommended = req.is_recommended
        image.tags = {
            **(image.tags or {}),
            "archived_tags": merged_tags,
            "is_recommended": req.is_recommended,
        }
        await sync_background_archive_completion(db, batch)
        await db.commit()
    except Exception:
        if hasattr(db, "rollback"):
            await db.rollback()
        raise
    await db.refresh(image)
    await db.refresh(asset)
    return ok(
        {
            "image": serialize_background_image(image),
            "asset": {
                "id": asset.id,
                "filename": asset.filename,
                "category": asset.category,
                "tags": asset.tags,
                "url": asset.url,
                "use_count": asset.use_count,
            },
        }
    )


@router.get("/images")
async def list_archived_background_images(
    tags: str | None = None,
    page: int = 1,
    page_size: int = 24,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    safe_page = max(page, 1)
    safe_page_size = max(min(page_size, 100), 1)
    tag_names = [item.strip() for item in (tags or "").split(",") if item.strip()]

    query = (
        select(BackgroundImage)
        .join(Asset, Asset.id == BackgroundImage.asset_id)
        .options(selectinload(BackgroundImage.batch))
        .where(BackgroundImage.asset_id.is_not(None))
        .order_by(BackgroundImage.created_at.desc(), BackgroundImage.id.desc())
    )
    if tag_names:
        tagged_asset_ids = (
            select(asset_tag_relations.c.asset_id)
            .join(AssetTag, AssetTag.id == asset_tag_relations.c.tag_id)
            .where(AssetTag.category == "background", AssetTag.name.in_(tag_names))
            .group_by(asset_tag_relations.c.asset_id)
            .having(func.count(distinct(AssetTag.name)) == len(tag_names))
        )
        query = query.where(BackgroundImage.asset_id.in_(tagged_asset_ids))

    count_query = select(func.count()).select_from(query.subquery())
    total = int((await db.execute(count_query)).scalar_one() or 0)
    result = await db.execute(
        query.offset((safe_page - 1) * safe_page_size).limit(safe_page_size)
    )
    return ok(
        {
            "items": [serialize_background_image(image) for image in result.scalars().all()],
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
        }
    )


@router.patch("/images/{id}/use-count")
async def increment_background_image_use_count(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    image = await get_background_image_or_404(db, id)
    image.use_count += 1
    if image.asset_id is not None:
        asset_result = await db.execute(select(Asset).where(Asset.id == image.asset_id))
        asset = asset_result.scalar_one_or_none()
        if asset is not None:
            asset.use_count += 1
    await db.commit()
    await db.refresh(image)
    return ok(serialize_background_image(image))
