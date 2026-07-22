# 一句话成片：当前实现说明

本文描述 `/workbench/workflows/one-prompt-video` 的当前实现。早期 30 秒方案、ViMax 借鉴稿和分阶段执行计划已经合并到本文，不再作为独立规范。

## 1. 模块入口

| 层 | 路径 |
|---|---|
| 页面 | `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx` |
| API | `src/app/api/video-projects/` |
| 领域编排 | `src/services/video-orchestrator/project-service.ts` |
| 三阶段规划器 | `src/services/video-orchestrator/three-stage-planner.ts` |
| 类型契约 | `src/services/video-orchestrator/types.ts` |
| 数据模型 | `prisma/schema.prisma` |
| 本地合成 | `src/services/video-orchestrator/local-compose.ts` |

## 2. 当前流程

```text
DRAFT
  -> PLANNING
  -> PLAN_REVIEW
  -> IMAGE_GENERATING
  -> IMAGE_REVIEW
  -> MICRO_SHOT_REVIEW
  -> CLIP_GENERATING
  -> CLIP_REVIEW
  -> COMPOSING
  -> FINAL_REVIEW
  -> DONE
```

任一生成阶段可能进入 `FAILED`。`cancel` 停止继续推进，`resume` 根据已有产物恢复到可执行阶段；`rollback` 可回到 `PLAN_REVIEW`、`IMAGE_REVIEW`、`MICRO_SHOT_REVIEW` 或 `CLIP_REVIEW`，并清理目标阶段之后的派生产物。

实际审核顺序为：

1. 创建项目并生成剧本计划。
2. 审核剧本、资产库、关键帧和片段规划。
3. 先生成并锁定一致性资产，再生成边界关键帧。
4. 审核全部边界帧，生成需要的内部子分镜参考图。
5. 审核子分镜，批量生成视频片段。
6. 审核片段，使用本地 FFmpeg 合成并上传 OSS。
7. 预览成片并确认完成。

## 3. 数据模型

- `VideoProject`：项目输入、状态、`planJson`、最终视频和错误信息。
- `VideoKeyframe`：一致性资产参考图（负编号）与时间轴边界帧（正编号）。
- `VideoSegment`：相邻边界帧之间的视频片段，是当前主要生成单元。
- `VideoShot`：保留用于旧数据兼容；新流程优先使用 keyframes + segments。

`planJson` 保存规划器的丰富中间产物，包括 style/consistency manifest、asset library、narrative events、anchor state timeline、storyboard brief、micro shots、camera graph、reference selection、prompt debug artifacts、quality report、transition plan、audio bible 和 artifact metadata。数据库表只抽取高频查询和任务调度所需字段。

## 4. 三阶段规划器

默认 `ONE_PROMPT_VIDEO_PLANNER_ARCH=v2`：

1. Planning Architect：确定叙事、时间轴、风格、一致性锚点和资产。
2. Storyboard/Shot Decomposer：按 segment 生成可审核镜头、子分镜、机位和运动约束。
3. Prompt Detailer：编译图片与视频生成提示词及负面约束。

可选模式：

- `v2`：新规划器直接驱动生成。
- `v2_shadow`：记录 v2 结果，但由 v1 兼容计划驱动生成。
- `v1`：仅使用本地旧规划器，主要用于回滚。

规划器会归一化大模型输出。新增字段必须保证缺失时有兼容默认值，不能让历史 `planJson` 无法读取。

## 5. 一致性和可恢复性

- 人物、产品、道具、品牌和空间布局以 consistency anchors/asset library 表示。
- 一致性资产优先生成并锁定，后续图片 prompt 通过确定性的 reference selector 选择引用。
- segment 内要求单一连续镜头；跨场景变化应在 segment 边界发生。
- artifact metadata 记录 `draft`、`dirty`、`approved`、`generating`、`ready`、`failed`，用于局部重试和脏状态传播。
- 编辑器中的字段可撤销到最近一次服务端保存值；关键帧图、子分镜参考图、视频片段和最终成片在重新生成前会把当前 URL 写入 `planJson.mediaRevisionHistory`，每个对象最多保留 10 个版本并支持连续回退。
- 修改上游规划内容后，应从最早受影响阶段恢复，不复用已经失效的图片、片段或成片。

## 6. API

所有接口都要求当前登录用户拥有项目。

| 方法与路径 | 用途 |
|---|---|
| `GET/POST /api/video-projects` | 列表、创建 |
| `GET/PATCH/DELETE /api/video-projects/{id}` | 读取、修改、删除 |
| `POST /api/video-projects/{id}/plan` | 生成计划 |
| `POST /api/video-projects/{id}/approve-plan` | 批准计划并开始图片阶段 |
| `POST /api/video-projects/{id}/approve-assets` | 锁定一致性资产并继续边界帧 |
| `POST /api/video-projects/{id}/approve-images` | 批准关键帧并准备子分镜 |
| `POST /api/video-projects/{id}/approve-micro-shots` | 批准子分镜并开始片段生成 |
| `POST /api/video-projects/{id}/compose` | 合成成片 |
| `POST /api/video-projects/{id}/finish` | 确认完成 |
| `POST /api/video-projects/{id}/sync` | 同步异步任务状态 |
| `POST /api/video-projects/{id}/cancel` | 停止当前推进 |
| `POST /api/video-projects/{id}/resume` | 从现有产物恢复 |
| `POST /api/video-projects/{id}/rollback` | 回退到指定审核阶段 |
| `POST /api/video-projects/{id}/media-revisions/rollback` | 恢复单个媒体对象的上一生成版本 |
| `PATCH /api/video-projects/{id}/shots/{shotId}` | 修改片段/兼容镜头 |
| `POST .../shots/{shotId}/image` | 重生成对应图片 |
| `POST .../shots/{shotId}/clip` | 重生成片段 |
| `POST .../micro-shots/{no}/image` | 重生成子分镜参考图 |

## 7. 上游与合成

- 规划和图片生成使用 DashScope 兼容接口。
- 视频片段通过百炼异步视频接口生成。
- `syncVideoProject()` 轮询任务，并按配置并发补交下一批图片或片段。
- 最终成片由 FFmpeg 在本地合成，支持转场、字幕、BGM、响度归一化和源音频策略，随后上传 OSS。

生产环境至少需要：

```env
DASHSCOPE_API_KEY=<secret>
ONE_PROMPT_VIDEO_PLANNER_ARCH=v2
ALIYUN_STORYBOARD_MODEL=qwen3.7-plus
ALIYUN_IMAGE_MODEL=wan2.7-image-pro
ALIYUN_I2V_MODEL=vidu/viduq3-turbo_start-end2video
FFMPEG_PATH=<可选，默认 ffmpeg>
OSS_REGION=<region>
OSS_ACCESS_KEY_ID=<secret>
OSS_SECRET_ACCESS_KEY=<secret>
OSS_BUCKET_NAME=<bucket>
OSS_PUBLIC_DOMAIN=<https://...>
```

完整可选项和默认值以 `.env.example` 为准。

## 8. 变更验收

修改此模块至少验证：

- TypeScript 构建通过，Prisma schema 与迁移一致。
- v2 输出归一化后能被旧项目安全读取。
- 五个审核节点不能在前置产物缺失时越过。
- 单图、单片段重生成不污染无关产物。
- `FAILED`、cancel、resume 和各 rollback 目标可恢复。
- 并发数不超过上游限制，重复提交不会创建两套任务。
- FFmpeg 合成结果时长、画幅、字幕、音频和 OSS URL 正确。
- 固定样本通过 [one-prompt-video-script-decomposition-baseline.md](one-prompt-video-script-decomposition-baseline.md) 的验收。
