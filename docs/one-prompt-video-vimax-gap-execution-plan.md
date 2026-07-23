# 一句话成片：ViMax 改进补漏执行计划

## 1. 文档目的

本文用于补齐 `one-prompt-video-script-decomposition-vimax-inspired-plan.md` 中已经提出、但当前项目尚未完整落地的改进项。

本文不是重新设计现有流程，也不是推翻当前三阶段规划器。执行原则是：

- 保留当前 `Planning Architect -> Storyboard Artist -> Shot Decomposer -> Prompt Detailer` 主链路。
- 保留当前已经上线的人物正面、侧面、背面三视图能力。
- 只补齐行为闭环、硬校验、真实质量评估、音频生产和依赖恢复。
- 所有变更兼容历史 `planJson`，不删除用户已经生成或批准的资产。
- 每一阶段必须通过本阶段验收后再进入下一阶段，避免一次性大改后无法定位回归。

## 2. 当前基线与本轮范围

### 2.1 已有能力，不重复建设

以下能力视为当前基线，本轮只能增强，不能删除或退回旧实现：

- Planning Architect、Storyboard Artist、Shot Decomposer、Prompt Detailer。
- `narrativeEvents`、`anchorStateTimeline`、`storyboardBrief`、`segmentRenderDescriptions`。
- `cameraGraph`、`transitionReferencePlan`、`finalTransitionPlan`。
- `referenceSelectionOutputs`、`promptDebugArtifacts`、`artifactMetadata`。
- `generationQualityReports` 基础结构。
- 一致性资产先生成、锁定后再生成普通关键帧。
- 图片、子分镜图、视频片段、最终成片的重新生成和媒体版本回退。
- 用户修改后的中文或英文字段优先于旧模型输出。
- 字幕后期烧录和基础 FFmpeg 合成。

### 2.2 本轮需要补齐的缺口

| 编号 | 缺口 | 当前状态 | 本轮目标 |
|---|---|---|---|
| G1 | 人物三视图生成闭环 | 已有 front/side/back，但生成关系和朝向选图不完整 | 保留现有三视图，改成 front 批准后派生 side/back，关键帧按朝向确定性选图 |
| G2 | Reference Selector | 已有配额和打分，但公式、硬参考和视觉冲突判断不完整 | 修正公式，hard anchor 必选，高冲突淘汰，记录缺失和原因 |
| G3 | Camera Graph | 当前节点信息偏简化 | 补齐父机位、轴线、景别、空间布局、继承规则和缺失信息 |
| G4 | Single-take 硬阻断 | 规划阶段能修复，但部分生成路径会警告后继续 | 统一审计入口，所有生成路径 fail-closed |
| G5 | HappyHorse 尾帧语义 | 当前生成后通过片段内叠化强制接尾帧 | 恢复为首帧硬输入、尾帧软目标；片段内部不制造 dissolve |
| G6 | 生成质量评估 | 主要按 URL、prompt 长度等启发式评分 | 对真实图片和视频帧做多模态评估，支持多候选择优和自动重试 |
| G7 | 音频生产链 | 已有 BGM/loudnorm，缺 TTS、SFX、ducking 和统一资产管理 | 建立 BGM、TTS、SFX、混音和审核闭环 |
| G8 | Transition Reference | 有计划结构和候选读取，缺实际生成链 | 实现过渡参考视频、抽帧、审核和新机位引用 |
| G9 | Artifact 依赖恢复 | 有 revision/hash/dependsOn/dirty，传播和来源不完整 | 建立统一依赖图、失效传播、重试阶段推导和批准版本保护 |
| G10 | 硬校验 | 部分结构错误只进入 warnings | 将生产安全相关规则变成硬阻断，区分 warning/error |
| G11 | 调试与审核 UI | 已能显示部分调试信息 | 显示阻断原因、依赖影响、参考图选用、质量报告和候选版本 |
| G12 | 独立数据表 | 多数产物仍在 `planJson` | 稳定后再拆高频产物，不作为前几阶段前置条件 |

## 3. 不得破坏的人物三视图基线

这是本轮最高优先级的兼容约束。

### 3.1 必须保留

- `person` 资产继续包含 `front`、`side`、`back` 三个 view。
- 现有资产 ID、负数关键帧编号、审核状态、媒体 revision 和回退按钮继续有效。
- 已批准的 front/side/back 图片不得在升级或重规划时被自动清空。
- 用户对任意一个视图修改的提示词必须继续作为该视图重新生成的权威输入。
- 不得将三视图退化为单张人物图，也不得用 `three_quarter` 替换已有 `front/side/back`。

### 3.2 本轮只增加的能力

新项目或尚未生成三视图的项目按以下顺序执行：

```text
front prompt
  -> 生成 front 候选
  -> 用户批准并锁定 front
  -> side 以批准 front 作为 identity 硬参考生成
  -> back 以批准 front 作为 identity 硬参考生成
  -> 用户分别批准 side/back
  -> 普通关键帧按人物朝向选择 front/side/back
```

具体规则：

- side/back 不得与 front 并发首轮生成。
- side/back 的参考图用途必须写明“只继承人物身份、服装、配色、比例和配饰，不继承正面姿态和视角”。
- 修改并批准新的 front 时，将 side/back 以及引用人物资产的下游产物标记 dirty，但不得直接覆盖旧 side/back URL。
- 用户可以选择保留旧 side/back，也可以基于新 front 创建新 revision。
- 历史项目如果三个视图都已批准，不强制重生成。

### 3.3 朝向到视图的确定性映射

```text
front / frontal / facing camera / three-quarter front -> front
left profile / right profile / side-facing            -> side
back-facing / rear view                                -> back
无法判断                                                 -> front，并记录 fallback 原因
```

关键帧的 `referenceSelectionOutputs` 必须记录：

- 检测到的人物朝向。
- 目标 view。
- 实际选中的 view。
- 无法选择目标 view 时的 fallback 原因。

## 4. 总体执行顺序

严格按以下顺序执行：

```text
阶段 0：冻结基线和建立回归样本
  -> 阶段 1：三视图与 Reference Selector
  -> 阶段 2：Camera Graph 与硬校验
  -> 阶段 3：Single-take 与尾帧语义
  -> 阶段 4：真实生成质量评估
  -> 阶段 5：Transition Reference
  -> 阶段 6：统一音频后期
  -> 阶段 7：Artifact 依赖恢复
  -> 阶段 8：审核与调试 UI
  -> 阶段 9：端到端验收和灰度
  -> 阶段 10：可选的数据表拆分
```

每个阶段都需要完成：类型契约、后端逻辑、UI 兼容、日志、测试、验收样例六项工作。

## 5. 阶段 0：冻结基线和建立回归样本

> 执行状态：已于 2026-07-21 完成。基线版本、三套合成回归项目、隐私约束和自动化回归测试已落地；执行记录见 `docs/one-prompt-video-phase0-baseline-report.md`。

### 5.1 目标

在修改行为前固定现有三视图、重新生成、回退、提示词权威性和审核顺序，避免补漏时破坏已完成能力。

### 5.2 执行步骤

1. 保存至少三个匿名化回归项目：
   - 单人物游戏广告。
   - 人物加产品广告。
   - 多场景、至少两个 camera setup 的短片。
2. 每个项目保留：
   - 原始输入。
   - 完整 `planJson`。
   - front/side/back 三视图。
   - 边界关键帧。
   - 子分镜参考图。
   - 视频片段和最终成片。
   - reference selector、prompt debug、quality report 日志。
3. 给以下现有行为增加回归测试：
   - person 必须产生 front/side/back。
   - 用户中文编辑后重新生成时不得提交旧英文内容。
   - 每个文本编辑入口仍可撤销。
   - 每种媒体仍可连续回退。
   - 未批准一致性资产时不能生成普通关键帧。
4. 记录当前 `planJson` schema/planner/prompt/compiler 版本，后续所有新字段采用可选字段和默认值。

### 5.3 主要涉及文件

- `src/services/video-orchestrator/types.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`

### 5.4 完成标准

- 历史项目可以正常打开、审核、重新生成和回退。
- 三视图回归用例在后续所有阶段持续通过。
- 回归样本中不包含真实密钥、用户隐私或临时签名 URL。

## 6. 阶段 1：补齐三视图与 Reference Selector

> 执行状态：代码实现与自动化回归已于 2026-07-21 完成，执行记录见 `docs/one-prompt-video-phase1-reference-selector-report.md`。真实新人物三视图的人工视觉验收需要在具有可用图片模型额度的测试项目中完成，不在自动测试中伪造结论。

### 6.1 修正评分公式

将 selector 的最终分数统一为：

```text
finalScore =
  relevanceScore * 0.45
  + viewMatchScore * 0.25
  + recencyScore * 0.20
  - conflictScore * 0.35
```

同时统一分数语义：

- `recencyScore` 越大表示越近，不再使用“距离越大分越大”的值。
- `viewMatchScore` 越大表示视角越匹配。
- `conflictScore` 越大表示越不允许使用。

### 6.2 增加硬选和硬淘汰

执行顺序必须是：

1. 收集候选。
2. 根据可见 anchor、人物朝向、camera relation 和 location 计算分数。
3. 先锁定当前帧可见的 hard person/product anchor。
4. 淘汰超过冲突阈值的候选。
5. 再按 character、product、space_layout、style_brand 配额补足。
6. 总数最多九张。

硬规则：

- hard anchor 可见但没有批准参考图时，生成必须阻断。
- hard anchor 候选不能因普通配额竞争被风格图挤掉。
- style 图不能作为人物 identity 或产品 identity。
- 带错误文字、错误 logo、错误人物或冲突场景的候选必须记录明确淘汰原因。

### 6.3 建立三视图派生关系

为人物资产增加兼容字段：

```ts
sourceView?: "front";
sourceArtifactId?: string;
orientation?: "front" | "side" | "back" | "unknown";
viewGenerationMode?: "primary" | "derived_from_front";
```

执行要求：

- front 是 `primary`。
- side/back 是 `derived_from_front`。
- front 未批准时，side/back 生成按钮显示等待原因，不提交上游任务。
- side/back 生成时，批准的 front URL 必须作为 identity 参考传入图片模型。
- 修改 front 后通过 Artifact 依赖图使 side/back 变 dirty，但保留旧 revision。

### 6.4 加入轻量多模态冲突检测

先保留确定性算法作为主选择器，再对进入最终候选池的图片做一次视觉理解：

- 人物是否一致。
- 产品/logo 是否冲突。
- 是否含错误文字。
- 场景布局是否冲突。
- 候选人物朝向是否匹配。

视觉模型只负责输出 `conflictScore`、`viewMatchScore` 和原因，不负责直接选择，最终选择仍由后端算法完成。

### 6.5 测试用例

- 同一人物 front/side/back 都存在时，正面关键帧选择 front。
- 背对镜头时选择 back。
- side 缺失时，侧面关键帧回退 front 并记录原因。
- hard person 与 hard product 同时可见时二者都入选。
- 风格图分数再高也不能替代 hard identity 图。
- 高冲突候选必须淘汰。
- side/back 不会在 front 批准前提交。
- 历史已批准三视图不会被清空或重生成。

### 6.6 完成标准

- 新人物的三个视图身份一致性通过人工检查。
- 所有关键帧都能解释为什么选择某一人物 view。
- selector 输出的公式、配额、必选项和淘汰原因与 ViMax 改进方案一致。

## 7. 阶段 2：补齐 Camera Graph 与硬校验

> 执行状态：已于 2026-07-21 完成。Camera Graph 字段、继承语义、Reference Selector/图片 Prompt/Single-take Audit 接入、统一结构化 Validator 和所有生成入口硬阻断均已落地；执行记录见 `docs/one-prompt-video-phase2-camera-validator-report.md`。

### 7.1 扩展 Camera Graph

在兼容现有 `cameras/relations` 的前提下，为节点补充：

```ts
parentCameraId?: string;
parentSegmentNo?: number;
axisDescription?: string;
framingRange?: string;
movementStyle?: string;
spatialLayoutLock?: string;
relationToParent?: CameraRelation;
missingInfo?: string[];
inheritanceReasonZh?: string;
```

不要删除现有 `cameraId`、`segmentNos`、`locationId` 和 relation edge。

### 7.2 让 Camera Graph 真正参与生成

- `same_camera_setup`：继承构图、轴线、布局、光线。
- `same_axis`：继承轴线和空间方向，允许景别变化。
- `derived_reframe`：继承主体关系和布局，重新计算构图边界。
- `same_spatial_context`：只继承地点、固定物体和光线。
- `same_subject_group`：只继承主体组合。
- `alternate_view`：检查180度轴线和左右关系。
- `new_camera_setup`：必须产生 transition reference 请求或明确无需继承。

Reference Selector、图片 Prompt Compiler 和 Single-take Audit 都必须读取这些规则。

### 7.3 建立统一 Validator

建立一个结构化校验结果：

```ts
interface PlanValidationIssue {
  code: string;
  severity: "warning" | "error";
  artifactId?: string;
  messageZh: string;
  retryFromStage?: string;
}
```

下列情况必须是 `error`：

- segment 时长不在3至15秒。
- segment 总时长与项目时长不一致。
- keyframe 数量不等于 segment 数量加一。
- 关键帧编号或 segment 首尾引用不连续。
- `segmentRenderDescription` 缺首帧、尾帧、运动或 single-take contract。
- 引用了不存在的 event、anchor、camera 或 keyframe。
- hard anchor 可见但没有批准图片。
- hard anchor 图片没有进入最终 reference selection。
- start/end frame contract 含运动过程。
- motion checkpoint 含 cut、dissolve、montage、switch angle 等词。
- `requiresCut=true`、`riskLevel=high` 或 `physicallyReachable=false`。
- 新机位缺少空间来源且 `missingInfo` 未解决。

仅描述丰富度不足、可选字段缺失、建议优化等情况可以保留为 warning。

### 7.4 完成标准

- 校验错误会显示明确 artifact、原因和建议回退阶段。
- 任何 error 都不能进入对应生成阶段。
- 历史计划缺新字段时可以归一化，但不能绕过生产安全校验。

## 8. 阶段 3：统一 Single-take Audit 与尾帧语义

> 执行状态：代码实现与自动化回归已于 2026-07-21 完成。统一审计真源、HappyHorse 首帧能力声明、尾帧软目标、片段内贴帧移除、真实末帧视觉检查和有限重试/Stage 2B 回退均已落地；执行记录见 `docs/one-prompt-video-phase3-single-take-end-frame-report.md`。真实上游视频的人工抽查需在下一次可用测试项目中完成。

### 8.1 只保留一个审计真源

规划结束、批量视频生成、单段重新生成、失败恢复都调用同一个 Single-take Audit 服务。

删除以下行为差异：

- 规划阶段失败会阻断，但运行阶段只警告。
- 批量生成会阻断，但单段重新生成仍能绕过。
- 通过 prompt 文本替换隐藏结构性切镜问题。

审计结果规则：

```text
passed=true                         -> 允许生成
requiresCut=true                    -> 阻断并回到 Stage 2B
riskLevel=high                      -> Split Repair，仍失败则阻断
physicallyReachable=false           -> Split Repair，仍失败则阻断
结构问题                            -> 不允许只靠重复生成解决
```

### 8.2 修复 HappyHorse 尾帧语义

当前模型关系应统一为：

```text
first frame：唯一硬图片输入
end frame：审核参考、软目标、连续性检查依据
motion contract：视频主指令
motion checkpoints：同一路径的中间状态
```

执行修改：

1. 继续要求用户审核尾帧，因为它是结束状态合同。
2. 视频 Prompt 中明确结束状态，但不把尾帧描述成模型硬输入。
3. 停止在单个生成片段内部用 `xfade/dissolve` 强行贴入尾帧。
4. 片段间的 dissolve 只能由 `finalTransitionPlan` 在最终合成阶段执行。
5. 如果以后切换到支持真实首尾帧输入的模型，通过 provider capability 控制，不修改当前合同结构。

### 8.3 端帧连续性检查

移除强制叠化后，需要用质量评估判断生成视频最后采样帧与 `endFrameContract` 的差距：

- 差距小：通过。
- 差距可通过 prompt 修复：产生 retry instruction，重新生成视频。
- 差距来自不可达动作：回退 Stage 2B，不继续盲目重试。

### 8.4 完成标准

- 所有视频生成入口无法绕过 Single-take Audit。
- 单个视频片段内部没有由后处理插入的 dissolve。
- 视频末帧通过视觉检查向尾帧合同靠近，而不是机械贴图。

## 9. 阶段 4：建立真实 Generation Quality 闭环

### 9.1 保留启发式预检，但不把它当最终质量判断

当前 URL、prompt 长度、切镜词检查继续作为快速预检。预检只能发现明显结构错误，不能生成最终 identity/layout/continuity 分数。

### 9.2 图片质量评估

将实际生成图片、目标合同、选中参考图和用途说明一起提交给视觉理解模型，输出：

- identityScore。
- layoutScore。
- promptAlignmentScore。
- continuityScore。
- productInstanceCount。
- wrongTextDetected。
- artifactIssues。
- passed。
- retryInstruction。

分别适配：anchor 图片、边界关键帧、motion checkpoint 图片。

### 9.3 视频质量评估

用 FFmpeg 提取：

- 第一帧。
- 25%、50%、75%采样帧。
- 最后一帧。

结合视频元数据和多帧视觉理解评估：

- 首帧一致性。
- 人物/产品身份连续性。
- 产品或人物实例数量是否异常。
- 空间布局是否漂移。
- 是否发生跳切、瞬移、融化或场景替换。
- motion checkpoint 是否按顺序可达。
- 最后状态是否接近 end frame contract。
- singleTakeScore。

### 9.4 多候选与择优

为图片和视频增加可配置候选数，默认先从2个候选灰度：

```text
生成候选
  -> 每个候选生成质量报告
  -> passed 候选按综合分排序
  -> 自动选择最高分
  -> 用户可查看并改选
```

如果没有候选通过：

- 可修复生成问题：把 `retryInstruction` 编译进下一次 prompt。
- 结构问题：回退 Stage 2B 或 Stage 3。
- 达到重试上限：停止并要求用户处理。

### 9.5 完成标准

- 质量分来自实际媒体内容，而不是 prompt 长度。
- 失败报告能指出可观察问题，并能驱动下一次重试。
- 多候选不会默认使用第一个完成的结果。
- 用户手动接受未通过候选时记录 `userAccepted=true`，保留原始 `passed=false`。

## 10. 阶段 5：实现 Transition Reference 生产链

### 10.1 触发条件

以下情况评估是否需要 transition reference：

- `new_camera_setup`。
- `alternate_view` 且空间左右关系容易丢失。
- `derived_reframe` 但父关键帧不能直接提供目标构图。
- 新机位需要继承旧场景布局、光线或人物位置。

### 10.2 短期模式

- 直接将父机位已批准关键帧作为 `space_layout` 候选。
- usage note 明确只继承空间、构图和光线。
- 人物和产品仍由 hard anchor 图负责，禁止从父关键帧继承错误身份或文字。

### 10.3 完整模式

```text
父机位关键帧
  -> 生成 transition reference video
  -> 按目标机位匹配度抽取多个候选帧
  -> 质量评估并选择最佳过渡参考帧
  -> 用户审核和锁定
  -> 新机位关键帧强制引用该帧作为 scene_layout/composition 参考
```

Transition reference 视频默认不进入最终成片。

### 10.4 Generated Bridge

如果 `finalTransitionPlan.visualMode=generated_bridge`：

- 创建独立 bridge artifact。
- 单独生成、评估和审核。
- 未批准 bridge 时禁止最终合成。
- bridge 与 transition reference 不得复用同一状态概念，前者进入成片，后者只服务生成一致性。

### 10.5 完成标准

- 新机位能够说明继承了哪个父机位的哪些信息。
- transition reference 有生成状态、质量报告、审核状态和 revision。
- 错误人物、产品和文字不会由过渡参考扩散。

## 11. 阶段 6：建立统一音频后期链路

### 11.1 默认策略

- 视频模型默认关闭随机语音、歌词和随机音乐。
- `audioBible.postProductionStrategy=strip_clip_audio_and_add_global_mix` 时必须剥离片段原音轨。
- 视频 prompt 只描述动作相关声音意图，不依赖视频模型完成最终声音。

### 11.2 音频资产结构

第一版仍可放在 `planJson`：

```ts
interface VideoAudioAsset {
  artifactId: string;
  type: "bgm" | "voiceover" | "dialogue" | "sfx";
  sourceText?: string;
  voiceId?: string;
  startSeconds: number;
  durationSeconds?: number;
  volume: number;
  url?: string;
  status: "draft" | "generating" | "ready" | "approved" | "failed";
  revision: number;
}
```

### 11.3 执行顺序

1. 从 `audioBible` 生成或选择全片 BGM。
2. 从全局脚本和 segment audio plan 生成 TTS/对白，不允许临时改写台词。
3. 根据 narrative event 和 motion checkpoint 生成或选择局部 SFX。
4. 用户分别试听、重生成、批准和回退音频资产。
5. 最终 FFmpeg 混音：BGM + TTS/对白 + SFX。
6. 对人声区域应用 ducking。
7. 最终执行 loudnorm。
8. J-cut/L-cut/crossfade 仅由 `finalTransitionPlan.audioMode` 控制。

### 11.4 完成标准

- 不同视频片段不再携带随机变化的音乐和人声。
- 同一旁白全片保持相同 voiceId、语速、音色和语言。
- 字幕文本与旁白文本有统一来源，不发生内容漂移。
- BGM、TTS、SFX 均可单独重生成和回退。

## 12. 阶段 7：补齐 Artifact 依赖恢复

### 12.1 扩展 Metadata

在兼容当前字段的基础上补充：

```ts
artifactId: string;
artifactType: string;
producedByStage: string;
invalidatedByArtifactIds?: string[];
parentRevisionIds?: string[];
userAccepted?: boolean;
```

### 12.2 建立依赖图

至少建立以下依赖：

```text
narrative event
  -> storyboard brief
  -> segment render description
  -> transition plans

person front
  -> person side/back
  -> reference selection
  -> keyframe prompt/image
  -> checkpoint prompt/image
  -> segment prompt/video
  -> final compose

camera node
  -> transition reference
  -> reference selection
  -> keyframe

keyframe prompt
  -> keyframe image
  -> dependent segment video

audio bible
  -> BGM/TTS/SFX
  -> final audio mix
  -> final compose
```

### 12.3 Dirty 传播规则

- 修改上游 artifact 只标记下游 dirty，不立刻删除 URL。
- 用户批准的媒体永远不会被自动覆盖。
- 重生成先创建新 revision，用户批准后再切换 active revision。
- `retryFromStage` 由依赖图推导，前端不能自行猜测。
- 恢复时只重新执行 dirty/failed 且未被用户固定保留的节点。

### 12.4 完成标准

- 修改人物 front 后，系统能准确列出 side/back、哪些关键帧和哪些视频受影响。
- 修改某个 segment prompt 不会污染无关 segment。
- 旧 revision 始终可回退。
- resume 不会重复提交已在运行或已完成的任务。

## 13. 阶段 8：补齐审核和调试 UI

### 13.1 三视图 UI

- front、side、back 保持现有三个独立卡片。
- side/back 显示“派生自哪个 front revision”。
- front 未批准时说明为什么不能生成 side/back。
- front 更新后显示受影响资产，不自动替换旧图。

### 13.2 Reference Selector UI

每个图片资产展示：

- 全部候选缩略图。
- 用途、四项分数、最终分数。
- 是否选中。
- 淘汰原因。
- 人物朝向和选用 view。
- 最终 reference usage notes 和编译 prompt。

### 13.3 质量报告 UI

- 展示各维度分数和问题列表。
- 支持查看多个候选并人工改选。
- 区分“系统通过”“系统未通过但用户接受”。
- 一键带着 retry instruction 重新生成。

### 13.4 依赖影响 UI

用户保存上游修改前显示：

```text
本次修改将使以下产物失效：
- 人物侧面/背面参考图
- 关键帧 KF2、KF3
- 视频 Segment 2
- 最终成片
```

用户确认后只标 dirty，不删除旧版本。

### 13.5 完成标准

- 用户无需看服务端日志就能知道为什么阻断、为什么选图、为什么重试。
- 每个修改入口仍有文本撤销，每个媒体入口仍有版本回退。
- 新 UI 不覆盖当前三视图和资产库审核入口。

## 14. 阶段 9：端到端验收与灰度

### 14.1 必测场景

1. 单人物游戏广告：角色从正面转为侧面再背对镜头。
2. 人物加产品：人物拿起桌上唯一产品，不能复制或凭空出现。
3. 两个机位的同场景广告：验证 Camera Graph、轴线和 transition reference。
4. 大状态变化动作：验证 Single-take 阻断和 Split Repair。
5. 有旁白、BGM、SFX、字幕的30秒广告。
6. 用户修改人物 front 后仅重跑受影响资产。
7. 生成失败、浏览器刷新、服务重启后的 resume。
8. 历史项目打开、重新生成、批准、回退。

### 14.2 量化验收指标

- hard anchor 漏选率：0。
- 未批准 hard anchor 时误生成普通关键帧：0。
- `requiresCut=true` 或 `riskLevel=high` 时误提交视频：0。
- 三视图被升级脚本清空或覆盖：0。
- 已批准 revision 被后台自动覆盖：0。
- 同一任务因重复轮询被重复提交：0。
- 所有生成图片和视频都有 reference selection、prompt debug、quality report、artifact metadata。
- 音频后期模式下，最终成片不存在随机片段原声。

### 14.3 灰度策略

新增功能使用独立开关：

- `ONE_PROMPT_REFERENCE_SELECTOR_V2`
- `ONE_PROMPT_THREE_VIEW_DERIVATION`
- `ONE_PROMPT_STRICT_VALIDATION`
- `ONE_PROMPT_VISUAL_QUALITY_EVAL`
- `ONE_PROMPT_TRANSITION_REFERENCE`
- `ONE_PROMPT_UNIFIED_AUDIO_MIX`
- `ONE_PROMPT_ARTIFACT_GRAPH_V2`

推荐顺序：内部项目 -> 少量新项目 -> 全量新项目 -> 历史项目按需启用。

任何开关关闭时都必须回到当前实现，不得破坏 planJson 读取和已批准资产。

## 15. 阶段 10：可选的数据表拆分

只有在前九个阶段稳定后再执行。优先拆分高频查询、并发更新或需要独立 revision 的产物：

- `VideoConsistencyAnchorImage`
- `VideoAnchorReferenceView`
- `VideoReferenceSelectionOutput`
- `VideoPromptCompilation`
- `VideoGenerationQualityReport`
- `VideoAudioAsset`
- `VideoTransitionReference`
- `VideoArtifactMetadata`

拆表要求：

- `planJson` 在迁移期间继续保留兼容镜像。
- 先双写、再核对、再切读，最后才停止旧写入。
- 不删除历史 planJson 中的对应字段。

## 16. 每一阶段的统一交付清单

每完成一个阶段，都必须提交以下结果：

- [ ] 类型和 schemaVersion 已更新。
- [ ] 历史 `planJson` 兼容逻辑已验证。
- [ ] 后端主流程和所有重新生成入口行为一致。
- [ ] UI 可解释阻断和选择结果。
- [ ] 新日志不包含密钥和完整临时签名 URL。
- [ ] 单元测试覆盖确定性规则。
- [ ] 集成测试覆盖状态流转和恢复。
- [ ] 至少一个真实项目完成端到端验证。
- [ ] 当前人物 front/side/back 三视图仍存在且可独立审核、重新生成和回退。
- [ ] `npm run build` 通过。

## 17. 最终完成定义

只有同时满足以下条件，才能宣布 ViMax 参考改进全部落地：

1. Narrative Event、Anchor State、Camera Graph、Segment Contract 能真实约束生成，而不只是保存在 JSON 中。
2. 人物三视图以现有 front/side/back 为基线，side/back 从批准 front 派生，关键帧按朝向选用。
3. Reference Selector 的必选、配额、公式、冲突淘汰和缺失阻断全部可验证。
4. 所有视频生成入口都无法绕过 Single-take Audit。
5. HappyHorse 片段内部不通过后期 dissolve 伪造尾帧到达。
6. 每个真实生成媒体都经过多模态质量评估，失败原因能驱动局部重试。
7. Transition Reference、最终转场和统一音频后期分别形成可审核生产链。
8. Artifact 依赖图能精确传播 dirty、推导重试阶段并保护用户批准版本。
9. 用户可以在 UI 中查看参考图选择、最终 prompt、质量报告、依赖影响和历史 revision。
10. 历史项目及现有三视图能力没有回归。

完成上述十项后，项目才从“具备 ViMax 式中间产物”升级为“具备可校验、可恢复、可调试的 ViMax 式生产闭环”。
