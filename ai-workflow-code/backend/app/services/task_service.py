from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import _model_imports as _model_imports
from app.models.image import GenerationLog
from app.models.task import Task
from app.schemas.task import TaskCreate, TaskResponse, TaskStatusUpdate, TaskUpdate


TASK_STATUSES = [
    "created",
    "exploring",
    "selecting",
    "finalizing",
    "reviewing",
    "done",
    "published",
    "closed",
]


def is_valid_status_transition(current_status: str, next_status: str) -> bool:
    if current_status == next_status:
        return True
    if next_status == "closed":
        return current_status != "closed"
    if current_status not in TASK_STATUSES or next_status not in TASK_STATUSES:
        return False
    return TASK_STATUSES.index(next_status) == TASK_STATUSES.index(current_status) + 1


def validate_status_transition(current_status: str, next_status: str) -> None:
    if not is_valid_status_transition(current_status, next_status):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task status transition: {current_status} -> {next_status}",
        )


async def create_task(
    db: AsyncSession,
    payload: TaskCreate,
    creator_id: int | None = None,
) -> TaskResponse:
    task = Task(
        title=payload.title,
        scene=payload.scene,
        size=payload.size,
        purpose=payload.purpose,
        budget=payload.budget,
        description=payload.description,
        creator_id=creator_id or payload.creator_id,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return TaskResponse.model_validate(task)


async def update_task(db: AsyncSession, task_id: int, payload: TaskUpdate) -> TaskResponse:
    task = await _get_task_model(db, task_id)
    updates = payload.model_dump(exclude_unset=True)
    next_status = updates.get("status")
    if next_status is not None:
        validate_status_transition(task.status, next_status)
    for field, value in updates.items():
        setattr(task, field, value)
    task.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(task)
    return TaskResponse.model_validate(task)


async def list_tasks(db: AsyncSession, status_filter: str | None = None) -> list[TaskResponse]:
    query = select(Task).order_by(Task.id.desc())
    if status_filter:
        query = query.where(Task.status == status_filter)
    result = await db.execute(query)
    return [TaskResponse.model_validate(task) for task in result.scalars().all()]


async def get_task(db: AsyncSession, task_id: int) -> TaskResponse:
    return TaskResponse.model_validate(await _get_task_model(db, task_id))


async def update_task_status(
    db: AsyncSession,
    task_id: int,
    payload: TaskStatusUpdate,
) -> TaskResponse:
    task = await _get_task_model(db, task_id)
    validate_status_transition(task.status, payload.status)
    task.status = payload.status
    task.updated_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(task)
    return TaskResponse.model_validate(task)


async def get_task_cost_summary(db: AsyncSession, task_id: int) -> dict[str, Decimal | int]:
    result = await db.execute(
        select(
            func.coalesce(func.sum(GenerationLog.token_used), 0),
            func.coalesce(func.sum(GenerationLog.cost_usd), 0),
            func.coalesce(func.sum(GenerationLog.image_count), 0),
        ).where(GenerationLog.task_id == task_id)
    )
    total_tokens, total_cost, image_count = result.one()
    return {
        "task_id": task_id,
        "total_tokens": int(total_tokens or 0),
        "total_cost": Decimal(total_cost or 0),
        "image_count": int(image_count or 0),
    }


async def _get_task_model(db: AsyncSession, task_id: int) -> Task:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task
