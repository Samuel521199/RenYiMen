from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.activity_template import ActivityTemplateType
from app.models.gallery_tag import GalleryTag
from app.models.image import FinalImage
from app.schemas.gallery_tag import GalleryTagCreate, GalleryTagResponse, GalleryTagUpdate
from app.utils.response import ok


router = APIRouter()

SOURCE_TYPES = [
    {"code": "activity", "label": "活动图", "label_en": "Activity"},
    {"code": "share", "label": "转发图", "label_en": "Share"},
    {"code": "daily", "label": "日常互动图", "label_en": "Daily Post"},
    {"code": "trending", "label": "热点借势", "label_en": "Trending"},
    {"code": "brand", "label": "品牌故事", "label_en": "Brand Story"},
    {"code": "game", "label": "游戏感知", "label_en": "Game Insight"},
    {"code": "logo", "label": "有Logo图", "label_en": "With Logo"},
]


class FinalImageSaveRequest(BaseModel):
    task_id: int
    image_id: int
    tags: list[str] = Field(default_factory=list)
    source_type: str = "expression"
    sub_category: str | None = None
    style_tag: str | None = None
    suitable_for_video: bool = False
    video_prompt_note: str | None = None


class FinalImageResponse(BaseModel):
    id: int
    task_id: int | None = None
    task_image_id: int | None = None
    image_url: str
    tags: str | None = None
    source_type: str = "expression"
    sub_category: str | None = None
    style_tag: str | None = None
    created_by: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


async def get_activity_type_label_map(db: AsyncSession) -> dict[str, str]:
    result = await db.execute(
        select(ActivityTemplateType.code, ActivityTemplateType.name).order_by(
            ActivityTemplateType.sort_order.asc(),
            ActivityTemplateType.id.asc(),
        )
    )
    return {
        code: name
        for code, name in result.all()
        if isinstance(code, str) and code and isinstance(name, str) and name
    }


async def get_gallery_tag_or_none(db: AsyncSession, tag_id: int) -> GalleryTag | None:
    result = await db.execute(select(GalleryTag).where(GalleryTag.id == tag_id))
    return result.scalar_one_or_none()


@router.post("/api/gallery/save-final")
async def save_final_image(
    req: FinalImageSaveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    image = FinalImage(
        task_id=req.task_id,
        task_image_id=req.image_id,
        image_url=f"/storage/task/{req.task_id}/final/{req.image_id}.png",
        tags=",".join(req.tags) if req.tags else None,
        source_type=req.source_type,
        sub_category=req.sub_category,
        style_tag=req.style_tag,
        created_by=int(current_user["id"]),
    )
    db.add(image)
    await db.commit()
    await db.refresh(image)
    return ok(FinalImageResponse.model_validate(image).model_dump(mode="json"))


@router.get("/api/gallery/categories")
async def get_gallery_categories(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    activity_type_labels = await get_activity_type_label_map(db)
    payload = []

    for source_type in SOURCE_TYPES:
        sub_result = await db.execute(
            select(FinalImage.sub_category)
            .where(
                FinalImage.source_type == source_type["code"],
                FinalImage.sub_category.is_not(None),
            )
            .distinct()
            .order_by(FinalImage.sub_category.asc())
        )
        count_result = await db.execute(
            select(func.count(FinalImage.id)).where(FinalImage.source_type == source_type["code"])
        )
        raw_sub_categories = [value for value in sub_result.scalars().all() if value]

        if source_type["code"] == "activity":
            sub_categories = [
                {"code": value, "label": activity_type_labels.get(value, value)}
                for value in raw_sub_categories
            ]
        else:
            sub_categories = [{"code": value, "label": value} for value in raw_sub_categories]

        payload.append(
            {
                "code": source_type["code"],
                "label": source_type["label"],
                "label_en": source_type.get("label_en", source_type["label"]),
                "count": int(count_result.scalar() or 0),
                "sub_categories": sub_categories,
            }
        )

    return ok(payload)


@router.get("/api/gallery/tags")
async def get_gallery_tags(
    source_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    # 1. 取当前分类下所有 style_tag 字符串
    tag_query = (
        select(FinalImage.style_tag)
        .where(FinalImage.style_tag.is_not(None))
        .distinct()
        .order_by(FinalImage.style_tag.asc())
    )
    if source_type:
        tag_query = tag_query.where(FinalImage.source_type == source_type)

    result = await db.execute(tag_query)
    tag_names = [tag for tag in result.scalars().all() if tag]

    # 2. 查 gallery_tags 表获取双语字段
    if tag_names:
        gt_query = select(GalleryTag).where(GalleryTag.name.in_(tag_names))
        if source_type:
            gt_query = gt_query.where(GalleryTag.source_type == source_type)
        gt_result = await db.execute(gt_query)
        gt_map = {gt.name: gt for gt in gt_result.scalars().all()}
    else:
        gt_map = {}

    tags = []
    for name in tag_names:
        gt = gt_map.get(name)
        tags.append({
            "name": name,
            "name_en": gt.name_en if gt else None,
            "name_zh": gt.name_zh if gt else None,
        })

    return ok(tags)


@router.get("/api/gallery/tags/manage")
async def list_gallery_tag_records(
    source_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(GalleryTag).order_by(GalleryTag.name.asc(), GalleryTag.id.asc())
    if source_type:
        query = query.where(GalleryTag.source_type == source_type)

    result = await db.execute(query)
    tags = [GalleryTagResponse.model_validate(tag).model_dump(mode="json") for tag in result.scalars().all()]
    return ok(tags)


@router.post("/api/gallery/tags/create")
async def create_gallery_tag(
    req: GalleryTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    name = req.name_en.strip()
    source_type = req.source_type.strip()
    if not name or not source_type:
        raise HTTPException(status_code=400, detail="name_en and source type are required")

    existing_result = await db.execute(
        select(GalleryTag).where(
            GalleryTag.name == name,
            GalleryTag.source_type == source_type,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=400, detail="Gallery tag already exists")

    tag = GalleryTag(
        name=name,
        name_en=name,
        name_zh=req.name_zh.strip() if req.name_zh else None,
        source_type=source_type,
        image_count=0,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return ok(GalleryTagResponse.model_validate(tag).model_dump(mode="json"))


@router.patch("/api/gallery/tags/{tag_id}")
async def rename_gallery_tag(
    tag_id: int,
    req: GalleryTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    tag = await get_gallery_tag_or_none(db, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Gallery tag not found")

    if req.name_en is not None:
        new_name = req.name_en.strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="name_en is required")

        duplicate_result = await db.execute(
            select(GalleryTag).where(
                GalleryTag.name == new_name,
                GalleryTag.source_type == tag.source_type,
                GalleryTag.id != tag.id,
            )
        )
        duplicate = duplicate_result.scalar_one_or_none()
        if duplicate is not None:
            raise HTTPException(status_code=400, detail="Gallery tag already exists")

        old_name = tag.name
        tag.name_en = new_name
        tag.name = new_name
        await db.execute(
            update(FinalImage)
            .where(
                FinalImage.style_tag == old_name,
                FinalImage.source_type == tag.source_type,
            )
            .values(style_tag=new_name)
        )
    if req.name_zh is not None:
        tag.name_zh = req.name_zh.strip() or None
    await db.commit()
    await db.refresh(tag)
    return ok(GalleryTagResponse.model_validate(tag).model_dump(mode="json"))


@router.delete("/api/gallery/tags/{tag_id}")
async def delete_gallery_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    tag = await get_gallery_tag_or_none(db, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail="Gallery tag not found")

    image_count = int(tag.image_count or 0)
    await db.delete(tag)
    await db.commit()
    return ok({"deleted": tag_id, "image_count": image_count})


@router.get("/api/gallery/finals")
async def list_gallery_finals(
    keyword: str | None = None,
    source_type: str | None = None,
    sub_category: str | None = None,
    style_tag: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(FinalImage).order_by(FinalImage.id.desc())

    if keyword is not None:
        query = query.where(FinalImage.tags.contains(keyword))
    if source_type:
        query = query.where(FinalImage.source_type == source_type)
    if sub_category:
        query = query.where(FinalImage.sub_category == sub_category)
    if style_tag:
        query = query.where(FinalImage.style_tag == style_tag)

    result = await db.execute(query)
    images = [FinalImageResponse.model_validate(image) for image in result.scalars().all()]
    return ok([image.model_dump(mode="json") for image in images])


@router.get("/api/gallery/{image_id}")
async def get_gallery_image(
    image_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(FinalImage).where(FinalImage.id == image_id))
    image = result.scalar_one_or_none()
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final image not found")
    return ok(FinalImageResponse.model_validate(image).model_dump(mode="json"))
