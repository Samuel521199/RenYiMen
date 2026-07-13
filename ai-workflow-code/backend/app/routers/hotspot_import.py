from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.trending import TrendingNewsTask, TrendingTopicTypeConfig
from app.schemas.trending_news import TrendingNewsImportResponse, TrendingNewsTaskResponse
from app.services.hotspot_import_service import (
    HIGH_RISK_TAGS,
    HotspotImportService,
    compute_risk_level,
)
from app.utils.response import ok


router = APIRouter()
import_service = HotspotImportService()


def parse_publish_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid publish_time: {value}") from exc


@router.post("/import")
async def import_hotspot_json(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded") from exc

    result = import_service.parse_from_json_content(text)
    saved_tasks: list[TrendingNewsTask] = []
    skipped = list(result.skipped)

    for task in result.imported:
        existing = await db.execute(
            select(TrendingNewsTask).where(TrendingNewsTask.task_id == task.task_id)
        )
        if existing.scalar_one_or_none():
            skipped.append({"task_id": task.task_id, "reason": "DUPLICATE_TASK_ID"})
            continue

        risk_level, allow_game = compute_risk_level(task.topic_type, task.risk_tags)
        cfg_result = await db.execute(
            select(TrendingTopicTypeConfig).where(
                TrendingTopicTypeConfig.topic_type == task.topic_type,
                TrendingTopicTypeConfig.is_active.is_(True),
            )
        )
        cfg = cfg_result.scalar_one_or_none()
        if cfg:
            has_high = any(tag in HIGH_RISK_TAGS for tag in task.risk_tags)
            if not has_high:
                risk_level = cfg.risk_level
                allow_game = cfg.allow_game_integration

        db_task = TrendingNewsTask(
            task_id=task.task_id,
            title=task.title,
            publish_time=parse_publish_time(task.publish_time),
            topic_type=task.topic_type,
            event_summary=task.event_summary,
            main_entities=task.main_entities,
            event_action=task.event_action,
            event_result=task.event_result,
            emotion_direction=task.emotion_direction,
            risk_tags=task.risk_tags,
            local_relevance=task.local_relevance,
            source_name=task.source_name,
            source_url=task.source_url,
            risk_level=risk_level,
            allow_game_integration=allow_game,
            import_status="IMPORTED",
            process_status="PENDING",
            image_status="NOT_GENERATED",
            imported_by=int(current_user["id"]),
        )
        db.add(db_task)
        saved_tasks.append(db_task)

    await db.commit()
    for item in saved_tasks:
        await db.refresh(item)

    response = TrendingNewsImportResponse(
        success=True,
        imported_count=len(saved_tasks),
        skipped_count=len(skipped),
        error_count=len(result.errors),
        total=result.total,
        tasks=[TrendingNewsTaskResponse.model_validate(item) for item in saved_tasks],
        skipped=skipped,
        errors=result.errors,
    )
    return ok(response.model_dump(mode="json"))


@router.get("/tasks")
async def list_hotspot_tasks(
    status: str | None = Query(None),
    topic_type: str | None = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    query = select(TrendingNewsTask).order_by(
        TrendingNewsTask.publish_time.desc().nullslast(),
        TrendingNewsTask.imported_at.desc(),
    )
    if status:
        query = query.where(TrendingNewsTask.process_status == status)
    if topic_type:
        query = query.where(TrendingNewsTask.topic_type == topic_type)
    query = query.limit(limit)

    result = await db.execute(query)
    tasks = result.scalars().all()
    return ok([TrendingNewsTaskResponse.model_validate(item).model_dump(mode="json") for item in tasks])


@router.get("/tasks/{task_id}")
async def get_hotspot_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(select(TrendingNewsTask).where(TrendingNewsTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return ok(TrendingNewsTaskResponse.model_validate(task).model_dump(mode="json"))


@router.patch("/tasks/{task_id}/status")
async def update_task_status(
    task_id: int,
    process_status: str,
    image_status: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(select(TrendingNewsTask).where(TrendingNewsTask.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.process_status = process_status
    if image_status:
        task.image_status = image_status
    await db.commit()
    await db.refresh(task)
    return ok(TrendingNewsTaskResponse.model_validate(task).model_dump(mode="json"))
