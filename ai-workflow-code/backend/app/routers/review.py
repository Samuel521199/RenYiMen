from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.image import TaskImage
from app.models.review import ReviewLog
from app.schemas.review import ReviewResponse, ReviewSubmitRequest
from app.utils.response import ok


router = APIRouter()


@router.get("/api/review/pending")
async def list_pending_reviews(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(
        select(TaskImage)
        .where(TaskImage.type == "final")
        .order_by(TaskImage.id.desc())
    )
    pending = [
        {
            "image_id": image.id,
            "task_id": image.task_id,
            "image_url": image.image_url,
            "status": "pending",
        }
        for image in result.scalars().all()
    ]
    return ok(pending)


@router.post("/api/review/submit")
async def submit_review(
    req: ReviewSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    review = ReviewLog(
        image_id=req.image_id,
        reviewer_id=int(current_user["id"]),
        score=req.score,
        status=req.status,
        reason=req.reason,
        tags=",".join(req.tags) if req.tags else None,
    )
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return ok(ReviewResponse.model_validate(review).model_dump(mode="json"))
