from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.audit import AuditLog
from app.utils.response import ok


router = APIRouter()


class AuditLogResponse(BaseModel):
    id: int
    user_id: int | None = None
    action: str
    detail: str | None = None
    ip_address: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@router.get("/api/audit-logs")
async def list_audit_logs(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    result = await db.execute(select(AuditLog).order_by(AuditLog.id.desc()))
    logs = [AuditLogResponse.model_validate(log) for log in result.scalars().all()]
    return ok([log.model_dump(mode="json") for log in logs])
