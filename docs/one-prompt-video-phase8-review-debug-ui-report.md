# One Prompt Video 阶段 8：审核与调试 UI 执行报告

## 完成内容

### 三视图审核

- 保留 front、side、back 三张独立卡片和原有资产库审核入口。
- side/back 显示实际绑定的 front artifact revision。
- front 尚未生成、批准并锁定时，side/back 明确显示等待原因且不提交生成。
- front 更新后显示被标记 dirty 的下游资产；旧 side/back 和其他媒体不会被自动替换。

### Reference Selector 调试

- 展示全部候选缩略图，不再只输出原始 JSON。
- 展示候选用途、来源、hard anchor、relevance/view/recency/conflict/final 分数。
- 展示人物朝向、采用 view、选中/淘汰状态、淘汰原因和冲突原因。
- 保留最终 usage notes、选中参考图和编译后的最终 prompt。

### Generation Quality 审核

- 图片和视频候选展示 identity、layout、prompt alignment、continuity、single-take 分数及可观察问题。
- 用户可以在多个候选之间人工改选。
- 明确区分“系统通过”“系统未通过”和“系统未通过但用户接受”。
- 未通过候选保留 `passed=false`，人工接受只记录 `userAccepted=true`。
- 有 `retryInstruction` 时可以一键按修复建议重新生成；生成服务会把上一份质量报告的指令编译进下一次 prompt。

### 依赖影响与版本保护

- 保存关键帧、镜头、叙事骨架和调试数据前，根据 Artifact 依赖图列出受影响产物。
- 用户确认后仅传播 dirty 状态，不删除旧 URL 或旧 revision。
- 人物派生视图记录 front revision；视频记录首尾关键帧 revision，便于界面解释来源。
- 原有文本撤销与图片、视频、transition reference、bridge、最终成片的媒体回退入口继续保留。

## 主要文件

- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/review-debug-ui.test.ts`
- `package.json`

## 验证结果

- One Prompt Video 全量回归：102/102 通过。
- 阶段 5、7、8 相关定向测试：15/15 通过。
- 阶段 8 UI 专项测试：5/5 通过。
- 本次页面与测试文件 ESLint：通过，无警告、无错误。
- 完整 `npm run build`：通过（仓库其他页面仍有既有 React Hook lint warnings，不阻断构建）。

## 完成标准核对

- 用户可直接从界面理解阻断原因、选图原因、淘汰原因和重试依据。
- 每个既有文本编辑入口仍可撤销，每个既有媒体入口仍可版本回退。
- 新增界面没有覆盖三视图卡片、资产库审核入口或现有 active revision。
