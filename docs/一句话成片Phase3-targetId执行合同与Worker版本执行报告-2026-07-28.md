# 一句话成片 Phase 3：targetId、执行合同与 Worker 版本执行报告

执行日期：2026-07-28

## 执行结论

Phase 3 已完成代码硬切换、数据库迁移和历史数据检查。

当前系统具备以下门禁：

- `VideoProductionJob.targetId` 数据库非空且禁止空白字符串。
- 无法确定历史 target 的任务只能标记 `MIGRATION_FAILED_TARGET`，不得选择“第一个可生成目标”。
- 新 job payload 强制携带 `payloadSchemaVersion`、`requiredWorkerVersion`、`contractVersion`。
- Worker 只有在 runtime、kind、payload version 和 contract version 全部兼容时才能原子领取任务。
- provider 只接收英文 canonical execution contract 的 Prompt。
- 中文 Prompt 只属于展示数据；中文编辑不会覆盖执行 Prompt。
- 新旧字段同时存在且内容冲突时返回 `PLAN_FIELD_ALIAS_CONFLICT / MIGRATE_PLAN_FIELDS`。

## 1. targetId 强约束

迁移按以下规则分类历史空 target：

```text
planning/image_quality → projectId
compose                → final
image job              → artifact 对应的 VideoKeyframe.id
clip job               → artifact 对应的 VideoSegment.id
micro-shot job         → projectId:artifactId
无法确定                → migration_failed:<jobId>
```

无法确定的任务会被取消，并记录：

```text
errorCode: MIGRATION_FAILED_TARGET
recoveryAction: MIGRATE_TARGET_ID
```

历史 `project_reconcile` 继续保持归档状态，不参与 target 迁移执行。

数据库约束：

```sql
target_id IS NOT NULL
LENGTH(BTRIM(target_id)) > 0
```

Worker 不再包含 `inferredTarget` 或 `first generatable target` 逻辑。

## 2. Canonical execution contract v2

新增唯一 provider 执行合同：

```json
{
  "schemaVersion": 2,
  "language": "en",
  "targetId": "...",
  "artifactId": "...",
  "revision": 3,
  "prompt": "...",
  "negativePrompt": "...",
  "constraints": {},
  "references": [],
  "display": {
    "zh": {
      "prompt": "..."
    }
  }
}
```

执行合同会在图片和视频真正提交 provider 之前校验：

- schemaVersion 必须为 2。
- language 必须为 `en`。
- targetId、artifactId、prompt 必须存在。
- revision 必须为正整数。
- canonical prompt/negativePrompt 不允许包含中文展示正文。
- references 必须明确 URL 和角色。

provider Prompt 只能通过 `providerPromptFromExecutionContract()` 取得。

候选媒体 metadata 保存当次 `executionContract`，便于审计实际提交内容。

## 3. 中文展示与执行字段隔离

已删除生产代码和维护脚本中的以下写法：

```text
imagePrompt = imagePromptZh
videoPrompt = videoPromptZh
```

规划器、三阶段规划器、Demo 初始化、项目落库和历史提示词维护脚本均改为：

```text
imagePrompt = imagePromptEn
videoPrompt = videoPromptEn
```

前端中文 Prompt 编辑只更新 `imagePromptZh`，不再同时更新 `imagePrompt`。英文编辑仍可更新 canonical 执行字段。

## 4. 字段别名冲突

迁移入口会先 canonicalize 以下字段：

```text
segmentNo / segment_no / shotNo / shot_no / sequence
imagePrompt / image_prompt
consistencyManifest / consistency_manifest
planningManifest / planning_manifest
```

多个别名值一致时会合并到 canonical 字段并删除旧别名。

值不一致时抛出：

```json
{
  "errorCode": "PLAN_FIELD_ALIAS_CONFLICT",
  "recoveryAction": "MIGRATE_PLAN_FIELDS",
  "conflicts": ["具体冲突路径"]
}
```

项目 GET/PATCH 接口对该错误返回 HTTP 409。Worker 会把同一错误保存为结构化 job 失败，不会继续提交 provider。

本次数据库检查发现一个真实历史冲突：

```text
projectId:
cms4hwin700kltvvww69mtj5c

conflict:
$.plannerCheckpoint.planningRaw.planningManifest
<-> planning_manifest
```

系统没有替该项目静默选择字段。对应 planning job 已标记：

```text
status: failed
errorCode: PLAN_FIELD_ALIAS_CONFLICT
recoveryAction: MIGRATE_PLAN_FIELDS
```

项目进入 `WAITING_RECOVERY`。

## 5. Worker 三版本握手

每个新 job payload 强制写入：

```text
payloadSchemaVersion = 2
requiredWorkerVersion = 当前源码/部署版本
contractVersion = 2
```

Worker 注册信息：

```text
runtimeVersion
supportedKinds
supportedPayloadVersions
processId
startedAt
heartbeatAt
```

领取任务时，查询和原子 `updateMany` 使用同一兼容条件：

```text
job.requiredWorkerVersion == worker.runtimeVersion
payload.requiredWorkerVersion == worker.runtimeVersion
payload.payloadSchemaVersion ∈ worker.supportedPayloadVersions
payload.contractVersion == 2
job.kind ∈ worker.supportedKinds
```

删除了 `requiredWorkerVersion = null` 的兼容领取分支。

无兼容 Worker 时：

```text
job.status: queued
errorCode: NO_COMPATIBLE_WORKER
recoveryAction: DEPLOY_COMPATIBLE_WORKER
```

UI 从项目生产投影展示该运维错误。

显式重新入队时，如果存在旧版本活动 job：

1. 旧 job 标记 `PAYLOAD_VERSION_SUPERSEDED` 并取消。
2. 使用带 payload、contract、Worker 版本后缀的新 idempotency key 创建新 job。
3. 新 Worker 不会直接执行或覆盖旧 payload。

## 6. 数据库迁移

已应用：

```text
20260728235000_enforce_phase3_target_contract_worker_handshake
```

迁移状态：

```text
29 migrations found
Database schema is up to date
```

历史终态 job 保留为只读协议 v1：

```text
cancelled / payload 1 / contract 1    2843
completed / payload 1 / contract 1       9
```

发现字段冲突的 job 保留为：

```text
failed / payload 2 / contract 2           1
```

旧 Worker runtime 全部标记只支持 payload v1。它们必须由新 Worker heartbeat 后才能声明支持 v2。

## 7. 数据库验收

```text
targetId 为 null/空                         0
requiredWorkerVersion 为 null/空            0
payload 三版本握手约束违规                   0
活动 legacy payload                         0
migration_failed target                     0
活动 production job                         0
```

`migration_failed target = 0` 表示本数据库没有无法识别 target 的历史任务，不表示系统会对未来损坏数据进行猜测。

## 8. 版本不兼容实测

使用数据库中的 v2 job 做领取验证：

```text
当前新 Worker 领取旧 runtime job       false
旧 Worker（只支持 payload v1）领取 v2  false
job status                             queued
workerId                               null
claimedWorkerVersion                   null
errorCode                              NO_COMPATIBLE_WORKER
```

验证完成后，该 job 因真实计划字段冲突被转换为结构化失败，未提交 provider。

## 9. 自动化测试

Phase 1–3 架构与合同测试：

```text
43 passed
0 failed
```

完整一句话成片测试：

```text
443 tests
432 passed
11 failed
```

11 项失败与 Phase 2 的既有失败集合一致，没有新增 Phase 3 回归。

`prisma validate`、`prisma migrate status` 和 scoped `git diff --check` 均通过。

全量 TypeScript 检查只报告仓库既有的测试文件 `.ts` 扩展导入 `TS5097`，没有 Phase 3 生产源码类型错误。

## 10. 当前运行保护

```text
NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN=true
next dev                                     0
video-production-worker.ts                   0
项目相关 ffmpeg                              0
```

Phase 3 完成后迁移锁保持开启，Web、Worker 和项目 FFmpeg 均未启动。

## 11. 主要文件

- `prisma/schema.prisma`
- `prisma/migrations/20260728235000_enforce_phase3_target_contract_worker_handshake/migration.sql`
- `src/services/video-orchestrator/canonical-execution-contract.ts`
- `src/services/video-orchestrator/canonical-plan-fields.ts`
- `src/services/video-orchestrator/production-job-queue.ts`
- `src/services/video-orchestrator/production-worker-runtime.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/project-production-projection.ts`
- `src/services/video-orchestrator/phase3-contract-worker.test.ts`
- `scripts/video-production-worker.ts`
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`
