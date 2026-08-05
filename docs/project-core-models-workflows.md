# RenYiMen / WorkFlow 项目核心内容、模型与工作流说明

本文用于后续开发、部署、交接和产品介绍时快速理解项目全貌。内容基于当前代码结构、SKU 目录、Provider 适配器、环境变量模板和 Workbench 集成文档整理。

## 1. 项目定位

RenYiMen / WorkFlow 是一个面向企业内容生产的 AI 视频与图片工作流平台，核心方向是把复杂的 AI 上游能力封装成可审查、可回退、可归档、可运营的工作台。

当前项目不是单纯的“上传图片 + 提示词 + 调 API”页面，而是逐步演进为企业级 AI 内容生产系统：

- AI 视频生成：图生视频、多参考图剧场、一句话成片、首尾帧过渡、视频修复。
- AI 图片生产：文生图、参考图生图、背景替换、人像抠图、高清放大、换脸、分镜图。
- 运营工作台：表情、活动图、日常互动图、热点借势图、分享图、背景图、Logo 水印、视频制作。
- 管理后台：用户、积分、调用记录、模型配置、素材标签、审计日志、用量统计。
- 企业部署：Docker Compose、PostgreSQL、Redis、OSS/本地存储、Nginx、Workbench FastAPI 后端代理。

## 2. 核心技术结构

| 层级 | 说明 | 关键路径 |
| --- | --- | --- |
| 前端应用 | Next.js App Router + TypeScript + Tailwind，提供创作大厅、工作台、管理后台 | `src/app` |
| SKU 目录 | 创作能力列表，定义 SKU、providerCode、价格、表单 schema | `src/app/api/skus/route.ts` |
| 动态表单 | 通过 UI Schema 生成参数表单，避免页面硬编码上游节点 | `src/mocks/*-workflow.ts`, `src/components/WorkflowForm` |
| 网关路由 | 统一鉴权、扣积分、落库、调用 provider | `src/app/api/gateway/generate/route.ts` |
| Provider 适配器 | 对接 RunningHub、百炼 DashScope、Kling、GPT Image | `src/services/providers` |
| 一句话成片编排 | LLM 规划、关键帧、片段、合成、同步、回滚 | `src/services/video-orchestrator` |
| 数据库 | Prisma + PostgreSQL，用户、积分、任务、视频项目 | `prisma/schema.prisma` |
| Workbench 后端代理 | Next.js 代理到 FastAPI 社媒工作台后端 | `src/app/api/workbench/*`, `ai-workflow-code/backend` |
| 部署 | Web 统一使用 3001，Nginx 可对外 80 | `Dockerfile`, `docker-compose.yml`, `deploy/nginx/default.conf` |

## 3. 当前核心 SKU / 工作流目录

### 3.1 提示词类

| SKU | 名称 | Provider | 说明 | 积分 |
| --- | --- | --- | --- | --- |
| `RH_PROMPT_REVERSE` | 提示词反推 | `RUNNINGHUB_PROMPT_REVERSE` | 上传图片，通过 Qwen3-VL/VQA 类工作流反推出绘画提示词 | 10 |

### 3.2 图片类

| SKU | 名称 | Provider | 说明 | 积分 |
| --- | --- | --- | --- | --- |
| `GPT_IMAGE2_REF` | 智能图片生成 | `GPT_IMAGE2` | GPT-image-2 文生图/参考图生图，支持 1-8 张、不同质量 | 按质量和张数 |
| `RH_BG_REPLACE` | 背景替换 | `RUNNINGHUB_BG_REPLACE` | 主体图 + 背景图，自动抠图并融合到新背景 | 15 |
| `RH_MATTING` | 人像抠图 | `RUNNINGHUB_MATTING` | 单图抠图、换背景、去文字/特效等 | 10 |
| `RH_HD_UPSCALE` | 高清放大 | `RUNNINGHUB_HD_UPSCALE` | 图片超分、细节增强，适合老图和生成图放大 | 10 |
| `RH_FACE_SWAP` | 换头换脸 | `RUNNINGHUB_FACE_SWAP` | 底图 + 换脸源图，合成自然人脸/头部替换 | 20 |
| `RH_TXT2IMG_SHORTDRAMA` | 文字生成图片 | `RUNNINGHUB_TXT2IMG` | 输入一句话生成风格统一的创意图片 | 5 |
| `RH_STORYBOARD` | 分镜生成出图 | `RUNNINGHUB_STORYBOARD` | 角色参考图 + 创作方向，生成多张电影级分镜图 | 30 |

### 3.3 视频类

| SKU | 名称 | Provider | 说明 | 积分 |
| --- | --- | --- | --- | --- |
| `ONE_PROMPT_30S_VIDEO` | 一句话成片 | `VIDEO_ORCHESTRATOR` | 从一句话生成可审查 30s 视频项目，包含计划、关键帧、片段和合成 | 当前目录价 0，实际成本由内部链路决定 |
| `BAILIAN_WANX_I2V` | 多模态图生视频 | `ALIYUN_BAILIAN` | 单参考图 + prompt 生成短视频，前台保留万相/HappyHorse 选择 | 按秒计费 |
| `BAILIAN_MULTI_REF_I2V` | 多参考图剧场生成 | `ALIYUN_BAILIAN` | 多参考图生成连贯短剧片段，前台保留万相/HappyHorse 选择 | 按秒计费 |
| `KLING_CINEMA_PRO` | 单图生成短视频 | `RUNNINGHUB_IMG2VIDEO` | RunningHub 完整 Comfy 工作流图生视频 | 25 |
| `KLING_STD_I2V` | Kling 标准版·图生视频 | `KLING_STD` | 302.ai Kling v2.6 标准版图生视频，固定费用 | 400 |
| `RH_SVD_IMG2VID` | 首尾帧过渡视频 | `RUNNINGHUB_SVD` | 首帧 + 尾帧 + 过渡描述，生成自然衔接视频 | 10 |
| `RH_VIDEO_ENHANCE` | 视频模糊修复 | `RUNNINGHUB_VIDEO_ENHANCE` | 上传低清/模糊视频，超分修复并增强细节 | 40 |

## 4. 当前使用的模型与上游

### 4.1 阿里云百炼 / DashScope

主要用于视频生成与“一句话成片”的真实链路。

| 用途 | 默认模型 / 可选模型 | 环境变量 / 代码来源 |
| --- | --- | --- |
| 一句话成片：文本规划 | `qwen3.7-plus` | `ALIYUN_STORYBOARD_MODEL` |
| 一句话成片：带参考图规划 | `qwen-vl-max` | `ALIYUN_STORYBOARD_VISION_MODEL` |
| 一句话成片：关键帧图片 | `wan2.7-image-pro` | `ALIYUN_IMAGE_MODEL` |
| 一句话成片：图生视频片段 | `wan2.7-i2v-2026-04-25`，可通过环境变量切换 | `ALIYUN_I2V_MODEL` |
| 百炼图生视频 SKU | `wan2.7-i2v-2026-04-25` / `happyhorse-1.1-i2v` | 前台 schema 选项 |
| 百炼多参考图 SKU | `wan2.7-r2v` / `happyhorse-1.1-r2v` | 前台 schema 选项 |

重要策略：

- `BailianAdapter` 当前默认会强制把百炼视频 SKU 的实际请求模型切到 HappyHorse 1.1。
- 如需关闭强制切换，可设置 `BAILIAN_FORCE_HAPPYHORSE_MODEL=false` 或 `DASHSCOPE_FORCE_HAPPYHORSE_MODEL=false`。
- HappyHorse 1.1 当前按六折期口径计费：`150 积分/秒`；旧百炼视频口径是 `250 积分/秒`。
- 前台仍保留“通义万相 2.7 / HappyHorse 1.1”两个选项，便于随时切回万相，但后端默认更偏向 HappyHorse。

关键环境变量：

```env
DASHSCOPE_API_KEY=
BAILIAN_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
DASHSCOPE_COMPAT_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
ALIYUN_STORYBOARD_MODEL=qwen3.7-plus
ALIYUN_STORYBOARD_VISION_MODEL=qwen-vl-max
ALIYUN_IMAGE_MODEL=wan2.7-image-pro
ALIYUN_I2V_MODEL=wan2.7-i2v-2026-04-25
ALIYUN_I2V_RESOLUTION=720P
BAILIAN_FORCE_HAPPYHORSE_MODEL=true
```

### 4.2 阿里云 IMS / ICE

用于“一句话成片”的最终视频合成，可输出到 OSS 或 VOD。

```env
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_IMS_REGION=cn-shanghai
ALIYUN_IMS_OUTPUT_TARGET=oss-object
ALIYUN_IMS_OUTPUT_MEDIA_URL_TEMPLATE=https://your-bucket.oss-cn-shanghai.aliyuncs.com/one-prompt-video/{projectId}-{timestamp}.mp4
```

如果没有配置 IMS，可走本地 FFmpeg 合成链路，最终仍需要 OSS 或可访问的存储地址承载成片。

### 4.3 RunningHub

RunningHub 主要承载 ComfyUI 工作流和 AI App，两类接口要区分：

| 类型 | 接口 | 典型环境变量 |
| --- | --- | --- |
| ComfyUI 工作流 | `/openapi/v2/run/workflow/{workflowId}` | `RUNNINGHUB_*_WORKFLOW_ID` |
| AI App | `/openapi/v2/run/ai-app/{appId}` | `RUNNINGHUB_*_APP_ID` |

当前 RunningHub 工作流 / App：

```env
RUNNINGHUB_API_KEY=
RUNNINGHUB_API_BASE_URL=https://www.runninghub.cn
RUNNINGHUB_TXT2IMG_REMOTE_WORKFLOW_ID=
RUNNINGHUB_IMG2VIDEO_REMOTE_WORKFLOW_ID=
RUNNINGHUB_SVD_REMOTE_WORKFLOW_ID=
RUNNINGHUB_STORYBOARD_REMOTE_WORKFLOW_ID=
RUNNINGHUB_PROMPT_REVERSE_WORKFLOW_ID=
RUNNINGHUB_FACE_SWAP_WORKFLOW_ID=
RUNNINGHUB_HD_UPSCALE_APP_ID=
RUNNINGHUB_MATTING_APP_ID=
RUNNINGHUB_BG_REPLACE_APP_ID=
RUNNINGHUB_VIDEO_ENHANCE_APP_ID=
```

工程约定：

- RunningHub 工作流类能力尽量发送“完整 Comfy JSON + 本地节点覆盖”，避免只提交 `nodeInfoList` 导致 Custom validation 秒失败。
- 图片字段要用 RunningHub 上传接口返回的 `api/...` 路径；网关会把公网图片 URL 拉取并上传后替换。
- 新增 RunningHub 能力时优先参考 `docs/runninghub-api.md`。

### 4.4 302.ai / Kling

用于 Kling 图生视频，当前有标准版和高级版适配能力。

| Provider | 模型路径 | 说明 | 费用 |
| --- | --- | --- | --- |
| `KLING_STD` | `kwaivgi/kling-v2.6-std/image-to-video` | 302.ai Kling 标准版图生视频 | 400 |
| `KLING_PRO` | `kwaivgi/kling-video-o3-pro/image-to-video` | 302.ai Kling O3 Pro 图生视频，当前目录里高级版 SKU 暂隐藏 | 600 |

关键环境变量：

```env
KLING_302AI_BASE_URL=https://api.302.ai/ws/api/v3
KLING_STD_API_KEY=
KLING_PRO_API_KEY=
WORKBENCH_302AI_API_KEY=
```

### 4.5 OpenAI / GPT Image

用于图片生成和 Workbench 图片类能力。

| 用途 | 模型 | 环境变量 |
| --- | --- | --- |
| 智能图片生成 | `gpt-image-2` | `SOCIAL_OPENAI_API_KEY` / `OPENAI_API_KEY` |
| Workbench 图片工作流 | `gpt-image-2`、`gpt-image-1`、`gpt-image-2-all`、`dall-e-3` 等 | 管理后台模型配置或环境变量 |

计费口径：

- low：20 积分/张
- medium：50 积分/张
- high：150 积分/张
- auto：按 medium 参考价 50 积分/张

## 5. 一句话成片工作流

入口：

- `/workbench/tools/one-prompt-video`
- `/workbench/workflows/one-prompt-video`

核心定位：用户输入一句话和可选参考图，系统自动拆成可审查的视频生产项目，而不是一次性黑盒生成。

当前主链路：

1. 创建项目：`POST /api/video-projects`
2. 生成分镜计划：`POST /api/video-projects/[projectId]/plan`
3. 审核计划：`POST /api/video-projects/[projectId]/approve-plan`
4. 生成关键帧 / 微分镜图：`POST /api/video-projects/[projectId]/shots/[shotId]/image`
5. 审核图片：`POST /api/video-projects/[projectId]/approve-images`
6. 审核内部微分镜：`POST /api/video-projects/[projectId]/approve-micro-shots`
7. 生成视频片段：由项目服务推进并轮询上游任务
8. 合成成片：`POST /api/video-projects/[projectId]/compose`
9. 完成归档：`POST /api/video-projects/[projectId]/finish`
10. 同步状态：`POST /api/video-projects/[projectId]/sync`
11. 回滚阶段：`POST /api/video-projects/[projectId]/rollback`

数据模型：

| 表 | 作用 |
| --- | --- |
| `video_projects` | 保存一次“一句话成片”项目、用户输入、整体状态、最终视频 URL |
| `video_shots` | 保存片段/镜头级信息、图片、视频 URL、任务 ID、锁定状态 |
| `video_keyframes` | 保存边界关键帧，服务于首尾帧连续性 |
| `video_segments` | 保存相邻关键帧之间的视频片段 |

设计重点：

- 不是“一键等结果”，而是“计划 -> 审核 -> 生成 -> 审核 -> 合成”的企业级可控流程。
- 用户可以在关键阶段人工确认，降低长任务失败和成本浪费。
- 支持局部重试、锁定满意结果、按阶段回滚。
- 参考图最多进入规划和生成链路，用来稳定角色、产品、场景和风格。

## 6. Workbench 运营工作流

Workbench 是社媒/运营内容生产后台，集成在 `/workbench/*` 下，后端来自 `ai-workflow-code/backend`，通过 Next.js 的 `/api/workbench/*` 代理访问。

主要工作流：

| 路由 | 名称 | 用途 |
| --- | --- | --- |
| `/workbench/workflows/expression` | 表情制作 | 生成表情图并入库 |
| `/workbench/workflows/activity` | 活动图生产 | 选模板、填内容、生成图片、质检归档 |
| `/workbench/workflows/daily-post` | 日常互动图 | 6 步向导式日常社媒互动图生产 |
| `/workbench/workflows/trending` | 热点借势图 | 基于热点事件生成运营图片 |
| `/workbench/workflows/trending-news` | 热点借势·新闻 | 面向新闻热点的配图生产 |
| `/workbench/workflows/share` | 分享图 | 分享卡片类图片生成 |
| `/workbench/workflows/background` | 背景图生成 | 背景图批次生成、筛选、精修、入素材库 |
| `/workbench/workflows/logo` | Logo 水印 | 批量为成品图叠加 Logo |
| `/workbench/workflows/multi-fusion` | 多图融合 | 多参考素材融合生成 |
| `/workbench/workflows/video` | 视频制作 | 7 步视频工作流：首帧、草稿、动效、精品、字幕、合成、归档 |
| `/workbench/workflows/one-prompt-video` | 一句话成片 | 新一代 AI 视频编排工作流 |

Workbench 配套模块：

- 素材库：`/workbench/assets`
- 成品库：`/workbench/gallery`
- 视频成品库：`/workbench/videos`
- 任务中心：`/workbench/tasks`
- 审核中心：`/workbench/review`
- 数据统计：`/workbench/stats`
- 模型配置：`/workbench/admin/models`
- API Key 管理：`/workbench/admin/api-keys`
- 用户管理：`/workbench/admin/users`

## 7. 积分、成本与统计

项目有两套成本口径：

1. 目录价 / 预估价：来自 SKU 的 `sellCredits` 或适配器 `calculateCost`。
2. 实际扣费：任务成功后结合 provider 返回成本、耗时或固定费用进行扣减。

关键表：

| 表 | 说明 |
| --- | --- |
| `generation_histories` | 记录每次生成任务的 SKU、provider、状态、结果 URL、实际成本、错误信息 |
| `transactions` | 记录积分充值和消费流水 |
| `api_logs` | 记录接口调用、外部任务 ID、耗时、成本和利润 |

重点字段：

- `sku_id`：业务功能编号。
- `provider_code`：实际上游适配器。
- `actual_cost`：上游实际成本或解析出的费用。
- `duration_int`：上游任务耗时或百炼墙钟耗时。
- `error_message`：失败原因。

## 8. 部署与运行口径

当前统一口径：

- 本地开发：`npm run dev` -> `http://localhost:3001`
- Docker Web：容器内部监听 `3001`
- Compose 映射：`${WEB_PORT:-3001}:3001`
- Nginx upstream：`web:3001`

常用命令：

```powershell
npm run dev
```

```powershell
docker compose build web
docker compose up -d web nginx
```

服务器镜像转移流程见：

- `docs/docker-image-transfer-workflow.md`

部署注意事项：

- 如果只改前端 / Next.js 代码，只需要重新构建并上传 `workflow-web.tar`。
- 如果改 `ai-workflow-code/backend`，才需要重新构建并上传 `workbench-backend.tar`。
- 如果改 Prisma schema，需要服务器同步最新 `prisma/` 目录后再执行 `prisma db push`。
- 不要用旧的 `prisma/schema.prisma` 执行 `db push --accept-data-loss`，否则可能删除新表，例如 `video_projects`、`video_keyframes`、`video_segments`。

## 9. 后续扩展建议

项目后续最值得增强的方向：

- 把“一句话成片”做成企业视频生产中枢：脚本、镜头、关键帧、片段、成片、审核、返工全链路可控。
- 增加品牌资产库：角色、产品、场景、Logo、口播风格、字幕模板可复用。
- 增加预算控制：生成前显示预计成本，按阶段确认扣费。
- 增加 A/B 版本：同一脚本生成多个风格版本，方便运营挑选。
- 增加质量检测：黑屏、文字乱码、人物漂移、产品变形、首尾帧不匹配自动标记。
- 增加企业权限：按团队、项目、品牌线管理素材、模型、额度和审核流。
- 增加插件市场：把视频、图片、社媒、招聘、BI 等能力沉淀为可授权的 Skill/MCP/Tool 生态。
