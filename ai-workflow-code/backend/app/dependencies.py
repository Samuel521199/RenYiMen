from collections.abc import AsyncGenerator
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.utils.security import verify_token


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict[str, Any]:
    payload = verify_token(token)
    subject = payload.get("sub")
    if subject is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = int(subject) if str(subject).isdigit() else subject
    return {
        "id": user_id,
        "username": payload.get("username"),
        "email": payload.get("email"),
        "platform_user_id": payload.get("platform_user_id"),
        "display_name": payload.get("display_name"),
        "role": payload.get("role"),
        "token_payload": payload,
    }
