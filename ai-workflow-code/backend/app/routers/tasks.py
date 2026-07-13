from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.schemas.task import TaskCreate, TaskStatusUpdate
from app.services import task_service
from app.utils.response import ok


router = APIRouter()


@router.post("/api/tasks/create")
async def create_task(
    req: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    task = await task_service.create_task(db, req, creator_id=int(current_user["id"]))
    return ok(task.model_dump(mode="json"))


@router.get("/api/tasks")
async def list_tasks(
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    tasks = await task_service.list_tasks(db, status_filter=status)
    return ok([task.model_dump(mode="json") for task in tasks])


@router.get("/api/tasks/{task_id}")
async def get_task(
    task_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    task = await task_service.get_task(db, task_id)
    return ok(task.model_dump(mode="json"))


@router.post("/api/tasks/{task_id}/status")
async def update_task_status(
    task_id: int,
    req: TaskStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    task = await task_service.update_task_status(db, task_id, req)
    return ok(task.model_dump(mode="json"))
