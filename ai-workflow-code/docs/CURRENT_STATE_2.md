# Current State 2

## Video Workflow Snapshot (2026-05-10)

- 视频工作流 7 个步骤已全部打通，入口为 `/videos` 和 `/workflows/video`。
- 已完成验证：
  - Kling v2.6-std 草稿生成可用
  - Kling O3-pro 精品生成可用
  - base64 图片传输可用，不依赖公网图片地址
  - 视频任务状态可持久化并恢复
  - compose-all 全链路已打通
  - 视频成品库 `/gallery/video` 已上线
  - aspectRatio 持久化修复（Step 2 选择后切步骤/恢复草稿均保留）
  - 情绪/动作枚举动态化：从 video_enum_configs 表加载，支持「+ 自定义」
- 当前未完成 / 待修复：
  - 音频素材库未完成

## Backend

- User permission system is implemented:
  - `users.permissions` JSONB column stores per-user permission tree covering delete rights and module visibility.
  - Admin users bypass all permission checks. Non-admin users default to all-false permissions.
  - Permission APIs: `GET/PUT /api/users/{user_id}/permissions`, `POST /api/users/{user_id}/reset-password`, `POST /api/users/me/change-password`, `GET /api/users/me`.
  - Frontend `PermissionContext` loads permissions after login and exposes `canDelete`, `canView`, `canViewWorkflow`, `canViewTemplate`, `canViewAdmin` helpers.
  - Sidebar hides nav items based on permissions; parent groups hide when all children are hidden.
  - Asset library delete button is gated by `canDelete("assets")`.
  - Gallery and video gallery delete buttons should be gated by `canDelete("gallery")` and `canDelete("video_gallery")` respectively when delete actions exist in those pages.
