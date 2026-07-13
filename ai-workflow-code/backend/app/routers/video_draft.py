import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.video import VideoDraft, VideoJob
from app.schemas.video import VideoDraftResponse
from app.services.video_generate_service import (
    _get_video_model_config,
    run_generate_video_draft_task,
)
from app.utils.response import ok


router = APIRouter(prefix="/api/video/draft", tags=["video-draft"])
logger = logging.getLogger(__name__)


def _serialize_draft(draft: VideoDraft) -> dict[str, Any]:
    payload = VideoDraftResponse.model_validate(draft).model_dump(mode="json")
    payload.update(
        {
            "parent_draft_id": str(draft.parent_draft_id) if draft.parent_draft_id else None,
            "operation": draft.operation,
            "operation_params": draft.operation_params,
        }
    )
    return payload


class DraftGenerateRequest(BaseModel):
    job_id: UUID
    model_config_id: int
    prompt: str
    negative_prompt: str = "text, watermark, subtitle, caption, words, letters, typography, writing"
    aspect_ratio: str = "9:16"
    duration: int = 5
    count: int = 5
    sound: bool = False
    draft_type: str = "draft"


@router.post("/generate", response_model=dict)
async def generate_drafts(
    body: DraftGenerateRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Submit async draft generation tasks."""
    result = await db.execute(select(VideoJob).where(VideoJob.id == body.job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Video job not found")
    logger.info(
        "generate_drafts: job_id=%s first_frame_url=%s first_frame_status=%s",
        job.id,
        job.first_frame_url,
        job.first_frame_status,
    )
    if not job.first_frame_url:
        raise HTTPException(status_code=400, detail="First frame is required before draft generation")

    await _get_video_model_config(db, body.model_config_id)

    count = min(max(body.count, 1), 5)
    for _ in range(count):
        background_tasks.add_task(
            run_generate_video_draft_task,
            body.job_id,
            body.model_config_id,
            body.prompt,
            body.negative_prompt,
            body.aspect_ratio,
            body.duration,
            body.sound,
            body.draft_type,
            int(current_user["id"]),
        )

    return ok(
        {
            "job_id": str(body.job_id),
            "count": count,
            "status": "generating",
            "message": f"Started {count} draft generation tasks",
        }
    )


@router.get("/{job_id}/list", response_model=dict)
async def list_drafts(
    job_id: UUID,
    since: str | None = None,
    draft_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """List drafts for polling in the frontend."""
    query = select(VideoDraft).where(VideoDraft.video_job_id == job_id)
    if draft_type:
        query = query.where(VideoDraft.draft_type == draft_type)
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query = query.where(VideoDraft.created_at >= since_dt)
        except Exception:
            pass
    result = await db.execute(query.order_by(VideoDraft.created_at))
    drafts = result.scalars().all()
    return ok(
        {
            "drafts": [_serialize_draft(draft) for draft in drafts],
            "all_done": bool(drafts)
            and all(draft.status in ("done", "failed", "selected") for draft in drafts),
        }
    )


@router.post("/{job_id}/select/{draft_id}", response_model=dict)
async def select_draft(
    job_id: UUID,
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """标记选中草稿，取消其他草稿的选中状态"""
    selected_result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == job_id,
            VideoDraft.id == draft_id,
        )
    )
    selected_draft = selected_result.scalar_one_or_none()
    if selected_draft is None:
        raise HTTPException(status_code=404, detail="Video draft not found")

    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == job_id,
            VideoDraft.draft_type == selected_draft.draft_type,
        )
    )
    drafts = result.scalars().all()
    for draft in drafts:
        draft.selected = draft.id == draft_id
        if draft.id == draft_id:
            draft.status = "selected"
    await db.commit()
    return ok({"selected_draft_id": str(draft_id)})


@router.get("/{job_id}/history/{draft_id}", response_model=dict)
async def get_draft_history(
    job_id: UUID,
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """获取某条终稿的完整版本链"""
    history: list[dict[str, Any]] = []
    current_id: UUID | None = draft_id

    while current_id:
        result = await db.execute(
            select(VideoDraft).where(
                VideoDraft.id == current_id,
                VideoDraft.video_job_id == job_id,
            )
        )
        draft = result.scalar_one_or_none()
        if not draft:
            break
        history.append(_serialize_draft(draft))
        current_id = draft.parent_draft_id

    return ok({"history": history})


@router.post("/{job_id}/revert/{draft_id}", response_model=dict)
async def revert_to_draft(
    job_id: UUID,
    draft_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """回退到指定版本"""
    result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.id == draft_id,
            VideoDraft.video_job_id == job_id,
        )
    )
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Draft not found")

    all_result = await db.execute(
        select(VideoDraft).where(
            VideoDraft.video_job_id == job_id,
            VideoDraft.draft_type == target.draft_type,
        )
    )
    for draft in all_result.scalars().all():
        draft.selected = False
        if draft.status == "selected":
            draft.status = "done"

    target.selected = True
    if target.status != "failed":
        target.status = "selected"
    await db.commit()
    return ok({"reverted_to": str(draft_id), "video_url": target.video_url})
