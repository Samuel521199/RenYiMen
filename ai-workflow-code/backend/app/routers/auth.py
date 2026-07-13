from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user, get_db
from app.schemas.auth import LoginRequest, SSOBridgeRequest
from app.services import auth_service
from app.utils.response import ok


router = APIRouter()


@router.post("/api/auth/login")
async def login(
    req: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ip_address = request.client.host if request.client else None
    response = await auth_service.login_user(db, req.username, req.password, ip_address=ip_address)
    return ok(response.model_dump(mode="json"))


@router.post("/api/auth/sso-bridge")
async def sso_bridge(
    req: SSOBridgeRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    ip_address = request.client.host if request.client else None
    response = await auth_service.sso_bridge_user(
        db,
        secret=req.secret,
        email=req.email,
        username=req.username,
        platform_user_id=req.platform_user_id,
        name=req.name,
        role=req.role,
        ip_address=ip_address,
    )
    return ok(response.model_dump(mode="json"))


@router.get("/api/auth/me")
async def get_me(
    db: AsyncSession = Depends(get_db),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(
        {
            "id": current_user.get("id"),
            "username": current_user.get("username"),
            "email": current_user.get("email"),
            "platform_user_id": current_user.get("platform_user_id"),
            "display_name": current_user.get("display_name"),
            "role": current_user.get("role"),
        }
    )
