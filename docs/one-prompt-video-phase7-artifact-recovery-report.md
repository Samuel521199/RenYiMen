# One Prompt Video 阶段 7：Artifact 依赖恢复执行报告

执行日期：2026-07-21

## 结论

阶段 7 已完成代码落地。项目继续使用 `planJson.artifactMetadata` 作为 Artifact 状态真源，在现有字段上补齐产物身份、生产阶段、失效来源、revision 血缘和用户固定状态，并将 dirty 传播与 resume 恢复统一到同一张依赖图。

## Metadata 扩展

每个归一化 Artifact 现在包含：

```ts
artifactId: string;
artifactType: string;
producedByStage: string;
invalidatedByArtifactIds?: string[];
parentRevisionIds?: string[];
userAccepted?: boolean;
```

历史项目仍兼容旧字段。打开项目时会补齐缺失 Metadata 和新增依赖边，不要求重新规划，也不会覆盖现有媒体 URL 或三视图。

## 依赖图

已建立并验证以下主要链路：

```text
narrative events / creative strategy / story beats
  -> storyboard brief
  -> segment render description
  -> transition plan

person front image
  -> derived side/back contracts and images
  -> reference selection
  -> keyframe/checkpoint prompt and image
  -> segment prompt and video
  -> final compose

camera graph -> camera node
  -> transition reference
  -> target keyframe reference selection
  -> target keyframe

audio bible
  -> BGM / TTS / SFX
  -> final audio mix
  -> final compose
```

Segment 依赖按 `segmentNo` 隔离。修改某个 segment prompt 只会使该 segment video 和最终合成 dirty，不会污染其他 segment。

## Dirty 传播

- 修改上游只更新 Metadata，不删除现有图片、视频或最终成片 URL。
- `invalidatedByArtifactIds` 记录导致失效的根节点，可解释人物 front 修改影响了哪些 side/back、关键帧、checkpoint 和视频。
- dirty 不再虚增媒体 revision；revision 只在新的 active 媒体真正切换时递增。
- `retryFromStage` 根据 dirty 子图中最早需要重跑的节点推导，而不是由前端猜测。
- 已由用户审核或明确选择的媒体设置 `userAccepted=true`；即使上游后来变化，自动 resume 也不会覆盖它。

## Revision 切换

关键帧、checkpoint、segment video、Transition Reference 和 Generated Bridge 的重新生成统一为：

```text
保留当前 active URL
  -> 创建新候选并执行质量评估
  -> 标记最佳候选 recommended / ready_for_review
  -> 用户明确选择或批准
  -> 将旧 active 写入 revision history
  -> 记录 parentRevisionIds
  -> 切换新 active revision
  -> 只传播其下游 dirty
```

因此生成成功不会自动覆盖用户正在使用的已批准媒体，旧 revision 仍可通过既有回退入口恢复。

## Resume 恢复

- 检测到运行中 task、candidate 或 compose job 时只调用同步，不重复提交。
- 检测到待审核的新 revision 时停止下游恢复，等待用户明确切换 active。
- 按依赖顺序每次恢复一个可执行的 dirty/failed 媒体节点。
- 跳过 `userAccepted=true` 或数据库状态为已批准的媒体。
- 恢复关键帧、checkpoint 和 segment 时会重新执行其 Reference Selector 与 Prompt Compiler，再提交生成。
- 所有媒体完成后，仅当 `final_video` dirty/failed 时重新执行合成。

## 界面

调试面板会显示 Artifact 类型、生产阶段、`retryFromStage`、失效来源、parent revision 和用户固定状态，便于解释恢复范围。

## 验证

- 阶段 7 与 Transition 定向回归：10 项通过，0 项失败。
- 当前完整 `npm run test:one-prompt-video`：93 项中 89 项通过；4 项失败来自并行新增的 `story-quality-fixtures` 复杂动作连续性样本，与 Artifact 依赖恢复无关，本阶段未擅自修改这些剧情样本。
- 新增测试覆盖 front 到 side/back 及下游传播、segment 隔离、Camera/Transition、Audio、active revision 保留和 resume 去重。
- `npm run build`：通过；仅有项目既有 React Hook lint warnings。
- `git diff --check`：无新增空白错误，仅有工作区既有的 LF/CRLF 提示。

本次没有调用付费上游生成。上线前建议用一个已完成项目分别执行“修改人物 front 后 resume”和“修改单个 segment prompt 后 resume”，观察实际队列、模型额度和人工审核切换流程。
