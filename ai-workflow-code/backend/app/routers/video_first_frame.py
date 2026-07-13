from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.video import VideoJob
from app.schemas.video import FirstFrameFromLibrary, FirstFrameStatusResponse, FirstFrameWriteback
from app.services.video_service import apply_first_frame, get_job
from app.utils.response import ok


router = APIRouter(prefix="/api/video/first-frame", tags=["video-first-frame"])


async def _get_job_or_404(job_id: UUID, db: AsyncSession) -> VideoJob:
    job = await db.run_sync(lambda sync_db: get_job(job_id, sync_db))
    if not job:
        raise HTTPException(status_code=404, detail="Video job not found")
    return job


@router.post("/{job_id}/select", response_model=dict)
async def select_first_frame(
    job_id: UUID,
    body: FirstFrameFromLibrary,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """从库中选择首帧 · Select first frame from library/gallery/frame_assets"""
    job = await _get_job_or_404(job_id, db)
    apply_first_frame(job, body.asset_id, body.url, body.source_type)
    await db.commit()
    await db.refresh(job)
    return ok(
        FirstFrameStatusResponse(
            video_job_id=job.id,
            first_frame_status=job.first_frame_status,
            first_frame_url=job.first_frame_url,
            first_frame_asset_id=job.first_frame_asset_id,
        ).model_dump(mode="json")
    )


@router.post("/{job_id}/awaiting-make", response_model=dict)
async def set_awaiting_make(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """跳转图片工作台前标记 · Set status before leaving to image workflow"""
    job = await _get_job_or_404(job_id, db)
    job.first_frame_status = "awaiting_make"
    await db.commit()
    await db.refresh(job)
    return ok(
        FirstFrameStatusResponse(
            video_job_id=job.id,
            first_frame_status=job.first_frame_status,
            first_frame_url=job.first_frame_url,
            first_frame_asset_id=job.first_frame_asset_id,
        ).model_dump(mode="json")
    )


@router.post("/{job_id}/writeback", response_model=dict)
async def writeback_first_frame(
    job_id: UUID,
    body: FirstFrameWriteback,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """图片工作台完成后回写首帧 · Called by image workflow after archive"""
    job = await _get_job_or_404(job_id, db)
    apply_first_frame(job, body.asset_id, body.url, body.source_type)
    await db.commit()
    await db.refresh(job)
    return ok(
        FirstFrameStatusResponse(
            video_job_id=job.id,
            first_frame_status=job.first_frame_status,
            first_frame_url=job.first_frame_url,
            first_frame_asset_id=job.first_frame_asset_id,
        ).model_dump(mode="json")
    )


@router.get("/{job_id}/status", response_model=dict)
async def get_first_frame_status(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """轮询首帧状态 · Poll first frame status (for awaiting_make)"""
    job = await _get_job_or_404(job_id, db)
    return ok(
        FirstFrameStatusResponse(
            video_job_id=job.id,
            first_frame_status=job.first_frame_status,
            first_frame_url=job.first_frame_url,
            first_frame_asset_id=job.first_frame_asset_id,
        ).model_dump(mode="json")
    )
