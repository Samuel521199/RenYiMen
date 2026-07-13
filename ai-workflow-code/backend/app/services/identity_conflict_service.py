from __future__ import annotations

import hashlib
import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.identity_conflict_ticket import IdentityConflictTicket


def _normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def _normalize_username(username: str | None) -> str:
    return (username or "").strip().lower()


def build_conflict_key(
    *,
    reason: str,
    platform_user_id: str | None,
    email: str | None,
    lookup_username: str | None,
) -> str:
    payload = {
        "reason": reason,
        "platform_user_id": (platform_user_id or "").strip(),
        "email": _normalize_email(email),
        "lookup_username": _normalize_username(lookup_username),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def upsert_conflict_ticket(
    db: AsyncSession,
    *,
    reason: str,
    platform_user_id: str | None,
    email: str | None,
    lookup_username: str | None,
    candidate_user_ids: list[int],
    payload: dict,
    detail: str | None = None,
) -> IdentityConflictTicket:
    conflict_key = build_conflict_key(
        reason=reason,
        platform_user_id=platform_user_id,
        email=email,
        lookup_username=lookup_username,
    )
    result = await db.execute(
        select(IdentityConflictTicket).where(IdentityConflictTicket.conflict_key == conflict_key)
    )
    ticket = result.scalar_one_or_none()
    now = datetime.utcnow()
    if ticket is None:
        ticket = IdentityConflictTicket(
            status="open",
            conflict_key=conflict_key,
            conflict_reason=reason,
            platform_user_id=(platform_user_id or "").strip() or None,
            email=_normalize_email(email) or None,
            lookup_username=_normalize_username(lookup_username) or None,
            candidate_user_ids=sorted(set(int(i) for i in candidate_user_ids)),
            conflict_payload=payload or {},
            detail=detail,
            occur_count=1,
            last_seen_at=now,
            updated_at=now,
            created_at=now,
        )
        db.add(ticket)
    else:
        ticket.status = "open"
        ticket.conflict_reason = reason
        ticket.platform_user_id = (platform_user_id or "").strip() or None
        ticket.email = _normalize_email(email) or None
        ticket.lookup_username = _normalize_username(lookup_username) or None
        ticket.candidate_user_ids = sorted(set(int(i) for i in candidate_user_ids))
        ticket.conflict_payload = payload or {}
        ticket.detail = detail
        ticket.occur_count = int(ticket.occur_count or 0) + 1
        ticket.last_seen_at = now
        ticket.updated_at = now
        ticket.resolved_at = None
        ticket.resolved_by = None
        ticket.rebind_to_user_id = None
        ticket.resolution_note = None

    await db.commit()
    await db.refresh(ticket)
    return ticket
