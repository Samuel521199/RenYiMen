# 一句话成片 Phase 2：统一 durable job 状态机执行报告

执行日期：2026-07-28

## 执行结论

Phase 2 已完成代码切换和数据库迁移。`VideoProductionJob` 现在是生产调度与项目阶段推进的唯一运行状态来源；`VideoProviderTaskLease` 只保留容量和上游任务租约职责；`VideoGenerationCandidate` 只保留候选媒体、质量结果和用户选择职责。

项目对外状态通过统一的 `projectProductionProjection(projectId)` 重建。投影不读取 candidate、provider lease、`imageTaskId`、`clipTaskId` 或 `composeTaskId` 来判断项目阶段。

## 1. 唯一 ProductionJob 状态机

生产 job 状态统一为：

```text
queued
claimed
running
waiting_upstream
waiting_review
completed
failed
cancelled
```

生产 job 阶段统一为：

```text
planning
contract_validation
provider_submission
provider_polling
quality_evaluation
composition
```

完成态 job 保留其真实业务阶段，不再写入 `completed/generating` 或 `completed/submitted` 一类矛盾组合。

失败 job 必须保存：

```text
errorCode
recoveryAction
lastError
```

Worker claim、heartbeat、上游轮询、容量退避和终态写入均已适配新状态机。上游轮询复用同一 durable job，只更新状态和 `availableAt`。

## 2. 数据库约束与迁移

已应用迁移：

- `20260728234000_unify_video_production_job_state_machine`
- `20260728234100_backfill_project_production_invariants`

迁移内容包括：

- 新增项目状态 `WAITING_RECOVERY`、`STATE_INVARIANT_VIOLATION`。
- 新增 job 字段 `error_code`、`recovery_action`。
- 历史 job stage 映射到六种 canonical stage。
- 冻结期间遗留的运行中 job 安全退回 `queued`。
- 失败 job 回填结构化恢复信息。
- 活动 target 唯一索引覆盖所有非终态 job 状态。
- 增加 job 状态、阶段、Worker lease 所有权和失败恢复信息的数据库 CHECK 约束。
- 将没有活动 job 的旧生成态项目迁移到恢复态或不变量违规态。

## 3. 项目状态只读投影

新增：

```text
projectProductionProjection(projectId)
```

投影仅使用：

1. ProductionJob。
2. task graph 的当前 frontier。
3. 待审批节点。
4. 已完成 artifact 数量。
5. 最终视频是否存在。

投影优先级：

```text
待审批节点
→ 活动 ProductionJob
→ 未被后续成功 job 覆盖的失败 job
→ 最终成片
→ task graph frontier
→ 状态不变量违规
```

每次 Worker 完成一次 job 状态转换后都会刷新持久化项目投影。API 序列化时还会重新计算投影，因此数据库里的旧项目状态不会成为 UI 的最终权威。

## 4. 终态不变量

以下情况不再允许显示为“生成中”：

```text
project.status = *_GENERATING
AND active production jobs = 0
```

处理规则已经实现：

- 存在未被后续成功 job 覆盖的失败 job：`WAITING_RECOVERY`。
- 存在审批节点：进入对应 review 状态。
- 最终产物完成：进入 `FINAL_REVIEW` 或 `DONE`。
- task graph 仍有待执行 frontier，但没有活动 job：`STATE_INVARIANT_VIOLATION`，恢复动作为 `REBUILD_TASK_GRAPH`。

前端会展示投影给出的结构化 `errorCode` 和 `recoveryAction`。

## 5. Lease 与 Candidate 权限收缩

已从项目阶段判定中删除：

- provider lease 的 waiting/running 状态。
- candidate 的 pending/running/succeeded 状态。
- candidate 是否存在。
- `imageTaskId`、`clipTaskId`、`composeTaskId`。

Candidate 同步不再：

- 直接修改 `VideoProject.status`。
- 调度下一个 target。
- 创建新的 reconcile job。

Candidate 在媒体就绪后仍可排入同一 target 的质量评估工作；这不代表它拥有项目阶段推进权。

## 6. 数据库验收结果

迁移后检查结果：

```text
非法 job status/stage                         0
failed job 缺少 errorCode/recoveryAction      0
生成态项目但 active job 为 0                  0
同 target/revision 重复活动 job               0
completed job 使用旧 stage                    0
活动 project_reconcile                        0
```

当前 job 分布：

```text
cancelled / provider_submission    2843
completed / provider_polling          6
completed / quality_evaluation        3
queued / planning                     1
```

当前项目分布：

```text
PLANNING       1
FINAL_REVIEW   2
DONE           3
```

唯一活动 job 是迁移前已有项目的 `queued/planning` job。迁移锁开启期间 Worker 不会消费它。

## 7. 自动化验证

Phase 2 架构测试：

```text
31 passed
0 failed
```

覆盖：

- 活动 durable job 是生成阶段唯一权威。
- 失败 job 产生结构化恢复投影。
- 后续成功 job 可以覆盖同 target 的旧失败。
- review gate 独立拥有审批状态。
- 无 job 的未完成 frontier 进入不变量违规。
- projector 不接受 candidate 或 provider lease 输入。

完整一句话成片测试：

```text
443 tests
432 passed
11 failed
```

这 11 项与 Phase 1 完成时的既有失败集合一致，没有新增 Phase 2 回归。它们是旧实现文本匹配或旧行为断言：

1. segment video sync uses deterministic validation and keeps visual review explicitly on demand
2. reference selection recovery re-evaluates the preserved candidate without paid regeneration
3. resume waits for explicit boundary approval before regenerating dirty downstream artifacts
4. prompt compiler injects narrative contracts into boundary images and segment videos
5. planning contract failures report returned upstream work instead of claiming no provider accepted it
6. project integration preserves front-first derivation and approved media
7. approving boundary frames opens micro-shot review without waiting for upstream submissions
8. reference approval returns before image submission and does not animate the save button
9. late candidate updates cannot recreate a micro-shot deleted by the user
10. front-view dependency waits are notices, not generation failures
11. keyframe regeneration preserves history and adds one learned candidate at a time

`prisma validate` 通过。

全量 TypeScript 检查只报告仓库既有的 `TS5097`：测试文件使用 `.ts` 扩展导入但 `allowImportingTsExtensions` 未开启；没有 Phase 2 生产源码类型错误。

## 8. 当前运行保护

```text
NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN=true
next dev                                     0
video-production-worker.ts                   0
项目相关 ffmpeg                              0
```

Phase 2 完成后迁移锁保持开启，Web、Worker 和项目 FFmpeg 均未启动。

## 9. 主要文件

- `prisma/schema.prisma`
- `prisma/migrations/20260728234000_unify_video_production_job_state_machine/migration.sql`
- `prisma/migrations/20260728234100_backfill_project_production_invariants/migration.sql`
- `src/services/video-orchestrator/production-job-queue.ts`
- `src/services/video-orchestrator/project-production-projection.ts`
- `src/services/video-orchestrator/project-production-projection.test.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/production-job-architecture.test.ts`
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`

