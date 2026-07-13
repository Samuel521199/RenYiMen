from datetime import datetime
import json
import logging
import os
import re
import secrets

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import _model_imports as _model_imports
from app.models.user import User
from app.schemas.auth import TokenResponse, UserInfo
from app.services.model_permission_service import ensure_user_model_permissions
from app.services.user_permissions import (
    ensure_user_permissions_configured,
    role_default_permissions,
)
from app.services.audit_service import write_audit_log
from app.services.identity_conflict_service import upsert_conflict_ticket
from app.utils.security import create_access_token, verify_password, get_password_hash


LEGACY_PASSWORD_LOGIN_ENV = "WORKBENCH_ALLOW_LEGACY_PASSWORD_LOGIN"
LEGACY_PASSWORD_LOGIN_MODE_ENV = "WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE"
SSO_LEGACY_USERNAME_LINK_ENV = "WORKBENCH_SSO_LINK_BY_LEGACY_USERNAME"
ROLE_SYNC_POLICY_ENV = "WORKBENCH_PLATFORM_ROLE_POLICY"
USERNAME_MAX_LEN = 50
USERNAME_SANITIZE_RE = re.compile(r"[^a-zA-Z0-9_.-]+")
logger = logging.getLogger(__name__)


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _legacy_password_login_mode() -> str:
    raw_mode = (os.getenv(LEGACY_PASSWORD_LOGIN_MODE_ENV, "") or "").strip().lower()
    if raw_mode in {"allow_all", "allow_admin_only", "disabled"}:
        return raw_mode
    # Backward-compat with old boolean flag:
    # true -> allow_all, false -> disabled.
    return "allow_all" if _env_flag(LEGACY_PASSWORD_LOGIN_ENV, default=True) else "disabled"


def _global_role_sync_policy() -> str:
    raw = (os.getenv(ROLE_SYNC_POLICY_ENV, "") or "").strip().lower()
    if raw in {"platform_authoritative", "preserve_workbench_admin", "no_auto_downgrade"}:
        return raw
    return "platform_authoritative"


def _normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def _normalize_username(value: str | None) -> str:
    cleaned = USERNAME_SANITIZE_RE.sub("_", (value or "").strip())
    cleaned = cleaned.strip("._-").lower()
    if not cleaned:
        return ""
    if len(cleaned) > USERNAME_MAX_LEN:
        cleaned = cleaned[:USERNAME_MAX_LEN].rstrip("._-")
    return cleaned or "user"


def _username_from_email(email: str) -> str:
    if not email or "@" not in email:
        return "user"
    return _normalize_username(email.split("@", 1)[0]) or "user"


async def _find_user_by_username(db: AsyncSession, username: str) -> User | None:
    if not username:
        return None
    result = await db.execute(select(User).where(User.username == username))
    return result.scalar_one_or_none()


async def _find_user_by_platform_user_id(db: AsyncSession, platform_user_id: str | None) -> User | None:
    if not platform_user_id:
        return None
    result = await db.execute(select(User).where(User.platform_user_id == platform_user_id))
    return result.scalar_one_or_none()


async def _find_user_by_email(db: AsyncSession, email: str) -> User | None:
    normalized = _normalize_email(email)
    if not normalized:
        return None
    result = await db.execute(select(User).where(func.lower(User.email) == normalized))
    return result.scalar_one_or_none()


async def _find_user_for_login(db: AsyncSession, identifier: str) -> User | None:
    normalized = (identifier or "").strip()
    if not normalized:
        return None
    result = await db.execute(
        select(User).where(
            or_(
                User.username == normalized,
                func.lower(User.email) == normalized.lower(),
            )
        )
    )
    return result.scalar_one_or_none()


async def _generate_unique_username(db: AsyncSession, preferred: str) -> str:
    base = _normalize_username(preferred) or "user"
    for suffix in range(0, 1000):
        if suffix == 0:
            candidate = base
        else:
            suffix_text = f"_{suffix}"
            trimmed = base[: max(1, USERNAME_MAX_LEN - len(suffix_text))]
            candidate = f"{trimmed}{suffix_text}"
        exists = await db.execute(select(User.id).where(User.username == candidate).limit(1))
        if exists.scalar_one_or_none() is None:
            return candidate
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unable to allocate username")


def _build_access_token_payload(user: User) -> dict[str, str]:
    payload: dict[str, str] = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
    }
    if user.email:
        payload["email"] = user.email
    if user.platform_user_id:
        payload["platform_user_id"] = user.platform_user_id
    if user.display_name:
        payload["display_name"] = user.display_name
    return payload


def _resolve_role_by_policy(*, current_role: str, incoming_role: str, strategy: str, locked: bool) -> str:
    current = (current_role or "operator").lower()
    incoming = (incoming_role or "operator").lower()
    if locked:
        return current
    if strategy == "preserve_workbench_admin":
        if current == "admin" and incoming != "admin":
            return current
        return incoming
    if strategy == "no_auto_downgrade":
        return "admin" if incoming == "admin" else current
    # Default: platform_authoritative
    return incoming


def _audit_detail(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


async def _safe_write_audit_log(
    db: AsyncSession,
    *,
    user_id: int | None,
    action: str,
    detail: dict[str, object],
    ip_address: str | None,
) -> None:
    try:
        await write_audit_log(
            db,
            user_id=user_id,
            action=action,
            detail=_audit_detail(detail),
            ip_address=ip_address,
        )
    except Exception as err:  # pragma: no cover - non-critical path
        logger.warning("failed_to_write_audit_log action=%s err=%s", action, err)


async def login_user(
    db: AsyncSession,
    username: str,
    password: str,
    *,
    ip_address: str | None = None,
) -> TokenResponse:
    mode = _legacy_password_login_mode()
    identifier = (username or "").strip()
    user = await _find_user_for_login(db, identifier)

    if user is None or not user.status or not verify_password(password, user.password_hash):
        await _safe_write_audit_log(
            db,
            user_id=user.id if user else None,
            action="auth_legacy_login_failed",
            detail={
                "identifier": identifier,
                "reason": "invalid_credentials_or_disabled",
                "mode": mode,
            },
            ip_address=ip_address,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if mode == "disabled" or (mode == "allow_admin_only" and user.role != "admin"):
        await _safe_write_audit_log(
            db,
            user_id=user.id,
            action="auth_legacy_login_blocked",
            detail={
                "identifier": identifier,
                "mode": mode,
                "role": user.role,
                "reason": "legacy_password_login_phaseout",
            },
            ip_address=ip_address,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local password login disabled. Please sign in through platform SSO.",
        )

    await ensure_user_model_permissions(db, user)
    await ensure_user_permissions_configured(db, user)

    token = create_access_token(_build_access_token_payload(user))
    await _safe_write_audit_log(
        db,
        user_id=user.id,
        action="auth_legacy_login_success",
        detail={
            "identifier": identifier,
            "mode": mode,
            "role": user.role,
        },
        ip_address=ip_address,
    )
    return TokenResponse(token=token, user=UserInfo.model_validate(user))


async def sso_bridge_user(
    db: AsyncSession,
    *,
    secret: str,
    email: str,
    username: str,
    platform_user_id: str | None,
    name: str | None,
    role: str,
    ip_address: str | None = None,
) -> TokenResponse:
    expected = os.getenv("WORKBENCH_SSO_SECRET", "")
    if not expected or not secrets.compare_digest(secret, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid SSO secret")

    email_norm = _normalize_email(email)
    if not email_norm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email is required")

    platform_user_id_norm = (platform_user_id or "").strip() or None
    safe_role = role if role in {"admin", "operator", "reviewer", "viewer"} else "operator"
    lookup_username = _normalize_username(username) or _username_from_email(email_norm)
    allow_legacy_username_link = _env_flag(SSO_LEGACY_USERNAME_LINK_ENV, default=True)

    user_by_platform = await _find_user_by_platform_user_id(db, platform_user_id_norm)
    user_by_email = await _find_user_by_email(db, email_norm)
    user_by_legacy_username = (
        await _find_user_by_username(db, lookup_username) if allow_legacy_username_link else None
    )

    candidates = [candidate for candidate in [user_by_platform, user_by_email, user_by_legacy_username] if candidate]
    unique_candidate_ids = {candidate.id for candidate in candidates}
    if len(unique_candidate_ids) > 1:
        candidate_id_list = sorted(list(unique_candidate_ids))
        await upsert_conflict_ticket(
            db,
            reason="multiple_candidates",
            platform_user_id=platform_user_id_norm,
            email=email_norm,
            lookup_username=lookup_username,
            candidate_user_ids=[int(i) for i in candidate_id_list],
            payload={
                "platform_user_id": platform_user_id_norm,
                "email": email_norm,
                "lookup_username": lookup_username,
                "candidate_ids": candidate_id_list,
                "platform_role": role,
            },
            detail="Multiple users matched by platform id/email/legacy username",
        )
        await _safe_write_audit_log(
            db,
            user_id=None,
            action="auth_sso_identity_conflict",
            detail={
                "reason": "multiple_candidates",
                "platform_user_id": platform_user_id_norm,
                "email": email_norm,
                "lookup_username": lookup_username,
                "candidate_ids": sorted(list(unique_candidate_ids)),
            },
            ip_address=ip_address,
        )
        logger.warning(
            "sso_identity_conflict reason=multiple_candidates platform_user_id=%s email=%s candidates=%s",
            platform_user_id_norm,
            email_norm,
            sorted(list(unique_candidate_ids)),
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="SSO identity conflict: multiple users match by platform id/email/legacy username",
        )

    user = candidates[0] if candidates else None
    now = datetime.utcnow()
    user_created = False
    update_keys: list[str] = []

    if user is None:
        unique_username = await _generate_unique_username(db, lookup_username)
        global_role_policy = _global_role_sync_policy()
        initial_role = _resolve_role_by_policy(
            current_role=safe_role,
            incoming_role=safe_role,
            strategy=global_role_policy,
            locked=False,
        )
        user = User(
            username=unique_username,
            platform_user_id=platform_user_id_norm,
            email=email_norm,
            display_name=(name or "").strip() or unique_username,
            auth_source="platform_sso",
            last_sso_at=now,
            role_sync_strategy=global_role_policy,
            role_sync_locked=False,
            role_last_source="platform_sso",
            role_last_synced_at=now,
            password_hash=get_password_hash(secrets.token_urlsafe(32)),
            role=initial_role,
            status=True,
            permissions=role_default_permissions(initial_role) if initial_role != "admin" else {},
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        user_created = True
        update_keys = [
            "username",
            "platform_user_id",
            "email",
            "display_name",
            "auth_source",
            "last_sso_at",
            "role",
        ]
    else:
        if platform_user_id_norm and user.platform_user_id and user.platform_user_id != platform_user_id_norm:
            await upsert_conflict_ticket(
                db,
                reason="platform_user_id_mismatch",
                platform_user_id=platform_user_id_norm,
                email=email_norm,
                lookup_username=lookup_username,
                candidate_user_ids=[int(user.id)],
                payload={
                    "incoming_platform_user_id": platform_user_id_norm,
                    "existing_platform_user_id": user.platform_user_id,
                    "email": email_norm,
                    "lookup_username": lookup_username,
                    "platform_role": role,
                },
                detail="Incoming platform_user_id conflicts with existing mapping",
            )
            await _safe_write_audit_log(
                db,
                user_id=user.id,
                action="auth_sso_identity_conflict",
                detail={
                    "reason": "platform_user_id_mismatch",
                    "platform_user_id": platform_user_id_norm,
                    "existing_platform_user_id": user.platform_user_id,
                    "email": email_norm,
                },
                ip_address=ip_address,
            )
            logger.warning(
                "sso_identity_conflict reason=platform_user_id_mismatch user_id=%s existing=%s incoming=%s",
                user.id,
                user.platform_user_id,
                platform_user_id_norm,
            )
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Platform user already linked to another account")

        if email_norm and user.email and user.email.lower() != email_norm:
            existing_email_user = await _find_user_by_email(db, email_norm)
            if existing_email_user and existing_email_user.id != user.id:
                await upsert_conflict_ticket(
                    db,
                    reason="email_already_bound",
                    platform_user_id=platform_user_id_norm,
                    email=email_norm,
                    lookup_username=lookup_username,
                    candidate_user_ids=[int(user.id), int(existing_email_user.id)],
                    payload={
                        "platform_user_id": platform_user_id_norm,
                        "email": email_norm,
                        "lookup_username": lookup_username,
                        "existing_email_user_id": existing_email_user.id,
                        "request_user_id": user.id,
                        "platform_role": role,
                    },
                    detail="Incoming email already bound to another workbench user",
                )
                await _safe_write_audit_log(
                    db,
                    user_id=user.id,
                    action="auth_sso_identity_conflict",
                    detail={
                        "reason": "email_already_bound",
                        "platform_user_id": platform_user_id_norm,
                        "email": email_norm,
                        "existing_email_user_id": existing_email_user.id,
                    },
                    ip_address=ip_address,
                )
                logger.warning(
                    "sso_identity_conflict reason=email_already_bound user_id=%s email=%s existing_user_id=%s",
                    user.id,
                    email_norm,
                    existing_email_user.id,
                )
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already linked to another account")

        prev_snapshot = {
            "platform_user_id": user.platform_user_id,
            "email": user.email,
            "display_name": user.display_name,
            "auth_source": user.auth_source,
            "role": user.role,
            "role_sync_strategy": user.role_sync_strategy,
            "role_sync_locked": user.role_sync_locked,
            "role_last_source": user.role_last_source,
        }
        role_strategy = (user.role_sync_strategy or "").strip().lower() or _global_role_sync_policy()
        if role_strategy not in {"platform_authoritative", "preserve_workbench_admin", "no_auto_downgrade"}:
            role_strategy = _global_role_sync_policy()
        locked = bool(user.role_sync_locked)
        resolved_role = _resolve_role_by_policy(
            current_role=user.role,
            incoming_role=safe_role,
            strategy=role_strategy,
            locked=locked,
        )
        user.platform_user_id = platform_user_id_norm or user.platform_user_id
        user.email = email_norm or user.email
        if (name or "").strip():
            user.display_name = (name or "").strip()
        elif not user.display_name:
            user.display_name = user.username
        user.auth_source = "platform_sso"
        user.last_sso_at = now
        user.role_sync_strategy = role_strategy
        user.role = resolved_role
        user.role_last_source = "platform_sso"
        user.role_last_synced_at = now
        update_keys = [k for k, old in prev_snapshot.items() if getattr(user, k) != old]
        update_keys.append("last_sso_at")
        await db.commit()
        await db.refresh(user)

    if not user.status:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User disabled")

    await ensure_user_model_permissions(db, user)
    await ensure_user_permissions_configured(db, user)

    token = create_access_token(_build_access_token_payload(user))
    await _safe_write_audit_log(
        db,
        user_id=user.id,
        action="auth_sso_link_created" if user_created else "auth_sso_link_success",
        detail={
            "platform_user_id": platform_user_id_norm,
            "email": email_norm,
            "lookup_username": lookup_username,
            "updated_fields": sorted(list(set(update_keys))),
            "role": user.role,
        },
        ip_address=ip_address,
    )
    return TokenResponse(token=token, user=UserInfo.model_validate(user))
