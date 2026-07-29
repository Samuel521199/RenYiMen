# 一句话成片 Phase 5：Artifact Tables 唯一执行权威执行报告

执行日期：2026-07-28

## 执行结论

Phase 5 已完成代码硬切换、一次性历史迁移、隔离处理和真实数据库验收。

当前权威关系：

```text
artifact tables → 只读 planJson snapshot
```

已禁止运行时反向覆盖：

```text
planJson → artifact tables
```

`planJson` 现在只是兼容展示快照。执行器、恢复逻辑和 GET 项目接口均从 artifact-table execution snapshot 读取。

## 1. 唯一权威结构

在 `video_artifact_metadata` 中增加两个保留 artifact：

```text
__snapshot__:execution_plan_v1
__migration__:artifact_tables_v2
```

execution snapshot 保存：

```text
schemaVersion
contentHash
source
plan
tableCounts
writtenAt
```

migration marker 保存：

```text
status
sourceHash
authorityHash
authority=artifact_tables
tableCounts
completedAt
```

执行读取必须同时满足：

1. migration marker 状态为 `completed`。
2. execution snapshot 存在。
3. snapshot payload hash 与 `contentHash` 一致。
4. 当前 8 张 artifact table 的数量与 marker 中的 `tableCounts` 一致。

任一条件不满足都会抛出：

```text
ARTIFACT_AUTHORITY_NOT_READY
或
ARTIFACT_MIGRATION_QUARANTINED
```

不再允许部分表有数据时继续静默执行。

## 2. 一次性数据迁移

迁移脚本：

```text
scripts/backfill-one-prompt-artifact-tables.ts
```

迁移流程：

```text
读取 planJson
→ canonicalize aliases
→ 清理该项目旧 artifact 镜像
→ 写入 8 张 artifact tables
→ 写入完整 execution snapshot
→ 比较数量、revision、metadata hash、完整计划 hash
→ 写 completed marker
```

字段冲突或校验失败时：

```text
marker.status = quarantined
project.status = WAITING_RECOVERY
errorCode = ARTIFACT_MIGRATION_INCOMPLETE
recoveryAction = REPAIR_PLAN_FIELDS
```

本次迁移结果：

```text
项目总数：6
迁移成功：5
隔离：1
空计划：0
```

5 个成功项目的 `sourceHash` 与 `authorityHash` 全部一致，differences 全部为空。

隔离项目：

```text
cms4hwin700kltvvww69mtj5c
```

隔离原因：

```text
$.plannerCheckpoint.planningRaw.planningManifest
与 planning_manifest 冲突

$.plannerCheckpoint.stageOutputs.asset_contract.planningRaw.planningManifest
与 planning_manifest 冲突
```

系统没有静默选择任意一个字段。

迁移报告：

```text
backups/one-prompt-phase5/artifact-authority-apply-2026-07-28T15-18-39-422Z.json
```

## 3. 读取权威切换

`getVideoProject()` 当前行为：

```text
查询项目实体
→ readArtifactPlan(projectId)
→ 返回 artifact execution snapshot
```

GET 中已删除：

```text
canonicalize 后写回 planJson
ensurePlanArtifactsBackfilled
hydratePlanArtifactsFromTables
transition backfill 写入
artifact metadata 自动写入
videoProject.update
```

因此 GET 不会修改 `updatedAt`。

列表读取只展示 artifact authority。隔离项目不会把原始 `planJson` 当成执行计划返回。

## 4. 写入权威切换

所有运行时计划修改统一调用：

```text
commitArtifactPlan(projectId, canonicalPlan)
```

写入顺序：

```text
1. 写各专用 artifact tables
2. 写 execution snapshot 与 marker
3. 从已提交的 authority 生成 planJson 兼容快照
```

已切换的修改类型包括：

- Prompt compilation/revision
- Reference selection
- Generation quality report
- Transition reference
- Audio assets
- Artifact metadata/dependency
- Planning checkpoint/progress
- Micro-shot updates
- Media revision history
- 项目回滚与局部 dirty 状态
- Demo 初始化

维护脚本也已改为读取 `readArtifactPlan()` 并通过 `commitArtifactPlan()` 写入，不再直接修改 `planJson`。

## 5. Feature flags 清理

生产代码、配置、脚本中已不存在：

```text
ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE
ONE_PROMPT_ARTIFACT_TABLES_READ
```

不再提供独立 read/write 开关，也不存在运行时双轨选择。

## 6. 真实数据库验收

验收脚本：

```text
scripts/verify-phase5-artifact-authority.ts
```

脚本建立临时项目，写入所有 artifact 类型后完成以下验证：

```text
8 张 artifact table 全部存在数据：通过
篡改/清空 planJson 后仍可从 artifact tables 恢复：通过
篡改 planJson 不会覆盖 artifact tables：通过
GET 项目不改变 updatedAt：通过
```

实际表记录：

```text
consistencyAnchorImages：1
anchorReferenceViews：1
referenceSelections：1
promptCompilations：1
qualityReports：1
audioAssets：2
transitionReferences：1
artifactMetadata：6
```

验收结束后临时项目已删除，残留临时项目数量为 0。

验收报告：

```text
backups/one-prompt-phase5/phase5-acceptance-2026-07-28T15-18-44-662Z.json
```

## 7. 测试结果

```text
TypeScript 生产错误：0
Phase 5 artifact 架构测试：6/6
Production architecture：53/53
真实数据库验收：通过
```

完整一句话成片测试：

```text
总数：447
通过：436
失败：11
```

失败的 11 项与 Phase 4 完整回归基线完全相同，属于 Phase 1–3 硬切换后尚未更新的旧行为断言；Phase 5 没有新增失败。

## 8. 当前运行状态

```text
NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN=true
Web：未启动
Worker：未启动
项目 FFmpeg：未启动
```

迁移锁仍保持开启。
