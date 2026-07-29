# 一句话成片 Phase 6：前端 TaskGraph 迁移执行报告

执行日期：2026-07-28

## 执行结果

Phase 6 已完成。前端当前以 `segments`、`keyframes` 和后端 `taskGraph` 投影为工作流权威，不再使用旧 `VideoShot` 视图模型，也不再通过媒体实体状态猜测项目阶段。

迁移锁保持开启：

```text
NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN=true
```

本阶段没有启动 Web、Worker 或生成任务。

## 已完成内容

### 1. 删除前端 VideoShot 兼容语义

- 删除 `VideoShot` 接口。
- 删除 `selectedShot`、`selectedShotId`、`shotNo` 和 `segmentToEditorShot`。
- 编辑器直接读取 `VideoSegment`。
- 选中态统一为 `selectedSegment` / `selectedSegmentId`。
- 后端段落序列化改为 `serializeVideoSegmentProjection`，不再输出 `shotNo` 或 `shots`。
- 微分镜前端投影不再暴露旧 `imageTaskId` / `imageStatus`。

### 2. taskGraph 成为 UI 阶段权威

后端 taskGraph 增加并返回：

```json
{
  "currentNode": "...",
  "status": "...",
  "progress": {
    "percent": 0,
    "completed": 0,
    "total": 0
  },
  "allowedActions": [],
  "recoveryAction": null
}
```

前端以下行为现在只由 taskGraph 决定：

- 当前阶段高亮。
- 项目进度条。
- 等待 Worker / 等待审批 / 可恢复 / 恢复失败提示。
- 审批按钮是否可用。
- 是否显示停止生成。
- 微分镜图片任务是否正在运行或失败。
- 项目列表是否需要继续轮询。

### 3. 修复“继续生成又像新建项目”

- `resumeProject()` 不再根据项目状态、关键帧数量和片段数量猜测是否需要完整重规划。
- 只有 taskGraph 返回 `RESUME_CURRENT_NODE` 或 `EXECUTE_RECOVERY_ACTION` 时允许恢复。
- 恢复请求固定执行 `resume_current_stage`。
- 恢复界面固定显示“恢复当前节点”，不会显示 `creating / 1%`。
- 删除前端 `creating` 乐观进度阶段。

### 4. 删除客户端驱动同步

- `/api/video-projects/[projectId]/sync` 路由保持删除。
- 页面不存在 `/sync` 请求。
- 轮询函数改名为 `pollProjectProjection`。
- 每次轮询只执行无副作用的项目 GET 投影读取。

### 5. 增加架构门禁

新增：

```text
src/services/video-orchestrator/phase6-taskgraph-frontend.test.ts
```

门禁覆盖：

- 页面不存在 VideoShot 旧语义。
- 页面不读取 `imageTaskId`、`clipTaskId`、`imageStatus`。
- 阶段、进度、动作来自 taskGraph。
- 恢复流程不显示创建项目。
- `/sync` 路由和请求不存在。
- 后端不输出 shots 兼容视图。

该门禁已加入：

```text
npm run test:production-architecture
```

## 验收结果

```text
npm run test:production-architecture
59 passed, 0 failed
```

```text
npm run build
compiled successfully
type validation passed
static pages generated successfully
```

构建仍报告仓库既有的 React Hook 警告，以及 standalone trace 复制 Windows 临时路径的非致命警告；两者均未导致构建失败，也不是 Phase 6 引入的业务错误。

## Phase 6 门禁结论

- 页面源码不存在 `VideoShot`、`selectedShot`、`shotNo`、`segmentToEditorShot`。
- 页面不读取 `imageTaskId` / `clipTaskId` / `imageStatus` 判断运行状态。
- “继续生成”不会显示创建新项目。
- 后端 taskGraph 与 UI 当前阶段使用同一权威投影。
- `/sync` 路由已删除，GET 项目投影轮询无副作用。

