from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.models.identity_conflict_ticket import IdentityConflictTicket
from app.models.user import User
from app.services.audit_service import write_audit_log
from app.utils.response import ok


router = APIRouter()


class ResolveRebindRequest(BaseModel):
    target_user_id: int
    note: str | None = None
    apply_platform_role: bool = True


def require_admin(current_user: dict[str, Any]) -> None:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def map_platform_role_to_workbench(role: str | None) -> str:
    return "admin" if (role or "").upper() == "ADMIN" else "operator"


def serialize_ticket(ticket: IdentityConflictTicket) -> dict[str, Any]:
    return {
        "id": ticket.id,
        "status": ticket.status,
        "conflict_key": ticket.conflict_key,
        "conflict_reason": ticket.conflict_reason,
        "platform_user_id": ticket.platform_user_id,
        "email": ticket.email,
        "lookup_username": ticket.lookup_username,
        "candidate_user_ids": ticket.candidate_user_ids or [],
        "conflict_payload": ticket.conflict_payload or {},
        "detail": ticket.detail,
        "occur_count": ticket.occur_count,
        "last_seen_at": ticket.last_seen_at.isoformat() if ticket.last_seen_at else None,
        "resolved_by": ticket.resolved_by,
        "rebind_to_user_id": ticket.rebind_to_user_id,
        "resolution_note": ticket.resolution_note,
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
    }


@router.get("/api/identity-conflicts")
async def list_identity_conflicts(
    status_filter: str = "open",
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    safe_limit = max(1, min(500, int(limit)))
    query = select(IdentityConflictTicket)
    if status_filter in {"open", "resolved"}:
        query = query.where(IdentityConflictTicket.status == status_filter)
    query = query.order_by(IdentityConflictTicket.updated_at.desc(), IdentityConflictTicket.id.desc()).limit(safe_limit)
    result = await db.execute(query)
    items = [serialize_ticket(item) for item in result.scalars().all()]
    return ok(items)


@router.post("/api/identity-conflicts/{ticket_id}/resolve-rebind")
async def resolve_identity_conflict_rebind(
    ticket_id: int,
    req: ResolveRebindRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    require_admin(current_user)
    ticket_result = await db.execute(
        select(IdentityConflictTicket).where(IdentityConflictTicket.id == ticket_id)
    )
    ticket = ticket_result.scalar_one_or_none()
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conflict ticket not found")
    if ticket.status != "open":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Conflict ticket already resolved")

    target_result = await db.execute(select(User).where(User.id == req.target_user_id))
    target_user = target_result.scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target user not found")

    conflict_payload = ticket.conflict_payload or {}
    platform_role = conflict_payload.get("platform_role")
    safe_role = map_platform_role_to_workbench(platform_role if isinstance(platform_role, str) else None)

    detached_user_ids: list[int] = []
    if ticket.platform_user_id:
        existing_result = await db.execute(
            select(User).where(
                User.platform_user_id == ticket.platform_user_id,
                User.id != target_user.id,
            )
        )
        for other in existing_result.scalars().all():
            other.platform_user_id = None
            other.auth_source = "local"
            detached_user_ids.append(other.id)

    if ticket.email:
        email_result = await db.execute(
            select(User).where(
                User.email == ticket.email,
                User.id != target_user.id,
            )
        )
        for other in email_result.scalars().all():
            other.email = None

    if ticket.platform_user_id:
        target_user.platform_user_id = ticket.platform_user_id
    if ticket.email:
        target_user.email = ticket.email
    target_user.auth_source = "platform_sso"
    target_user.last_sso_at = datetime.utcnow()
    if req.apply_platform_role:
        target_user.role = safe_role
    target_user.role_last_source = "manual_rebind"
    target_user.role_last_synced_at = datetime.utcnow()

    ticket.status = "resolved"
    ticket.rebind_to_user_id = target_user.id
    ticket.resolved_by = int(current_user["id"])
    ticket.resolution_note = req.note
    ticket.resolved_at = datetime.utcnow()
    ticket.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(ticket)
    await db.refresh(target_user)

    ip_address = request.client.host if request.client else None
    await write_audit_log(
        db,
        user_id=int(current_user["id"]),
        action="identity_conflict_manual_rebind",
        detail=(
            f"ticket={ticket.id};target={target_user.id};platform_user_id={ticket.platform_user_id};"
            f"email={ticket.email};detached={detached_user_ids};apply_platform_role={req.apply_platform_role}"
        ),
        ip_address=ip_address,
    )

    return ok(
        {
            "ticket": serialize_ticket(ticket),
            "target_user": {
                "id": target_user.id,
                "username": target_user.username,
                "email": target_user.email,
                "platform_user_id": target_user.platform_user_id,
                "role": target_user.role,
            },
            "detached_user_ids": detached_user_ids,
        }
    )
