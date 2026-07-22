# One Prompt Video 阶段 10：可选数据表拆分执行报告

## 执行结论

阶段 10 的数据库模型、迁移 SQL、双写层、历史 backfill、核对工具和可灰度切读已经实现。当前代码仍以 `planJson` 为默认读写真源，两个阶段 10 开关默认关闭，因此部署代码本身不会改变现有项目行为。

本次没有直接对当前 `DATABASE_URL` 执行迁移，也没有运行真实历史数据 backfill，避免在未确认数据库环境和备份状态时修改正在使用的数据库。

## 新增数据表

- `VideoConsistencyAnchorImage`
- `VideoAnchorReferenceView`
- `VideoReferenceSelectionOutput`
- `VideoPromptCompilation`
- `VideoGenerationQualityReport`
- `VideoAudioAsset`
- `VideoTransitionReference`
- `VideoArtifactMetadata`

每张表均包含项目外键、业务 artifact key、revision、查询所需的结构化字段和完整 JSON payload。唯一约束包含 revision，因此写入新版本不会覆盖旧版本。

质量报告额外使用 `reportKey` 区分同一 asset 的多个候选报告，避免候选之间互相覆盖。

## 兼容策略

### planJson 镜像

- 所有现有 `planJson` 写入继续保留。
- 双写发生在 `planJson` 成功更新之后。
- 不删除历史 `consistencyReferences`、`referenceSelectionOutputs`、`promptDebugArtifacts`、`generationQualityReports`、`audioBible`、`transitionReferenceArtifacts` 或 `artifactMetadata`。
- 当前阶段没有提供停止整个 `planJson` 写入的开关；必须等真实灰度核对稳定后再单独设计。

### 双写开关

```env
ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE=false
```

关闭时完全保持现有行为。数据库迁移完成后才允许设置为 `true`。

已接入的高频写入包括：

- 项目重新规划。
- Reference Selector 输出。
- Prompt Compiler 输出。
- Generation Quality Report。
- Artifact Metadata 状态和 revision 更新。
- 三视图、audio bible 和 transition reference 镜像同步。

### 切读开关

```env
ONE_PROMPT_ARTIFACT_TABLES_READ=false
```

切读仅覆盖内存中的项目读取结果，仍保留数据库中的原始 `planJson`。每类表按 revision 降序选择最新版本。

如果某类新表没有数据，则继续读取 `planJson` 中的旧字段，不会用空数组或空对象覆盖历史内容。

## 上线执行顺序

1. 备份数据库，并确认阶段 0 至阶段 9 回归均通过。
2. 执行：

   ```bash
   npx prisma migrate deploy
   ```

3. 保持 `ONE_PROMPT_ARTIFACT_TABLES_READ=false`，开启：

   ```env
   ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE=true
   ```

4. 让少量新项目运行双写，检查数据库错误和 revision 数量。
5. 执行历史 backfill 和逐项目核对：

   ```bash
   npm run backfill:one-prompt-artifacts
   ```

6. 必须得到 `mismatched=0`。如不为 0，不得切读。
7. 在内部环境开启 `ONE_PROMPT_ARTIFACT_TABLES_READ=true`，完成打开、审核、重新生成、恢复和回退测试。
8. 再按少量新项目、全量新项目、历史项目的顺序扩大切读范围。
9. 迁移期间始终保留 planJson 双写；停止旧写入不属于本次立即启用范围。

## 回退方式

- 关闭 `ONE_PROMPT_ARTIFACT_TABLES_READ`：立即恢复 planJson 读取。
- 关闭 `ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE`：停止新表镜像，不影响 planJson 主流程。
- 新表仅为新增表，迁移 SQL 不包含 `DROP`、`DELETE` 或 planJson 字段修改。
- 回退不删除任何新表 revision，也不改变已批准媒体。

## 验证结果

- Prisma schema format：通过。
- Prisma schema validate：通过。
- Prisma Client 类型生成：通过。
- 阶段 10 专项测试：6/6 通过。
- One Prompt Video 全量回归：123/123 通过。
- 阶段 10 相关文件 ESLint：通过。
- `npm run build`：通过。

构建仍报告仓库其他页面既有的 React Hook warnings，不阻断构建。

## 主要文件

- `prisma/schema.prisma`
- `prisma/migrations/20260722110000_split_video_artifacts/migration.sql`
- `src/services/video-orchestrator/plan-artifact-store.ts`
- `src/services/video-orchestrator/project-service.ts`
- `scripts/backfill-one-prompt-artifact-tables.ts`
- `src/services/video-orchestrator/artifact-table-split.test.ts`
