from copy import deepcopy
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


DENY_ALL_PERMISSIONS: dict[str, Any] = {
    "delete": {
        "assets": False,
        "gallery": False,
        "video_gallery": False,
    },
    "modules": {
        "dashboard": False,
        "assets": False,
        "review": False,
        "gallery": False,
        "stats": False,
        "video_gallery": False,
        "tasks": {
            "visible": False,
            "workflows": {
                "expression": False,
                "activity": False,
                "background": False,
                "daily_post": False,
                "share": False,
                "trending": False,
                "trending_news": False,
                "video": False,
                "logo": False,
                "multi_fusion": False,
            },
        },
        "templates": {
            "visible": False,
            "items": {
                "instructions": False,
                "prompts": False,
                "activity_templates": False,
                "daily_post_templates": False,
            },
        },
        "admin": {
            "visible": False,
            "items": {
                "users": False,
                "api_keys": False,
                "logs": False,
                "models": False,
                "hotspot_import": False,
                "share_instructions": False,
            },
        },
    },
}

OPERATOR_PERMISSIONS: dict[str, Any] = {
    "delete": {"assets": True, "gallery": True, "video_gallery": True},
    "modules": {
        "dashboard": True,
        "assets": True,
        "review": True,
        "gallery": True,
        "stats": True,
        "video_gallery": True,
        "tasks": {
            "visible": True,
            "workflows": {
                "expression": True,
                "activity": True,
                "background": True,
                "daily_post": True,
                "share": True,
                "trending": True,
                "trending_news": True,
                "video": True,
                "logo": True,
                "multi_fusion": True,
            },
        },
        "templates": {
            "visible": True,
            "items": {
                "instructions": True,
                "prompts": True,
                "activity_templates": True,
                "daily_post_templates": True,
            },
        },
        "admin": {
            "visible": False,
            "items": {
                "users": False,
                "api_keys": False,
                "logs": False,
                "models": False,
                "hotspot_import": False,
                "share_instructions": False,
            },
        },
    },
}

REVIEWER_PERMISSIONS: dict[str, Any] = {
    "delete": {"assets": False, "gallery": False, "video_gallery": False},
    "modules": {
        "dashboard": True,
        "assets": False,
        "review": True,
        "gallery": True,
        "stats": True,
        "video_gallery": True,
        "tasks": {
            "visible": False,
            "workflows": {
                "expression": False,
                "activity": False,
                "background": False,
                "daily_post": False,
                "share": False,
                "trending": False,
                "trending_news": False,
                "video": False,
                "logo": False,
                "multi_fusion": False,
            },
        },
        "templates": {
            "visible": False,
            "items": {
                "instructions": False,
                "prompts": False,
                "activity_templates": False,
                "daily_post_templates": False,
            },
        },
        "admin": {
            "visible": False,
            "items": {
                "users": False,
                "api_keys": False,
                "logs": False,
                "models": False,
                "hotspot_import": False,
                "share_instructions": False,
            },
        },
    },
}

VIEWER_PERMISSIONS: dict[str, Any] = {
    "delete": {"assets": False, "gallery": False, "video_gallery": False},
    "modules": {
        "dashboard": True,
        "assets": False,
        "review": False,
        "gallery": True,
        "stats": False,
        "video_gallery": True,
        "tasks": {
            "visible": False,
            "workflows": {
                "expression": False,
                "activity": False,
                "background": False,
                "daily_post": False,
                "share": False,
                "trending": False,
                "trending_news": False,
                "video": False,
                "logo": False,
                "multi_fusion": False,
            },
        },
        "templates": {
            "visible": False,
            "items": {
                "instructions": False,
                "prompts": False,
                "activity_templates": False,
                "daily_post_templates": False,
            },
        },
        "admin": {
            "visible": False,
            "items": {
                "users": False,
                "api_keys": False,
                "logs": False,
                "models": False,
                "hotspot_import": False,
                "share_instructions": False,
            },
        },
    },
}


def permissions_are_unconfigured(permissions: dict[str, Any] | None) -> bool:
    if not permissions:
        return True
    if not isinstance(permissions, dict):
        return True
    if permissions == {}:
        return True
    modules = permissions.get("modules")
    if not isinstance(modules, dict) or modules == {}:
        return True
    return False


def role_default_permissions(role: str) -> dict[str, Any]:
    """
    新用户默认权限策略：所有角色（包括 operator）初始均无工作台权限，
    需由管理员在 /workbench/admin/users 手动授权。
    reviewer / viewer 保留只读权限，admin 由 is_admin 标志控制（DENY_ALL 不影响）。
    """
    if role == "admin":
        return deepcopy(DENY_ALL_PERMISSIONS)
    if role == "reviewer":
        return deepcopy(REVIEWER_PERMISSIONS)
    if role == "viewer":
        return deepcopy(VIEWER_PERMISSIONS)
    # operator：新建时默认无任何模块权限，管理员授权后才可访问
    return deepcopy(DENY_ALL_PERMISSIONS)


def _strip_internal_fields(permissions: dict[str, Any]) -> dict[str, Any]:
    """从返回给前端的权限 dict 中剥离内部元数据字段（如 _admin_granted）。"""
    result = deepcopy(permissions)
    result.pop("_admin_granted", None)
    return result


def user_permissions_or_default(user: User) -> dict[str, Any]:
    if user.role == "admin":
        return deepcopy(DENY_ALL_PERMISSIONS)
    if permissions_are_unconfigured(user.permissions):
        return role_default_permissions(user.role)
    perms: dict[str, Any] = user.permissions or {}
    # operator 必须有管理员显式授权标记 _admin_granted，
    # 否则视为历史默认权限或未配置，一律拒绝访问，防止"新用户自动获得全权限"的漏洞。
    if user.role == "operator" and not perms.get("_admin_granted"):
        return deepcopy(DENY_ALL_PERMISSIONS)
    return _strip_internal_fields(perms)


async def ensure_user_permissions_configured(db: AsyncSession, user: User) -> bool:
    """
    确保用户数据库里存储的权限符合当前策略，按需修复：
    1. 未配置（空）→ 写入当前角色默认值（operator → DENY_ALL）
    2. operator 存有旧版开放默认 OPERATOR_PERMISSIONS 且没有 _admin_granted 标记
       → 迁移为 DENY_ALL，防止历史存量用户绕过权限管控
    注意：user_permissions_or_default() 的读路径也独立兜底（运行时覆盖），
    本函数负责将修复结果持久化到 DB，避免每次请求都做判断。
    """
    if user.role == "admin":
        return False

    # 情形1：权限为空/未配置 → 写入新默认（DENY_ALL）
    if permissions_are_unconfigured(user.permissions):
        user.permissions = role_default_permissions(user.role)
        await db.commit()
        await db.refresh(user)
        return True

    # 情形2：operator 持有旧版开放默认且无管理员显式授权标记 → 迁移到 DENY_ALL
    if (
        user.role == "operator"
        and isinstance(user.permissions, dict)
        and not user.permissions.get("_admin_granted", False)
    ):
        user.permissions = deepcopy(DENY_ALL_PERMISSIONS)
        await db.commit()
        await db.refresh(user)
        return True

    return False
