# Workbench 用户统一 - 阶段2第2项

## 1) 登录入口灰度收敛（配置开关）

在 `ai-workflow-code/.env` 中使用：

- `WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE=allow_all`
  - 所有账号允许旧密码登录（初始阶段）
- `WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE=allow_admin_only`
  - 仅管理员允许旧密码登录（推荐灰度阶段）
- `WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE=disabled`
  - 完全关闭旧密码登录，仅允许平台 SSO（收口阶段）

兼容旧开关仍保留：

- `WORKBENCH_ALLOW_LEGACY_PASSWORD_LOGIN=true|false`
  - 仅在 `WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE` 未配置时生效。

## 1.1) 角色策略收口（落库）

新增用户字段：

- `users.role_sync_strategy`
- `users.role_sync_locked`
- `users.role_last_source`
- `users.role_last_synced_at`

当前支持策略：

- `platform_authoritative`：平台角色单向覆盖 workbench 角色
- `preserve_workbench_admin`：保留已存在 admin，不被平台 USER 自动降级
- `no_auto_downgrade`：仅允许升为 admin，不自动降级

管理员可通过接口调整单个用户策略：

- `PATCH /api/users/{user_id}/role-sync-policy`

## 2) 冲突告警 + 审计日志落库

SSO 和旧登录路径已写入 `audit_logs`：

- `auth_legacy_login_failed`
- `auth_legacy_login_blocked`
- `auth_legacy_login_success`
- `auth_sso_identity_conflict`
- `auth_sso_link_created`
- `auth_sso_link_success`

冲突场景会同时写库并输出后端告警日志，便于排查误绑问题。

同时新增冲突工单表：

- `identity_conflict_tickets`

管理员工单接口：

- `GET /api/identity-conflicts`（清单）
- `POST /api/identity-conflicts/{ticket_id}/resolve-rebind`（人工确认后重绑）

## 3) 发布前检查脚本

脚本：`scripts/workbench-predeploy-identity-check.mjs`

一键命令（严格模式，任一超阈值即失败）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-predeploy-check.ps1
```

检查项：

- 映射完整率（platform -> workbench）
- 平台未映射账号数
- 潜在冲突数（平台ID/邮箱/旧用户名多命中）
- 未绑定 workbench 账号清单
- 角色漂移 / 邮箱漂移
- 最近冲突审计日志数（默认 168 小时）
- 未关闭冲突工单数

可调阈值示例：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-predeploy-check.ps1 `
  -MaxUnboundWorkbench 2 `
  -MaxRecentConflictAuditLogs 5 `
  -MaxOpenConflictTickets 5
```

## CI 发布门禁

已新增工作流：`.github/workflows/predeploy-identity-gate.yml`

- 在 `main` 相关路径变更时自动运行，也支持手动触发
- 使用严格模式运行 predeploy check
- 阈值通过 GitHub Repository Variables 配置（`WORKFLOW_MAX_*`）
- 不达标自动失败并阻断发布流程
