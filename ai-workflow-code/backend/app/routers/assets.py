from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import delete, distinct, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.config import settings
from app.models.asset import Asset
from app.models.asset_tag import AssetTag, asset_tag_relations
from app.schemas.asset import AssetResponse, AssetTagRecord
from app.schemas.asset_tag import AssetTagCreate, AssetTagUpdate
from app.services import storage_service
from app.utils.response import ok


router = APIRouter()
BACKGROUND_TAG_CATEGORY = "background"
BACKGROUND_TAG_GROUPS = {"purpose", "scene", "mood", "color_style"}


class AssetTagsUpdateRequest(BaseModel):
    tags: str = ""


class AssetBatchMoveRequest(BaseModel):
    asset_ids: list[int]
    target_category: str


class AssetStatsResponse(BaseModel):
    total: int
    by_category: dict[str, int]


def normalize_asset_tag_group(
    category: str,
    tag_group: str | None,
    *,
    require_background_group: bool = False,
) -> str | None:
    clean_category = category.strip() or "general"
    clean_group = (tag_group or "").strip() or None
    if clean_category == BACKGROUND_TAG_CATEGORY:
        if require_background_group and not clean_group:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tag_group is required for background tags",
            )
        if clean_group and clean_group not in BACKGROUND_TAG_GROUPS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tag_group for background tags",
            )
        return clean_group
    return None


def parse_tag_names(tags: str | None) -> list[str]:
    if not tags:
        return []
    names: list[str] = []
    seen: set[str] = set()
    for raw_name in tags.split(","):
        name = raw_name.strip()
        if not name or name in seen:
            continue
        names.append(name)
        seen.add(name)
    return names


def serialize_asset_tag_payload(tag: AssetTag) -> dict[str, Any]:
    return {
        "id": tag.id,
        "name": tag.name,
        "name_en": tag.name_en,
        "name_zh": tag.name_zh,
        "category": tag.category,
        "group": tag.tag_group,
        "tag_group": tag.tag_group,
        "image_count": 0,
        "created_at": tag.created_at.isoformat() if tag.created_at else None,
    }


async def ensure_asset_tags(
    db: AsyncSession,
    asset_id: int,
    category: str,
    tag_names: list[str],
) -> None:
    for name in tag_names:
        result = await db.execute(
            select(AssetTag).where(AssetTag.category == category, AssetTag.name == name)
        )
        tag = result.scalar_one_or_none()
        if tag is None:
            tag = AssetTag(name=name, category=category)
            db.add(tag)
            await db.flush()
        await db.execute(insert(asset_tag_relations).values(asset_id=asset_id, tag_id=tag.id))


def dump_asset(asset: Asset, tag_names: list[str] | None = None) -> dict[str, Any]:
    data = AssetResponse.model_validate(asset).model_dump(mode="json")
    data["use_count"] = int(data.get("use_count") or 0)
    if tag_names is not None:
        data["tags"] = ",".join(tag_names) if tag_names else None
    return data


def _filename_from_source_url(source_url: str) -> str:
    path = unquote(urlparse(source_url).path)
    filename = Path(path).name
    return filename or "asset.png"


def _mime_extension(content_type: str | None) -> str:
    mime_type = (content_type or "").split(";", 1)[0].strip().lower()
    if mime_type == "image/jpeg":
        return "jpg"
    if mime_type == "image/webp":
        return "webp"
    return "png"


def _static_path_from_source_url(source_url: str) -> str | None:
    value = (source_url or "").strip()
    if not value:
        return None

    parsed = urlparse(value)
    path = unquote(parsed.path) if parsed.scheme else unquote(value.split("?", 1)[0])
    if path.startswith("/api/workbench/static/"):
        path = path.removeprefix("/api/workbench")
    if path.startswith("/static/"):
        return path
    return None


def _local_static_path(source_url: str) -> Path | None:
    static_path = _static_path_from_source_url(source_url)
    if static_path is None:
        return None

    relative_path = static_path.removeprefix("/static/")
    storage_root = Path(settings.storage_local_path).resolve()
    candidate = (storage_root / relative_path).resolve()
    try:
        candidate.relative_to(storage_root)
    except ValueError:
        return None
    return candidate


async def load_asset_source_bytes(source_url: str) -> tuple[bytes, str | None, str]:
    local_path = _local_static_path(source_url)
    if local_path is not None:
        if not local_path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source image not found")
        return local_path.read_bytes(), None, local_path.name

    try:
        async with httpx.AsyncClient(http2=False, timeout=120.0) as client:
            response = await client.get(source_url)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Source image download failed: HTTP {exc.response.status_code}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Source image download failed",
        ) from exc

    return response.content, response.headers.get("content-type"), _filename_from_source_url(source_url)


async def get_asset_relation_tags(
    db: AsyncSession,
    asset_ids: list[int],
) -> dict[int, list[str]]:
    if not asset_ids:
        return {}
    result = await db.execute(
        select(asset_tag_relations.c.asset_id, AssetTag.name)
        .join(AssetTag, AssetTag.id == asset_tag_relations.c.tag_id)
        .where(asset_tag_relations.c.asset_id.in_(asset_ids))
        .order_by(AssetTag.name.asc())
    )
    tag_map: dict[int, list[str]] = {asset_id: [] for asset_id in asset_ids}
    for asset_id, tag_name in result.all():
        tag_map.setdefault(asset_id, []).append(tag_name)
    return tag_map


async def ensure_standalone_asset_tag(
    db: AsyncSession,
    category: str,
    name: str,
    tag_group: str | None = None,
    require_background_group: bool = False,
) -> AssetTag:
    clean_name = name.strip()
    clean_category = category.strip() or "general"
    if not clean_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tag name is required")
    clean_group = normalize_asset_tag_group(
        clean_category,
        tag_group,
        require_background_group=require_background_group,
    )

    result = await db.execute(
        select(AssetTag).where(AssetTag.category == clean_category, AssetTag.name == clean_name)
    )
    tag = result.scalar_one_or_none()
    if tag is not None:
        if clean_category == BACKGROUND_TAG_CATEGORY and clean_group and tag.tag_group != clean_group:
            tag.tag_group = clean_group
        return tag

    tag = AssetTag(name=clean_name, category=clean_category, tag_group=clean_group)
    db.add(tag)
    await db.flush()
    return tag


@router.post("/api/assets/upload")
async def upload_asset(
    filename: str | None = Query(None),
    category: str | None = Query(None),
    tags: str | None = Query(None),
    source_url: str | None = Query(None),
    file: UploadFile | None = File(None),
    filename_form: str | None = Form(None, alias="filename"),
    category_form: str | None = Form(None, alias="category"),
    tags_form: str | None = Form(None, alias="tags"),
    source_url_form: str | None = Form(None, alias="source_url"),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    asset_source_url = source_url_form or source_url
    source_filename = "asset.png"
    source_content_type: str | None = None

    if file is not None:
        file_bytes = await file.read()
        source_filename = file.filename or source_filename
        source_content_type = file.content_type
    elif asset_source_url:
        file_bytes, source_content_type, source_filename = await load_asset_source_bytes(asset_source_url)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File or source_url is required")

    asset_filename = filename_form or filename or source_filename or "asset.png"
    if "." not in Path(asset_filename).name:
        asset_filename = f"{asset_filename}.{_mime_extension(source_content_type)}"
    asset_category = category_form or category or "bull_reference"
    asset_tags = tags_form if tags_form is not None else tags
    tag_names = parse_tag_names(asset_tags)
    url = await storage_service.save_asset_file(
        db,
        file_bytes=file_bytes,
        filename=asset_filename,
    )
    asset = Asset(
        filename=asset_filename,
        category=asset_category,
        tags=",".join(tag_names) if tag_names else None,
        url=url,
        use_count=0,
        uploaded_by=int(current_user["id"]),
    )
    db.add(asset)
    await db.flush()
    await ensure_asset_tags(db, asset.id, asset_category, tag_names)
    await db.commit()
    await db.refresh(asset)
    return ok(dump_asset(asset, tag_names))


@router.get("/api/assets")
async def list_assets(
    category: str | None = None,
    tags: str | None = None,
    exclude_category: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
    limit: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(Asset).order_by(Asset.id.desc())
    if category is not None:
        query = query.where(Asset.category == category)
    if exclude_category is not None:
        query = query.where(Asset.category != exclude_category)
    tag_names = parse_tag_names(tags)
    if tag_names:
        tagged_asset_ids = (
            select(asset_tag_relations.c.asset_id)
            .join(AssetTag, AssetTag.id == asset_tag_relations.c.tag_id)
            .where(AssetTag.name.in_(tag_names))
            .where(AssetTag.category == category if category is not None else True)
            .group_by(asset_tag_relations.c.asset_id)
            .having(func.count(distinct(AssetTag.name)) == len(tag_names))
        )
        query = query.where(Asset.id.in_(tagged_asset_ids))

    # 仅 limit、且无 page/page_size 时保持旧版数组响应（供工作流 limit=40 等场景）
    if limit is not None and page is None and page_size is None:
        safe_limit = max(min(int(limit), 200), 1)
        result = await db.execute(query.limit(safe_limit))
        assets = list(result.scalars().all())
        tag_map = await get_asset_relation_tags(db, [asset.id for asset in assets])
        return ok([dump_asset(asset, tag_map.get(asset.id, [])) for asset in assets])

    # 默认分页，避免无参时一次返回全库（素材库 page_size 通常 24）
    default_page_size = 24
    safe_page = max(int(page or 1), 1)
    safe_page_size = max(min(int(page_size or limit or default_page_size), 100), 1)
    count_query = select(func.count()).select_from(query.subquery())
    total = int((await db.execute(count_query)).scalar_one() or 0)
    result = await db.execute(
        query.offset((safe_page - 1) * safe_page_size).limit(safe_page_size)
    )
    assets = list(result.scalars().all())
    tag_map = await get_asset_relation_tags(db, [asset.id for asset in assets])
    return ok(
        {
            "items": [dump_asset(asset, tag_map.get(asset.id, [])) for asset in assets],
            "total": total,
            "page": safe_page,
            "page_size": safe_page_size,
        }
    )


@router.get("/api/assets/stats")
async def get_asset_stats(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(
            Asset.category,
            func.count(Asset.id).label("image_count"),
        )
        .group_by(Asset.category)
        .order_by(Asset.category.asc())
    )
    by_category = {
        str(row.category): int(row.image_count or 0)
        for row in result.all()
        if row.category is not None
    }
    return ok(AssetStatsResponse(total=sum(by_category.values()), by_category=by_category).model_dump())


@router.get("/api/assets/tags")
async def list_asset_tags(
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(AssetTag.name, AssetTag.name_en, AssetTag.name_zh, AssetTag.tag_group).order_by(
        AssetTag.name.asc()
    )
    if category is not None:
        query = query.where(AssetTag.category == category)
    result = await db.execute(query)
    return ok(
        [
            {
                "name": row.name,
                "name_en": row.name_en,
                "name_zh": row.name_zh,
                "group": row.tag_group,
            }
            for row in result.all()
        ]
    )


@router.post("/api/assets/tags/create")
async def create_asset_tag(
    req: AssetTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    clean_category = req.category.strip() or "general"
    canonical_name = req.name_en.strip()
    if not canonical_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name_en is required")

    clean_group = normalize_asset_tag_group(
        clean_category,
        req.tag_group,
        require_background_group=clean_category == BACKGROUND_TAG_CATEGORY,
    )

    existing_result = await db.execute(
        select(AssetTag).where(
            AssetTag.category == clean_category,
            AssetTag.name == canonical_name,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")

    tag = AssetTag(
        name=canonical_name,
        name_en=canonical_name,
        name_zh=req.name_zh.strip() if req.name_zh else None,
        category=clean_category,
        tag_group=clean_group,
    )
    db.add(tag)
    await db.flush()
    await db.commit()
    await db.refresh(tag)
    return ok(serialize_asset_tag_payload(tag))


@router.post("/api/assets/tags/create-inline")
async def create_asset_tag_inline(
    req: AssetTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    clean_category = req.category.strip() or "general"
    canonical_name = req.name_en.strip()
    if not canonical_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name_en is required")

    clean_group = normalize_asset_tag_group(
        clean_category,
        req.tag_group,
        require_background_group=clean_category == BACKGROUND_TAG_CATEGORY,
    )

    existing_result = await db.execute(
        select(AssetTag).where(
            AssetTag.category == clean_category,
            AssetTag.name == canonical_name,
        )
    )
    tag = existing_result.scalar_one_or_none()
    if tag is None:
        tag = AssetTag(
            name=canonical_name,
            name_en=canonical_name,
            name_zh=req.name_zh.strip() if req.name_zh else None,
            category=clean_category,
            tag_group=clean_group,
        )
        db.add(tag)
        await db.flush()
    elif clean_category == BACKGROUND_TAG_CATEGORY and clean_group and tag.tag_group != clean_group:
        tag.tag_group = clean_group
    if req.name_zh is not None:
        tag.name_zh = req.name_zh.strip() or None
    if tag.name_en is None:
        tag.name_en = canonical_name

    await db.commit()
    await db.refresh(tag)
    return ok(serialize_asset_tag_payload(tag))


@router.get("/api/assets/tags/manage")
async def manage_asset_tags(
    category: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = (
        select(
            AssetTag.id,
            AssetTag.name,
            AssetTag.name_en,
            AssetTag.name_zh,
            AssetTag.category,
            AssetTag.tag_group,
            AssetTag.created_at,
            func.count(asset_tag_relations.c.asset_id).label("image_count"),
        )
        .select_from(AssetTag)
        .outerjoin(asset_tag_relations, asset_tag_relations.c.tag_id == AssetTag.id)
        .group_by(
            AssetTag.id,
            AssetTag.name,
            AssetTag.name_en,
            AssetTag.name_zh,
            AssetTag.category,
            AssetTag.tag_group,
            AssetTag.created_at,
        )
        .order_by(AssetTag.name.asc())
    )
    if category is not None:
        query = query.where(AssetTag.category == category)

    result = await db.execute(query)
    return ok(
        [
            {
                "id": row.id,
                "name": row.name,
                "name_en": row.name_en,
                "name_zh": row.name_zh,
                "category": row.category,
                "tag_group": row.tag_group,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "image_count": int(row.image_count or 0),
            }
            for row in result.all()
        ]
    )


@router.patch("/api/assets/tags/{tag_id}")
async def rename_asset_tag(
    tag_id: int,
    req: AssetTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(AssetTag).where(AssetTag.id == tag_id))
    tag = result.scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    if req.name_en is not None:
        clean_name_en = req.name_en.strip()
        if not clean_name_en:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name_en is required")

        duplicate = await db.execute(
            select(AssetTag).where(
                AssetTag.category == tag.category,
                AssetTag.name == clean_name_en,
                AssetTag.id != tag_id,
            )
        )
        if duplicate.scalar_one_or_none() is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")

        tag.name_en = clean_name_en
        tag.name = clean_name_en
    if req.name_zh is not None:
        tag.name_zh = req.name_zh.strip() or None
    if req.tag_group is not None:
        tag.tag_group = normalize_asset_tag_group(
            tag.category,
            req.tag_group,
            require_background_group=tag.category == BACKGROUND_TAG_CATEGORY,
        )
    await db.commit()
    await db.refresh(tag)
    return ok(
        {
            "id": tag.id,
            "name": tag.name,
            "name_en": tag.name_en,
            "name_zh": tag.name_zh,
            "category": tag.category,
            "tag_group": tag.tag_group,
        }
    )


@router.delete("/api/assets/tags/{tag_id}")
async def delete_asset_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(AssetTag).where(AssetTag.id == tag_id))
    tag = result.scalar_one_or_none()
    if tag is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")

    count_result = await db.execute(
        select(func.count(asset_tag_relations.c.asset_id)).where(
            asset_tag_relations.c.tag_id == tag_id
        )
    )
    image_count = int(count_result.scalar_one() or 0)
    await db.delete(tag)
    await db.commit()
    return ok({"deleted": tag_id, "image_count": image_count})


@router.patch("/api/assets/batch-move")
async def batch_move_assets(
    req: AssetBatchMoveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    asset_ids = list(dict.fromkeys(req.asset_ids or []))
    target_category = req.target_category.strip()
    if not asset_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Asset ids are required")
    if not target_category:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target category is required")

    result = await db.execute(select(Asset).where(Asset.id.in_(asset_ids)))
    selected_assets = list(result.scalars().all())
    selected_asset_ids = [asset.id for asset in selected_assets]
    original_categories = {asset.id: asset.category for asset in selected_assets}
    relation_tag_ids_by_asset: dict[int, set[int]] = {asset.id: set() for asset in selected_assets}
    relation_names_by_asset: dict[int, list[str]] = {asset.id: [] for asset in selected_assets}

    if selected_asset_ids:
        relation_result = await db.execute(
            select(
                asset_tag_relations.c.asset_id,
                asset_tag_relations.c.tag_id,
                AssetTag.name,
                AssetTag.category,
            )
            .join(AssetTag, AssetTag.id == asset_tag_relations.c.tag_id)
            .where(asset_tag_relations.c.asset_id.in_(selected_asset_ids))
        )
        target_tags_by_name: dict[str, AssetTag] = {}
        for asset_id, source_tag_id, tag_name, tag_category in relation_result.all():
            relation_tag_ids_by_asset.setdefault(asset_id, set()).add(source_tag_id)
            relation_names_by_asset.setdefault(asset_id, [])
            if tag_name not in relation_names_by_asset[asset_id]:
                relation_names_by_asset[asset_id].append(tag_name)
            if tag_category != original_categories.get(asset_id):
                continue
            if tag_name not in target_tags_by_name:
                target_tags_by_name[tag_name] = await ensure_standalone_asset_tag(db, target_category, tag_name)
            target_tag = target_tags_by_name[tag_name]
            if target_tag.id == source_tag_id:
                continue
            await db.execute(
                delete(asset_tag_relations).where(
                    asset_tag_relations.c.asset_id == asset_id,
                    asset_tag_relations.c.tag_id == source_tag_id,
                )
            )
            if target_tag.id not in relation_tag_ids_by_asset.setdefault(asset_id, set()):
                await db.execute(
                    insert(asset_tag_relations).values(asset_id=asset_id, tag_id=target_tag.id)
                )
                relation_tag_ids_by_asset[asset_id].add(target_tag.id)

    for asset in selected_assets:
        asset.category = target_category
        tag_names = parse_tag_names(asset.tags) or relation_names_by_asset.get(asset.id, [])
        asset.tags = ",".join(tag_names) if tag_names else None
    await db.commit()
    return ok({"moved_count": len(selected_assets)})


@router.patch("/api/assets/{id}/tags")
async def update_asset_tags(
    id: int,
    req: AssetTagsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(Asset).where(Asset.id == id))
    asset = result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    tag_names = parse_tag_names(req.tags)
    asset.tags = ",".join(tag_names) if tag_names else None
    await db.execute(delete(asset_tag_relations).where(asset_tag_relations.c.asset_id == id))
    await ensure_asset_tags(db, asset.id, asset.category, tag_names)
    await db.commit()
    await db.refresh(asset)
    return ok(dump_asset(asset, tag_names))


@router.delete("/api/assets/{id}")
async def delete_asset(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(Asset).where(Asset.id == id))
    asset = result.scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    await db.delete(asset)
    await db.commit()
    return ok({"deleted": id})
