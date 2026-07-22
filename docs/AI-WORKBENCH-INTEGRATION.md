# Workbench 集成、身份与运维

Workbench 已并入统一 Next.js 平台。本文替代旧交付包部署说明和用户统一阶段记录，只描述当前仓库可执行的流程。

## 1. 当前结构

| 模块 | 当前入口 | 实现 |
|---|---|---|
| 主创作工作室 | `/studio` | Next.js API + provider adapters + Prisma |
| 社媒工作台 | `/workbench/*` | 统一 Next.js 页面 |
| Workbench API 代理 | `/api/workbench/*` | 转发到 FastAPI |
| SSO | `/api/workbench/auth/sso` | NextAuth 会话换取 Workbench JWT |
| Workbench 后端 | 内网 `workbench-backend:8000` | `ai-workflow-code/backend/` |

主站和 Workbench 使用独立 PostgreSQL 数据库。Workbench 还使用 Redis 和 `ai-workflow-data/storage`。

## 2. 必要配置

根目录 `.env`：

```env
WORKBENCH_BACKEND_URL=http://localhost:8000
WORKBENCH_SSO_SECRET=<随机长密钥>
WORKBENCH_POSTGRES_PASSWORD=<数据库密码>
REDIS_PASSWORD=<可选 Redis 密码>
```

`ai-workflow-code/.env` 至少配置数据库、Redis、JWT 和同一个 SSO 密钥。模板见 `ai-workflow-code/.env.example`。

生产环境必须替换默认的 `WORKBENCH_SSO_SECRET` 和 `SECRET_KEY`。模型凭据主要由 Workbench 管理后台写入 `model_configs`，不要写入文档或提交仓库。

## 3. 启动

Docker 是当前完整启动方式：

```bash
docker compose up -d --build db workbench-db workbench-redis workbench-backend web nginx
docker compose ps
```

本地联调可使用 `docker-compose.dev.yml` 暴露 Workbench 数据库和后端端口，再执行 `npm run dev`。浏览器统一访问 `http://localhost:3001`；旧独立 Workbench 前端不属于当前部署入口。

主站 Prisma 迁移是一次性 profile，不会随 `docker compose up` 自动执行：

```bash
docker compose --profile migrate run --rm migrate
```

Workbench 后端的初始化/迁移文件位于 `ai-workflow-code/backend/migrations/`。

## 4. 用户关联与 SSO

Workbench 保留自己的 `users.id` 和业务外键，通过 `users.platform_user_id` 关联主站用户。SSO 匹配顺序为：

1. `platform_user_id`；
2. 不区分大小写的邮箱；
3. 历史用户名（仅在兼容开关启用时）。

多候选或 ID 冲突不会自动绑定，而是记录审计日志并创建 `identity_conflict_tickets`。管理员接口为：

- `GET /api/identity-conflicts`
- `POST /api/identity-conflicts/{ticket_id}/resolve-rebind`
- `PATCH /api/users/{user_id}/role-sync-policy`

## 5. 旧密码与角色同步

Workbench 后端支持以下灰度配置：

```env
WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE=allow_admin_only
WORKBENCH_PLATFORM_ROLE_POLICY=platform_authoritative
WORKBENCH_SSO_LINK_BY_LEGACY_USERNAME=true
```

`WORKBENCH_LEGACY_PASSWORD_LOGIN_MODE` 可取：

- `allow_all`：所有账号允许旧密码登录；
- `allow_admin_only`：只允许管理员，适合灰度；
- `disabled`：只允许平台 SSO。

旧布尔变量 `WORKBENCH_ALLOW_LEGACY_PASSWORD_LOGIN` 仅在未配置 mode 时兼容生效。

角色策略可取 `platform_authoritative`、`preserve_workbench_admin` 或 `no_auto_downgrade`。单用户的 `role_sync_strategy` 和 `role_sync_locked` 可以覆盖全局策略。

## 6. 历史用户回填

先执行 dry-run：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1
```

确认 `reports/workbench-identity-backfill-<timestamp>.json` 中的冲突和计划变更后再应用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-identity-backfill.ps1 -Apply
```

如不希望为缺失用户创建 Workbench 账号，增加 `-NoCreateMissing`。脚本默认读取 Compose 容器 `workflow-db` 和 `workflow-workbench-db`。

## 7. 发布前身份检查

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-workbench-predeploy-check.ps1
```

检查包含映射完整率、未映射用户、重复候选、角色/邮箱漂移、近期冲突日志和未关闭工单。必要时通过脚本参数设置可接受阈值。CI 对应 `.github/workflows/predeploy-identity-gate.yml`。

## 8. 运维检查

```bash
docker compose ps
docker compose logs --tail=200 web workbench-backend
docker compose restart web workbench-backend
```

常见排查顺序：

1. `/api/auth/session` 是否可用；
2. `workbench-backend` 健康检查是否通过；
3. `WORKBENCH_SSO_SECRET` 两端是否完全一致；
4. Workbench 数据库和 Redis 连接是否正常；
5. `ai-workflow-data/storage` 是否挂载到 `/storage`；
6. 模型配置及用户模型权限是否存在。

离线镜像发布见 [docker-image-transfer-workflow.md](docker-image-transfer-workflow.md)。
