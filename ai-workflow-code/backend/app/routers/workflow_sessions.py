from typing import Any

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.workflow_session import WorkflowSession
from app.utils.response import ok


router = APIRouter()


class WorkflowSessionSaveRequest(BaseModel):
    session_id: int | None = None
    workflow_type: str = "expression"
    mode: str
    status: str = "draft"
    current_step: int = 1
    state_json: str | None = None
    task_id: int | None = None


def dump_workflow_session(session: WorkflowSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "session_id": session.id,
        "workflow_type": session.workflow_type,
        "mode": session.mode,
        "status": session.status,
        "current_step": session.current_step,
        "state_json": session.state_json,
        "task_id": session.task_id,
        "created_by": session.created_by,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


async def get_session_or_404(db: AsyncSession, session_id: int) -> WorkflowSession:
    result = await db.execute(select(WorkflowSession).where(WorkflowSession.id == session_id))
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow session not found",
        )
    return session


@router.post("/api/workflow-sessions/save")
async def save_workflow_session(
    req: WorkflowSessionSaveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if req.session_id:
        session = await get_session_or_404(db, req.session_id)
        session.workflow_type = req.workflow_type
        session.mode = req.mode
        session.status = req.status
        session.current_step = req.current_step
        session.state_json = req.state_json
        session.task_id = req.task_id
    else:
        session = WorkflowSession(
            workflow_type=req.workflow_type,
            mode=req.mode,
            status=req.status,
            current_step=req.current_step,
            state_json=req.state_json,
            task_id=req.task_id,
            created_by=int(current_user["id"]),
        )
        db.add(session)

    await db.commit()
    await db.refresh(session)
    return ok(dump_workflow_session(session))


@router.get("/api/workflow-sessions")
async def list_workflow_sessions(
    status: str | None = None,
    workflow_type: str | None = None,
    mode: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    query = select(WorkflowSession).order_by(WorkflowSession.updated_at.desc(), WorkflowSession.id.desc())
    if status:
        query = query.where(WorkflowSession.status == status)
    if workflow_type:
        query = query.where(WorkflowSession.workflow_type == workflow_type)
    if mode:
        query = query.where(WorkflowSession.mode == mode)
    if current_user.get("role") != "admin":
        query = query.where(WorkflowSession.created_by == int(current_user["id"]))

    result = await db.execute(query)
    return ok([dump_workflow_session(session) for session in result.scalars().all()])


@router.get("/api/workflow-sessions/{id}")
async def get_workflow_session(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    session = await get_session_or_404(db, id)
    if current_user.get("role") != "admin" and session.created_by != int(current_user["id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow session not found")
    return ok(dump_workflow_session(session))


@router.delete("/api/workflow-sessions/{id}")
async def delete_workflow_session(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    session = await get_session_or_404(db, id)
    if current_user.get("role") != "admin" and session.created_by != int(current_user["id"]):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow session not found")
    await db.delete(session)
    await db.commit()
    return ok({"deleted": id})
