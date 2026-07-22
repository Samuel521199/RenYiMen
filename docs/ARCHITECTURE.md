# 系统架构

本文只描述当前仓库已经落地的结构。历史方案和阶段性执行记录不作为实现依据。

## 1. 系统边界

RenYiMen 由一个统一的 Next.js 前端入口和两套后端能力组成：

```text
浏览器
  -> Next.js :3001
       -> /studio 与 /api/gateway/*
            -> Provider Adapter
            -> RunningHub / 阿里云百炼 / Kling / GPT Image
            -> workflow PostgreSQL（Prisma）
       -> /workbench/* 与 /api/workbench/*
            -> FastAPI :8000
            -> ai_workbench PostgreSQL + Redis + storage
```

- 主站页面、认证和 API Route 位于 `src/app/`。
- Workbench 页面已迁入 `src/app/(platform)/workbench/`，共用 NextAuth 会话；FastAPI 后端仍位于 `ai-workflow-code/backend/`。
- 主站数据库模型位于 `prisma/schema.prisma`；Workbench 使用自己的 SQLAlchemy 模型和数据库。

## 2. 工作流与上游适配

前端工作流 Schema 位于 `src/mocks/`。表单只描述业务字段、校验和节点映射，不直接发起厂商 HTTP 请求。

网关统一通过 `src/services/providers/ProviderFactory.ts` 的 `getProviderAdapter()` 获取适配器。适配器均实现 `src/services/providers/types.ts` 中的 `IProviderAdapter`，厂商差异保留在 `src/services/providers/` 内。

新增 provider 或 SKU 时应同步完成：

1. 实现或复用 provider adapter。
2. 在 `ProviderFactory.ts` 注册 `skuId -> providerCode` 和工厂分支。
3. 在 `src/app/api/skus/route.ts` 注册面向用户的 SKU。
4. 增加对应的前端 Schema；RunningHub 工作流还需保存完整 Comfy JSON。
5. 补充预计耗时以及必要的单元或集成测试。

RunningHub 的具体约束以 [runninghub-api.md](runninghub-api.md) 为准。

## 3. 异步生成任务

`src/app/api/gateway/` 负责创建和查询通用生成任务。适配器把不同厂商的响应归一化为统一任务状态，页面不应依赖厂商原始错误码或响应结构。

长任务使用“短请求 + 客户端轮询”模式：创建任务、查询状态和获取结果彼此独立；单次上游请求有超时限制，任务总耗时由页面轮询控制。

## 4. 一句话成片

一句话成片是独立的领域编排，核心代码位于 `src/services/video-orchestrator/`，数据模型为 `VideoProject`、`VideoKeyframe`、`VideoSegment` 和兼容用的 `VideoShot`。

它通过 `/api/video-projects/*` 暴露项目级接口，包含规划、资产审核、边界帧审核、子分镜审核、片段生成、合成、回退、恢复和同步。详细状态机见 [one-prompt-video-script-planner.md](one-prompt-video-script-planner.md)。

## 5. 认证与用户体系

- 主站使用 NextAuth。
- Next.js 服务端使用 `WORKBENCH_SSO_SECRET` 调用 Workbench 的 `/api/auth/sso-bridge`，换取 Workbench JWT。
- Workbench 用户通过 `platform_user_id` 与主站用户关联；邮箱和历史用户名仅用于受控兼容匹配。
- 身份回填、冲突工单、旧密码灰度和发布前检查见 [AI-WORKBENCH-INTEGRATION.md](AI-WORKBENCH-INTEGRATION.md)。

## 6. 部署拓扑

根目录 `docker-compose.yml` 定义 `db`、`workbench-db`、`workbench-redis`、`workbench-backend`、`web` 和 `nginx`。生产流量由 Nginx 进入，数据库和 Redis 默认只暴露在 Docker 内网。

镜像的本地构建与人工传输流程见 [docker-image-transfer-workflow.md](docker-image-transfer-workflow.md)。

## 7. 维护原则

- 页面和 API Route 不直接调用具体厂商客户端。
- 凭据只放在本地环境文件或部署 Secret 中，不提交仓库。
- 文档中的路径、变量、命令必须能在仓库中找到对应实现。
- 已完成的阶段计划不保留为长期规范；仍有价值的操作步骤应合并到主题文档。
