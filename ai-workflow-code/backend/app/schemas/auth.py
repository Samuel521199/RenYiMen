from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LoginRequest(BaseModel):
    # 兼容历史字段名；实际可传用户名或邮箱
    username: str
    password: str


class SSOBridgeRequest(BaseModel):
    secret: str
    email: str
    username: str
    platform_user_id: str | None = None
    name: str | None = None
    role: str = "operator"


class UserInfo(BaseModel):
    id: int
    username: str
    email: str | None = None
    platform_user_id: str | None = None
    display_name: str | None = None
    auth_source: str = "local"
    last_sso_at: datetime | None = None
    role_sync_strategy: str = "platform_authoritative"
    role_sync_locked: bool = False
    role_last_source: str | None = None
    role_last_synced_at: datetime | None = None
    role: str
    status: bool = True
    permissions: dict[str, Any] = Field(default_factory=dict)
    is_admin: bool = False
    daily_token_limit: int = 0
    daily_cost_limit: Decimal = Decimal("0")
    used_today_tokens: int = 0
    used_today_cost: Decimal = Decimal("0")
    usage_reset_date: date | None = None
    created_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    token: str
    user: UserInfo

    model_config = ConfigDict(from_attributes=True)
