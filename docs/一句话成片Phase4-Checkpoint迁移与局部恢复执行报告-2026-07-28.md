# 一句话成片 Phase 4：Checkpoint 迁移与局部恢复执行报告

执行日期：2026-07-28

## 执行结论

Phase 4 已完成代码切换、历史 Checkpoint 迁移和数据库复核。

当前行为：

- Checkpoint 使用 v14 标准信封，包含 `checkpointVersion`、`plannerMode`、`inputFingerprint`、`inputSnapshot`、`completedStages`、`stageOutputs`、`contractVersions`、`referenceFingerprint`。
- v12、v13 通过显式迁移器升级到 v14，不再因版本号不同返回空 Checkpoint。
- plannerMode 从旧模式切到 split 时保留可复用的参考分析，只失效 story architect 及下游。
- 用户故事输入、参考图、阶段合同分别按依赖边界做最小失效。
- 中文 UI 展示、Worker 版本和代码版本不参与规划输入指纹。
- 每次恢复记录 `preservedStages`、`invalidatedStages` 和 `reasons`。
- 历史迁移脚本是幂等的；迁移后再次 dry-run 的变更项目数为 0。

迁移期间：

```text
NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN=true
Web 进程：0
Worker 进程：0
项目 FFmpeg 进程：0
```

## 1. Checkpoint v14 信封

v14 的 canonical 字段：

```json
{
  "checkpointVersion": 14,
  "plannerMode": "split",
  "inputFingerprint": "...",
  "inputSnapshot": {},
  "completedStages": [],
  "stageOutputs": {},
  "contractVersions": {},
  "referenceFingerprint": "...",
  "migrationAudit": {
    "fromVersion": 13,
    "toVersion": 14,
    "preservedStages": [],
    "invalidatedStages": [],
    "reasons": [],
    "migratedAt": "..."
  }
}
```

保存 Checkpoint 前会统一同步以上字段，防止运行过程只更新旧的扁平字段。

## 2. 显式版本迁移

已实现：

```text
migrateCheckpointV12ToV13
migrateCheckpointV13ToV14
migrateCheckpointEnvelopeToV14
```

旧版本迁移先从已有具体产物推断已完成阶段，再建立 `stageOutputs` 和合同版本信息。未知历史版本也按已有产物迁移，不会只因为版本号未知而清空。

## 3. 最小失效规则

阶段依赖顺序：

```text
reference_analysis
→ story_architect
→ asset_contract
→ storyboard_artist
→ story_validation
→ shot_decomposition
→ prompt_compilation
```

失效规则：

| 变化 | 保留 | 失效 |
|---|---|---|
| 中文 UI 展示变化 | 全部执行阶段 | 无 |
| Worker/代码版本变化 | 全部规划阶段 | 无 |
| prompt compilation 合同变化 | 上游全部阶段 | prompt compilation |
| Story 输入变化 | reference analysis | story architect 及下游 |
| 参考图变化 | 无 | reference analysis 及全部下游 |
| legacy plannerMode → split | reference analysis | story architect 及下游 |

恢复日志事件：

```text
aliyun.storyboard.checkpoint.resume_plan
```

日志包含：

```text
preservedStages
invalidatedStages
invalidationReasons
referenceFingerprint
checkpointVersion
plannerMode
```

## 4. 历史数据库迁移

迁移脚本：

```text
scripts/migrate-one-prompt-checkpoints-v14.ts
```

脚本支持：

```text
dry-run：npx tsx scripts/migrate-one-prompt-checkpoints-v14.ts
apply：  npx tsx scripts/migrate-one-prompt-checkpoints-v14.ts --apply
```

apply 模式在迁移锁未开启时会拒绝执行。

本次扫描结果：

```text
video_projects with planJson：6
含 plannerCheckpoint 的项目：1
实际迁移项目：1
保留阶段总数：3
失效阶段总数：0
```

项目 `cms4hwin700kltvvww69mtj5c` 保留：

```text
reference_analysis
story_architect
asset_contract
```

没有重新执行参考图分析，也没有清空剧本架构或资产合同。

迁移后再次 dry-run：

```text
changedProjects：0
```

证明迁移脚本可重复执行且不会反复改写 Checkpoint。

迁移报告：

```text
backups/one-prompt-phase4/checkpoint-v14-apply-2026-07-28T15-05-38-413Z.json
backups/one-prompt-phase4/checkpoint-v14-dry-run-2026-07-28T15-06-35-400Z.json
```

## 5. 验收结果

通过：

```text
TypeScript 生产错误：0
Checkpoint 功能测试：18/18
Phase 4 架构防回归测试：4/4
production architecture：47/47
历史迁移后二次 dry-run：0 个待变更项目
```

完整一句话成片测试：

```text
总数：447
通过：436
失败：11
```

这 11 项是 Phase 1–3 硬切换后仍未更新的旧行为断言，失败集合与 Phase 4 执行前基线一致；本次新增的 Checkpoint 测试和生产架构测试全部通过。

## 6. 当前仍保持的运行状态

迁移锁仍为开启状态，Web 和 Worker 没有启动。继续执行后续迁移阶段前无需重新冻结；需要恢复业务时再明确关闭迁移锁并启动新版 Worker。
