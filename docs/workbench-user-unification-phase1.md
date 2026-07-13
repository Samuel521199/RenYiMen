# Workbench 用户系统统一（阶段 1）

## 已落地目标

- 维持 `ai_workbench.users.id` 与所有业务外键不变（零破坏迁移）。
- 新增平台身份映射字段，用 SSO 将 Workbench 用户与主站用户一一关联。
- 兼容历史账号：支持按旧 `username` 自动关联，避免重复创建账号。
- 保留旧登录作为回滚兜底（可通过环境变量关闭）。

## 数据库变更

迁移脚本：`ai-workflow-code/backend/migrations/20260706_phase1_unified_user_identity.sql`

新增列（`users`）：

- `platform_user_id VARCHAR(191)`（平台主键映射）
- `email VARCHAR(255)`（平台邮箱映射）
- `display_name VARCHAR(120)`
- `auth_source VARCHAR(20)`（`local` / `platform_sso`）
- `last_sso_at TIMESTAMP`

新增索引：

- `uq_users_platform_user_id`（部分唯一，`platform_user_id IS NOT NULL`）
- `idx_users_email_lower`（查询索引，`LOWER(email)`, `email IS NOT NULL`）

兼容回填：

- 若 `username` 本身像邮箱，自动回填到 `email`
- `display_name` 为空时回填 `username`
- `auth_source` 为空时回填 `local`

## 代码改造点

- Workbench 后端 `sso-bridge` 支持 `platform_user_id` 并按以下顺序匹配账号：
  1. `platform_user_id`
  2. `email`（不区分大小写）
  3. 历史 `username`（可配置）
- 匹配命中多个用户时直接返回 409，防止误绑账号。
- SSO 登录成功后回写映射字段，并更新 `last_sso_at`。
- Workbench 本地密码登录兼容支持邮箱/用户名两种标识（可配置关闭）。
- Next.js 到 Workbench 的 SSO 请求已携带 `platform_user_id`。

## 兼容开关

在 `ai-workflow-code/.env` 中配置：

- `WORKBENCH_ALLOW_LEGACY_PASSWORD_LOGIN=true|false`
  - `true`：保留旧用户名密码登录（默认）
  - `false`：仅允许平台 SSO 登录
- `WORKBENCH_SSO_LINK_BY_LEGACY_USERNAME=true|false`
  - `true`：SSO 允许按历史 `username` 关联旧账号（默认）
  - `false`：仅按 `platform_user_id/email` 关联

## 回滚点

1. 配置级快速回滚（无需改库）：
   - 保持 `WORKBENCH_ALLOW_LEGACY_PASSWORD_LOGIN=true`
   - 保持 `WORKBENCH_SSO_LINK_BY_LEGACY_USERNAME=true`
2. 代码回滚：
   - 回滚 `auth_service` 与 SSO 请求字段改动
3. 数据库回滚（最后手段）：
   - 脚本内已提供 `DROP INDEX / DROP COLUMN` 注释模板

> 建议优先使用配置或代码回滚；数据库列删除仅在确认无依赖后执行。
