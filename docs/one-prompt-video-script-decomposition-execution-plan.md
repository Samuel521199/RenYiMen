# 一句话成片剧本拆解改造执行计划

本文是 `one-prompt-video-script-decomposition-vimax-inspired-plan.md` 的落地执行版。  
目标不是再讨论方案，而是把方案拆成可以逐步开发、验证、上线和回滚的任务清单。

## 0. 执行原则

1. 不一次性重写全链路。先把新结构写入 `planJson` 并兼容旧字段，稳定后再考虑 Prisma 新表。
2. 每一批改动都必须能单独上线、单独回滚。
3. 新 planner 输出必须经过后端归一化和校验，不能直接相信大模型 JSON。
4. 所有新字段先只增强生成质量，不应破坏旧项目继续打开、审核、生成。
5. HappyHorse 仍然只接收首帧硬输入；尾帧是文字软目标，不要在文档、提示词或代码里假设它支持尾帧输入。
6. 一句话成片的单段视频生成强制使用 `happyhorse-1.1-i2v`；即使环境变量误填其他 i2v 模型，提交时也不能切走 HappyHorse。
7. 字幕继续由后期烧录，不允许图片或视频模型直接生成画面文字字幕。
8. 单段视频生成 prompt 内禁止出现 `hard_cut`、`dissolve`、`match_cut` 等段内转场许可词；转场只进入最终合成计划。

## 1. 当前主要代码入口

优先围绕这些文件执行：

- `src/services/video-orchestrator/types.ts`：统一类型定义。
- `src/services/video-orchestrator/three-stage-planner.ts`：三阶段 LLM 拆解提示词、解析、归一化。
- `src/services/video-orchestrator/project-service.ts`：项目状态机、planJson 读写、图片/视频任务调度、prompt 编译。
- `src/services/video-orchestrator/quality-judge.ts`：质量判断能力入口，可扩展为生成后质量报告。
- `src/services/video-orchestrator/local-compose.ts`：最终合成、字幕和音频策略落点。
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`：审核 UI、调试 UI、用户编辑入口。
- `docs/one-prompt-video-script-decomposition-vimax-inspired-plan.md`：方案依据。
- `docs/one-prompt-video-script-decomposition-baseline.md`：阶段 A 固定测试样本、验收指标和日志检查点。

## 2. 推荐分支和开关

建议新建独立分支：

```bash
git checkout -b codex/one-prompt-video-vimax-execution
```

建议增加一个运行时开关，避免新 planner 直接影响所有用户：

```env
ONE_PROMPT_VIDEO_PLANNER_ARCH=v2
```

推荐策略：

- `v1`：当前线上逻辑。
- `v2_shadow`：调用新结构但不驱动生成，只记录日志和 planJson debug。
- `v2`：新结构驱动生成。

第一批上线建议使用 `v2_shadow` 或只对测试账号开启。

当前已接入：

- `project-service.ts` 会读取 `ONE_PROMPT_VIDEO_PLANNER_ARCH`。
- `v1` 使用本地旧 planner 驱动生成。
- `v2_shadow` 会尽力调用三阶段 planner，并把输出写入 `planJson.plannerShadow`；真正驱动生成的仍是本地旧 planner，避免 shadow 数据影响关键帧、片段视频或最终合成。
- `v2` 使用三阶段 planner 驱动生成，是默认模式。

## 3. 阶段 A：建立基线和测试样本

### A1. 固定测试样本

准备至少 6 个一句话输入：

1. 国风护肤品广告：人物、产品、庭院一致性。
2. 游戏广告：IP 角色、Logo、游戏桌面/界面、卡牌一致性。
3. 餐饮广告：菜品、门店、厨师、出餐状态变化。
4. 汽车广告：车辆外观、道路、驾驶状态变化。
5. 无人物产品展示：只有产品和场景。
6. 无产品剧情短片：只有人物和场景。

每个样本记录：

- 输入 prompt。
- 参考图数量和用途。
- 期望 anchor。
- 期望 narrative events 数量。
- 期望 segment 数量范围。
- 预期最容易失败的点。

### A2. 固定验收指标

每次改动后至少检查：

- 能否完成三阶段拆解。
- `planJson` 是否包含新字段且旧 UI 不崩。
- 一致性 anchor 图是否先于普通关键帧生成。
- 视频 prompt 是否没有段内转场词。
- 字幕是否仍走后期 overlay/burn-in。
- `npx tsc --noEmit --pretty false --allowImportingTsExtensions` 通过。

### A3. 日志要求

在 debug 日志里记录：

- Stage 1 原始输出和归一化输出。
- Stage 2A 原始输出和归一化输出。
- Stage 2B 原始输出和归一化输出。
- Reference Selector 候选、分数、入选、淘汰原因。
- Prompt Compiler 最终文本和参考图用途说明。

验收标准：

- 跑 2 个测试样本时能从日志看出“为什么这么拆”和“为什么选这些参考图”。

### A4. 阶段 A 已落地产物

阶段 A 的固定样本、验收指标、日志检查点和人工记录模板已经落到：

- `docs/one-prompt-video-script-decomposition-baseline.md`

后续每个阶段至少选择其中 2 个样本做回归；准备上线或切换 `v2` 前建议跑完 6 个样本。

## 4. 阶段 B：类型和 planJson 骨架

目标：先让数据结构存在，不改变生成行为。

### B1. 扩展类型

在 `types.ts` 中增加：

```ts
interface NarrativeEvent {}
interface AnchorStateTimeline {}
interface StoryboardBrief {}
interface SegmentRenderDescription {}
interface CameraGraph {}
interface FinalTransitionPlan {}
interface ReferenceSelectionOutput {}
interface ArtifactMetadata {}
interface GenerationQualityReport {}
```

同时扩展 `OnePromptVideoPlan`：

```ts
interface OnePromptVideoPlan {
  planningManifest?: unknown;
  narrativeEvents?: NarrativeEvent[];
  anchorStateTimeline?: AnchorStateTimeline[];
  consistencyManifest?: unknown;
  storyboardBrief?: StoryboardBrief[];
  segmentRenderDescriptions?: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  transitionReferencePlan?: unknown[];
  finalTransitionPlan?: FinalTransitionPlan[];
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  artifactMetadata?: Record<string, ArtifactMetadata>;
  generationQualityReports?: GenerationQualityReport[];
}
```

### B2. 增加归一化工具

在 `three-stage-planner.ts` 或单独工具中增加：

- `normalizeNarrativeEvents`
- `normalizeAnchorStateTimeline`
- `normalizeStoryboardBrief`
- `normalizeSegmentRenderDescriptions`
- `normalizeCameraGraph`
- `normalizeFinalTransitionPlan`

规则：

- 缺失字段给默认值。
- 数组字段永远归一化为数组。
- 所有 id 字段统一字符串。
- segmentNo、keyframeNo 必须转成数字。
- 引用不存在的 anchor/event/camera 要记录 warning，不直接崩溃。

### B3. planJson 兼容旧字段

在 `project-service.ts` 中读 planJson 时：

- 旧字段 `shots`、`segments`、`keyframes` 继续可用。
- 新字段只在存在时增强 prompt 和 UI。
- 新字段缺失时不影响旧项目打开。

验收标准：

- 新增类型后不改变现有生成结果。
- 旧项目可打开、审核、继续生成。
- `tsc` 通过。

### B4. 阶段 B 已落地产物

本阶段已经落到：

- `src/services/video-orchestrator/types.ts`
- `src/services/video-orchestrator/three-stage-planner.ts`

当前实现策略：

- `OnePromptVideoPlan` 已扩展 `narrativeEvents`、`anchorStateTimeline`、`storyboardBrief`、`segmentRenderDescriptions`、`cameraGraph`、`transitionReferencePlan`、`finalTransitionPlan`、`referenceSelectionOutputs`、`artifactMetadata`、`generationQualityReports`、`plannerWarnings`。
- `three-stage-planner.ts` 已增加阶段 B 所需归一化函数，负责把 camelCase / snake_case 输入统一成内部结构。
- 引用不存在的 anchor、event、camera 会进入 `plannerWarnings`，不会中断生成。
- 新字段只写入 `planJson`，当前不参与图片、视频、字幕、合成调度，因此不改变现有生成行为。
- `project-service.ts` 现有读写逻辑通过 `...plan` 保留未知字段；旧字段 `shots`、`segments`、`keyframes` 仍按原逻辑读取和同步。

## 5. 阶段 C：Stage 1 增加剧情事件层和动态状态注册表

目标：让 Stage 1 不再直接凭感觉锁死 segment，而是先输出事件和状态变化。

### C1. 修改 Stage 1 prompt

在 `three-stage-planner.ts` 的 Planning Architect prompt 中增加要求：

- 必须先输出 `narrative_events`。
- 必须输出 `anchor_state_timeline`。
- `candidate_timeline` 必须由 `narrative_events` 推导。
- 不允许直接写最终 image/video prompt。
- 对每个 anchor 区分静态锁定和动态状态变化。

Stage 1 输出至少包括：

```json
{
  "planning_manifest": {},
  "consistency_manifest": {},
  "narrative_events": [],
  "anchor_state_timeline": [],
  "audio_bible": {},
  "candidate_timeline": []
}
```

### C2. NarrativeEvent 必填字段

每个事件必须有：

- `eventId`
- `dramaticGoal`
- `participants`
- `locationId`
- `initialState`
- `action`
- `resultingState`
- `requiredAnchorIds`
- `previousEventIds`
- `mustBecomeSeparateSegment`

后端校验：

- `previousEventIds` 不能引用不存在事件。
- `requiredAnchorIds` 必须存在于 consistency manifest 或进入 proposed anchors。
- `mustBecomeSeparateSegment=true` 的事件不能被无理由合并。

### C3. AnchorStateTimeline 必填字段

每个动态状态必须记录：

- `anchorId`
- `segmentNo` 或 `eventId`
- `startState`
- `endState`
- `startPosition`
- `endPosition`
- `holderAtStart`
- `holderAtEnd`
- `visibleTransitionPath`

后端校验：

- 同一个产品不能在同一时间同时处于两个互斥位置，除非明确是多个实例。
- holder 变化必须有可见路径或事件解释。
- 如果状态变化不可在单镜头内完成，后续必须触发拆段或审计风险。

验收标准：

- 6 个测试样本都能输出 3-5 个合理事件，复杂广告可更多。
- 产品/道具状态变化能在 `anchorStateTimeline` 里看出来。
- `candidate_timeline` 能追溯到 `source_event_ids`。

### C4. 阶段 C 已落地产物

本阶段已经落到：

- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/types.ts`

当前实现策略：

- Planning Architect prompt 已要求先输出 `narrative_events`，再由事件推导 `candidate_timeline` 和 `planning_manifest.timeline_blueprint`。
- Planning Architect prompt 已要求输出 `anchor_state_timeline`，并区分 anchor 的静态视觉锁定与动态状态变化。
- Stage 1 输出已兼容顶层 `consistency_manifest`、`narrative_events`、`anchor_state_timeline`、`audio_bible`、`candidate_timeline`，也兼容它们放在 `planning_manifest` 内部。
- `VideoTimelineBlueprintSegment` 已增加 `sourceEventIds`，后端会把 `source_event_ids` 归一化进 `planJson`。
- `OnePromptVideoPlan` 已增加 `audioBible` 和 `candidateTimeline`，用于保存 Stage 1 的音频规则和候选时间线。
- 后端会校验 `previousEventIds` 是否引用不存在或非前置事件。
- 后端会校验 `requiredAnchorIds`、`sourceEventIds`、`anchorStateTimeline.anchorId` 是否能追溯到已声明的 anchor/event。
- `mustBecomeSeparateSegment=true` 的事件如果被合并进同一个 segment 且没有 `splitReasonZh`，会进入 `plannerWarnings`。
- holder 变化缺少 `visibleTransitionPath`、同一 anchor 在同一 segment 内出现互斥位置，也会进入 `plannerWarnings`。
- 这些校验当前只记录 warning，不阻断生成；后续阶段 F 再把高风险项接入一镜到底审计和 Split Repair。

## 6. 阶段 D：一致性资产优先生成和锁定

目标：硬一致性参考图必须先生成、先确认，再生成普通关键帧。

### D1. 明确 hard anchor 规则

`consistency_manifest` 中满足以下条件的 anchor 应优先生成参考图：

- 主角、IP 角色、mascot。
- hero product。
- 品牌 Logo 或包装。
- 必须贯穿的场景空间布局。
- 用户明确上传并要求一致的对象。

### D2. 调度规则

在 `project-service.ts` 图片调度中保证：

```text
hard anchor reference images
  -> 用户审核/锁定
  -> 普通 boundary keyframes
  -> motion checkpoint reference images
```

普通关键帧生成前检查：

- 所需 hard anchor 参考图是否已生成。
- 是否已锁定或用户确认。
- 如果缺失，不提交该关键帧任务。

验收标准：

- 第一批图片任务不再混合提交 `anchor reference` 和普通 keyframe。
- 普通 keyframe 的 reference images 能拿到已生成的 anchor 图。
- 缺少 hard anchor 图时，生成停止在可解释状态，而不是退化成本地保底。

### D3. 阶段 D 已落地产物

本阶段已经落到：

- `src/services/video-orchestrator/types.ts`
- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`

当前实现策略：

- `VideoConsistencyReferenceKind` 已从 `character | scene` 扩展为 `character | scene | product | brand_visual | prop | vehicle | food | space_layout | custom`。
- `anchorsToConsistencyReferences` 不再只为人物和场景生成参考图；满足 hard 规则的产品、Logo/品牌视觉、道具、车辆、菜品、空间布局等 anchor 也会生成独立一致性参考帧。
- 所有负数 `keyframeNo` 都被视为一致性参考帧；保留 `-2` 作为首个人物参考帧、`-1` 作为首个场景/空间参考帧，其它 hard anchor 使用 `-100` 起的负数编号。
- 图片调度顺序已收紧为：

```text
hard anchor reference images
  -> 用户锁定/审核
  -> 普通 boundary keyframes
  -> motion checkpoint reference images
```

- `submitNextImageTask` 会先提交缺失的一致性参考帧；只要还有 hard reference 没有图片，普通 keyframe 不会提交。
- hard reference 已出图但未锁定/审核时，项目停在 `IMAGE_REVIEW`，并记录 `wait_consistency_approval` 日志，等待用户确认。
- 普通 keyframe 的参考图只使用已经锁定或 `IMAGE_APPROVED` 的一致性参考图。
- `resumeVideoProject` 已支持在 `IMAGE_REVIEW` 状态下，用户锁定 hard reference 后继续提交普通 boundary keyframes。
- 前端主按钮已增加这一中间态：hard reference 锁定后、普通关键帧未生成时，显示“继续生成关键帧 / Continue keyframes”。

## 7. 阶段 E：Stage 2 拆成 2A 和 2B

目标：保留“三阶段架构”，但第二阶段内部拆成两个清晰子调用。

### E1. Stage 2A：Storyboard Artist

只输出整体分镜草案：

- `storyboardBrief`
- `cameraGraph` 初稿
- `finalTransitionPlan` 初稿

不得输出：

- 最终 prompt。
- 完整 image prompt。
- 完整 video prompt。
- 每个 checkpoint 的详细 prompt。

每个 storyboard brief 必须包含：

- `segmentNo`
- `sourceEventIds`
- `cameraId`
- `visualDescZh/En`
- `beatRole`
- `requiredAnchorIds`
- `locationId`
- `separationReason`

### E2. Stage 2B：Shot Decomposer

输入：

- Stage 1 输出。
- Stage 2A 输出。
- 用户确认过的一致性 anchor。

输出：

- `segmentRenderDescriptions`
- `start_frame_contract`
- `end_frame_contract`
- `motion_contract`
- `single_take_contract`
- `motion_checkpoints`

2B 不能擅自重写故事。如果发现不可执行，只能返回：

- `timeline_change_request`
- `recommendedSplit`
- `requires_cut=true`
- `risk_level=high`

### E3. 兼容当前接口

`createAliyunStoryboardPlan` 可以内部变成：

```text
callStage1()
callStage2A()
callStage2B()
callStage3()
normalizeToCurrentPlan()
```

外部调用暂时不变，减少 API 改动。

验收标准：

- 日志里能分开看到 Stage 2A 和 Stage 2B 输出。
- Stage 2A 的 brief 简洁，不包含 prompt 堆砌。
- Stage 2B 的每段都有首帧、尾帧、运动、一镜到底合同。

### E4. 阶段 E 已落地产物

本阶段已经落到：

- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/types.ts`

当前实现策略：

- `createAliyunStoryboardPlan` 的外部调用方式不变，内部已经变成：

```text
callStage1(planning_architect)
callStage2A(storyboard_artist)
callStage2B(shot_decomposer)
callStage3(prompt_detailer)
normalizeToCurrentPlan()
```

- Stage 2A 使用 `STORYBOARD_ARTIST_SYSTEM_PROMPT`，只输出 `storyboard_artist_plan`：
  - `storyboard_brief`
  - `camera_graph`
  - `final_transition_plan`
  - 简短 `title/logline/style_bible`
- Stage 2A 明确禁止输出最终 prompt、完整 image prompt、完整 video prompt、详细 checkpoint prompt。
- Stage 2B 使用 `SHOT_DECOMPOSER_SYSTEM_PROMPT`，输入 Stage 1 和 Stage 2A 输出，输出 `shot_decomposer_plan`：
  - `segment_render_descriptions`
  - `start_frame_contract`
  - `end_frame_contract`
  - `motion_contract`
  - `single_take_contract`
  - `motion_checkpoints`
  - 兼容当前链路所需的 `keyframes` 和 `segments`
- Stage 2B 发现不可执行时，要求在 `segment_render_descriptions` 中返回 `requires_cut=true`、`risk_level=high`、`timeline_change_request`、`recommended_split`，不能私自重写故事。
- 后端会将 Stage 2A 和 Stage 2B 合并成当前兼容的 `storyboardPlan`，继续供 Stage 3 和现有 plan 构建逻辑使用。
- 日志已拆分记录：
  - `aliyun.storyboard.storyboard_artist.request`
  - `aliyun.storyboard.storyboard_artist.response`
  - `aliyun.storyboard.storyboard_artist.parsed`
  - `aliyun.storyboard.shot_decomposer.request`
  - `aliyun.storyboard.shot_decomposer.response`
  - `aliyun.storyboard.shot_decomposer.parsed`
- `StoryboardBrief` 已补充 `sourceEventIds`、`visualDescZh/En`、`beatRole`、`requiredAnchorIds`、`separationReason`。
- `SegmentRenderDescription` 已补充 `motionContract`、`requiresCut`、`riskLevel`、`timelineChangeRequest`、`recommendedSplit`。
- 后端会校验每个 segment 是否具备 `start_frame_contract`、`end_frame_contract`、`motion_contract`、`single_take_contract`；缺失时进入 `plannerWarnings`，暂不阻断生成。

## 8. 阶段 F：Single-take Audit 和 Split Repair

目标：不要让高风险 segment 继续进入视频生成。

### F1. 审计输入

审计每个 segment：

- `start_frame_contract`
- `end_frame_contract`
- `motion_contract`
- `motion_checkpoints`
- `anchorStateTimeline`
- `cameraGraph`
- segment duration

### F2. 审计规则

直接失败：

- `requires_cut=true`
- `risk_level=high`
- 起点和终点空间/人物/产品状态物理不可达。
- 同一段内出现换场、换机位、换主体距离过大。
- motion checkpoints 像多个镜头列表。

可修复：

- 动作过多，可拆分。
- 镜头运动过大，可简化。
- 产品路径不清，可补路径。
- checkpoint 太多，可合并。

### F3. Split Repair 限制

最大轮次：

```ts
const MAX_SINGLE_TAKE_REVISIONS = 3;
```

流程：

```text
审计通过 -> 冻结
审计不通过且有 recommendedSplit -> 拆分并重跑 2A/2B 受影响段
审计不通过且没有 recommendedSplit -> 调用 Split Repair
Split Repair 仍失败 -> 阻止生成，提示用户修改
```

验收标准：

- 高风险 segment 不会进入视频生成。
- 日志里能看到失败原因和修复建议。
- 用户能看到“为什么不能继续生成”的可读提示。

### F4. 当前落地实现

本阶段对应代码执行点：

- `three-stage-planner.ts`：Stage 2B 输出后立即执行 `repairShotDecomposerPlanUntilSingleTake`。
- `three-stage-planner.ts`：`auditShotDecomposerPlan` 会检查 `requires_cut`、`risk_level=high`、物理不可达、缺少首尾/运动/一镜到底合同、checkpoint 过多和段内切镜词。
- `three-stage-planner.ts`：`Split Repair` 最多重试 `MAX_SINGLE_TAKE_REVISIONS = 3` 次；仍失败时直接抛出可读错误，不进入 Stage 3。
- `project-service.ts`：`submitNextClipTask` 在提交 HappyHorse 前再次读取 `segmentRenderDescriptions` 做硬阻断。

后端提交视频前会直接阻断：

- `requiresCut/requires_cut = true`。
- `riskLevel/risk_level = high`。
- `timelineChangeRequest/timeline_change_request` 非空。
- `singleTakeContract` 标记 `requires_cut`、`risk_level=high` 或 `physically_reachable=false`。
- 分镜描述、运动合同或 checkpoint 中出现 `cut to`、`hard cut`、`dissolve`、`montage`、`切镜`、`转场` 等段内切镜/转场语义。

阻断结果：

- 对应 `videoSegment` 标记为 `FAILED`。
- `videoProject` 标记为 `FAILED`。
- `errorMessage` 返回“镜头 X 为什么不能继续生成”的中文说明。
- 日志记录 `${logEventPrefix}.submit.blocked_single_take_audit`，包含被阻断的 segmentNo 和原因。

兼容策略：

- 旧项目没有 `segmentRenderDescriptions` 时不阻断。
- 新 planner 的 Stage 2B/Repair 负责尽量修复；后端阻断只作为最后保险丝。

## 9. 阶段 G：确定性 Reference Selector

目标：参考图选择不再完全交给大模型临场决定。

### G1. 候选收集

每个 keyframe / motion checkpoint 生成前收集：

- 当前可见 hard anchor 图。
- 用户上传参考图。
- 最近同 location / same camera relation 的关键帧。
- 人物多视图中朝向最接近的一张。
- 父机位关键帧。
- transition reference 图。
- 风格/品牌视觉图。

### G2. 打分

每个候选计算：

- `relevanceScore`
- `conflictScore`
- `recencyScore`
- `viewMatchScore`

综合分：

```text
finalScore =
  relevanceScore * 0.45
  + viewMatchScore * 0.25
  + recencyScore * 0.20
  - conflictScore * 0.35
```

### G3. 配额

最多 4 张：

- 人物身份图最多 1 张。
- 产品图最多 1 张。
- 空间布局图最多 1 张。
- 构图/风格/品牌视觉图最多 1 张。

### G4. 输出调试产物

写入 `referenceSelectionOutputs`：

- candidates
- scores
- selected references
- usage notes
- rejection reasons
- final text prompt

验收标准：

- 每张生成图都能追溯“选了哪些参考图、为什么选、为什么没选”。
- 风格图不会替代身份图。
- hard anchor 缺失时会阻断或提示，不会静默降级。

### G5. 当前落地实现

本阶段对应代码执行点：

- `types.ts`：扩展 `ReferenceSelectionCandidate` 和 `ReferenceSelectionOutput`，记录 URL、来源类型、配额类型、`finalScore`、用途说明、最终文本 prompt 和选中 URL。
- `three-stage-planner.ts`：归一化 `referenceSelectionOutputs` 的新增字段，兼容旧 planJson。
- `project-service.ts`：`selectReferenceImagesForKeyframe` 在普通边界帧和一致性参考帧生成前执行确定性选择。
- `project-service.ts`：`selectReferenceImagesForMicroShot` 在 motion checkpoint 参考图生成前执行确定性选择。
- `project-service.ts`：`saveReferenceSelectionOutput` 将选择结果写回 `planJson.referenceSelectionOutputs`，并记录 `reference_selector.output` 日志。

当前候选来源：

- 已生成并锁定的 hard consistency reference。
- 用户上传参考图。
- 普通关键帧生成时的最近边界关键帧。
- 子分镜参考图生成时的首尾边界帧，作为父机位/空间连续性参考。
- `transitionReferencePlan` 中带 URL 的 transition reference。
- 品牌视觉类 hard anchor 作为 style/brand 候选。

当前打分实现：

```text
finalScore =
  relevanceScore * 0.45
- viewMatchScore * 0.25
- recencyScore * 0.20
- conflictScore * 0.35
```

其中 `viewMatchScore` 和 `recencyScore` 按惩罚分处理，越低越好。

当前配额实现：

- 最多 4 张。
- `character` 最多 1 张。
- `product` 最多 1 张。
- `space_layout` 最多 1 张。
- `style_brand` 最多 1 张。

阻断策略：

- 普通 keyframe / micro-shot 如果声明了 `usesConsistencyAnchors`，但对应 hard anchor 没有已生成且锁定的参考图，会直接抛错，不静默降级。
- 旧项目没有 `usesConsistencyAnchors` 时不强行阻断，但仍会从现有候选中确定性选择。

注意事项：

- 图片生成 prompt 不再把所有一致性参考图 URL 写进文本，避免绕过 selector。
- 实际传给上游图片模型的 `referenceImageUrls` 只使用 selector 选中的 URL。

## 10. 阶段 H：Prompt Compiler 改造

目标：Stage 3 不再直接把长 visual desc 堆给模型，而是编译结构化合同。

### H1. 图片 Prompt Compiler

输入：

- frame contract。
- selected references。
- reference usage notes。
- visible anchors。
- negative prompt policy。

输出：

- final image prompt。
- final negative prompt。
- reference image urls。
- promptDebugArtifact。

硬规则：

- 不让图片模型生成字幕。
- 不让图片模型生成 UI、水印、错误文字。
- 明确每张参考图继承什么、忽略什么。

### H2. 视频 Prompt Compiler

输入：

- first frame hard input。
- motion_contract。
- single_take_contract。
- motion_checkpoints。
- visible anchors。
- audio/subtitle policy。

输出：

- HappyHorse video prompt。
- negative prompt。
- no-audio / no-subtitle constraints。

硬规则：

- 不传 `hard_cut/dissolve/match_cut` 给单段视频。
- 不把多个 checkpoint 写成多个镜头。
- 不写“切到”“转场”“蒙太奇”“镜头切换”。
- 尾帧只能作为文字软目标，不作为 HappyHorse 输入。

验收标准：

- 单段视频 prompt 能读出一条连续运动路径。
- 不再重复堆完整 visual desc。
- 日志里能看到 prompt 编译前后的差异。

### H3. 当前落地实现

本阶段对应代码执行点：

- `types.ts`：新增 `PromptDebugArtifact`，并在 `OnePromptVideoPlan` 中增加 `promptDebugArtifacts`。
- `three-stage-planner.ts`：归一化 `promptDebugArtifacts`，兼容旧 planJson。
- `project-service.ts`：`compileImagePromptForKeyframe` 负责编译边界帧和一致性参考帧图片 prompt。
- `project-service.ts`：`compileImagePromptForMicroShot` 负责编译 motion checkpoint 参考图 prompt。
- `project-service.ts`：`compileVideoPromptForSegment` 负责编译 HappyHorse 单段视频 prompt。
- `project-service.ts`：`savePromptDebugArtifact` 将编译前后差异写入 `planJson.promptDebugArtifacts`，并记录 `prompt_compiler.output` 日志。

图片 Prompt Compiler 当前规则：

- 输入 frame contract、selected references、reference usage notes、visible anchors、negative prompt policy。
- 输出 final image prompt、final negative prompt、reference image urls、promptDebugArtifact。
- 图片 prompt 使用结构化段落：`Frame contract`、`Visible anchor locks`、`Selected reference usage`、`Image rules`。
- 明确每张参考图只继承指定的 identity / layout / product / style 信号，忽略无关姿态、裁切、瑕疵和误文字。
- 强制禁止图片模型生成字幕、UI、水印、时间码、随机文字、错误文字、分屏、前后对比图。
- 品牌或产品文字只在其属于锁定的产品、包装或 logo anchor 时允许。

视频 Prompt Compiler 当前规则：

- 输入 first frame hard input、end frame text-only soft target、motion_contract、single_take_contract、motion_checkpoints、visible anchors。
- HappyHorse 提交时只传 `imageUrl` 作为首帧硬输入，不再传 `lastFrameUrl`。
- 尾帧只写入 prompt 的 `Soft ending state`，作为文字软目标。
- 单段 prompt 不再拼接 `boundaryMode`，也不再把 project-level reference URL 列表塞进文本。
- motion checkpoints 会写成“同一运动路径上的可达状态”，不是多个镜头。
- prompt 会清洗 `hard_cut`、`dissolve`、`match_cut`、`切到`、`转场`、`蒙太奇`、`镜头切换` 等段内切镜语义。
- 明确不要画面内字幕、UI、水印、歌词、随机文字，也不要生成随机人声；字幕、配音、音乐和音效由后期统一添加。

调试产物：

- 每次图片、子分镜参考图、视频片段提交前都会写入 `promptDebugArtifacts[targetArtifactId]`。
- debug artifact 包含 `beforePrompt`、`finalPrompt`、`finalNegativePrompt`、输入合同摘要、参考图 URL、参考图用途说明、compiler rules 和 warnings。
- 日志 `prompt_compiler.output` 会记录编译前后长度、参考图数量和规则，便于排查是否仍在重复堆长 visual desc。

## 11. 阶段 I：前端审核和调试 UI

目标：让用户能看懂、能改、能追溯。

### I1. 短期 UI

先不新增复杂页面，只在现有一句话成片界面增加调试入口：

- 事件层查看。
- 一致性 anchor 查看。
- 动态状态查看。
- 当前帧参考图选择结果。
- 当前 prompt 编译结果。
- 一镜到底审计结果。

### I2. 用户可编辑项

允许用户编辑：

- narrative event 文案和顺序。
- anchor 锁定描述。
- keyframe 目的和 image prompt。
- motion checkpoint 文案和参考图。
- segment subtitle。
- segment video prompt。

用户编辑后：

- 标记相关 artifact dirty。
- 不自动覆盖用户已锁定资产。
- 只重跑受影响链路。

验收标准：

- 用户能解释“这个图为什么像/不像”。
- 用户能看到“这个视频为什么被阻止生成”。
- 用户改一个子分镜，不会导致全项目从头重跑。

### I3. 当前落地实现

本阶段先落在现有一句话成片工作台，不新增独立调试页面。

后端：

- `serializeVideoProject` 暴露 `planDebug`，包括 `narrativeEvents`、`consistencyAnchors`、`anchorStateTimeline`、`segmentRenderDescriptions`、`referenceSelectionOutputs`、`promptDebugArtifacts`、`artifactMetadata` 和 `plannerWarnings`。
- 项目 PATCH 支持 `planDebugPatch`，短期允许编辑事件层、一致性 anchor 和动态状态注册表。
- 用户编辑事件层、一致性 anchor、动态状态后，会把对应 planning artifact 标记为 `dirty`。
- 用户编辑镜头、关键帧、字幕、视频 prompt 或子分镜后，会把当前镜头、当前关键帧、当前子分镜等局部 artifact 标记为 `dirty`，不直接覆盖已锁定图片或视频资产。

前端：

- 项目标题区增加“调试”入口。
- 调试面板包含 6 个 tab：事件层、一致性、动态状态、参考图选择、Prompt 编译、一镜到底审计。
- 事件层、一致性、动态状态短期采用 JSON 编辑器，保存时只写 `planJson` 中对应结构并标记局部 dirty。
- 参考图选择 tab 会按当前选中的关键帧或镜头显示 `referenceSelectionOutputs`，包括已选参考图、候选参考图、使用说明、最终文本 prompt 和 warnings。
- Prompt 编译 tab 会按当前选中的关键帧或镜头显示 `promptDebugArtifacts`，包括编译前 prompt、最终 prompt、负向 prompt、参考图用途、规则和 warnings。
- 一镜到底审计 tab 会显示当前镜头的 `segmentRenderDescription` 中的风险、首帧/尾帧合同、运动合同、一镜到底合同、检查点和项目阻断原因。

暂不做：

- 不在本阶段做可视化依赖图。
- 不在本阶段做复杂拖拽式事件排序 UI。
- 不在本阶段做自动局部重跑按钮；先保证 dirty 标记和调试信息可见，局部恢复留到阶段 J。

## 12. 阶段 J：Artifact Metadata 和局部恢复

目标：从“数据保存”升级为“可恢复依赖图”。

### J1. 第一版只放 planJson

`artifactMetadata` 可以先是：

```json
{
  "artifact_id": {
    "revision": 1,
    "schemaVersion": "",
    "plannerVersion": "",
    "promptVersion": "",
    "modelVersion": "",
    "inputHash": "",
    "dependsOn": [],
    "status": "ready",
    "dirtyReason": "",
    "retryFromStage": "generation"
  }
}
```

### J2. dirty 传播规则

- 改 anchor -> 依赖它的 keyframe/checkpoint/segment prompt dirty。
- 改 narrative event -> storyboard brief、segment render description、transition plan dirty。
- 改 keyframe prompt -> 该 keyframe 图片和依赖它的视频片段 dirty。
- 改 camera graph -> 同机位相关 keyframe 和 reference selection dirty。
- 改 prompt compiler 版本 -> prompt compilation dirty，但不一定让已批准图片 dirty。

### J3. 恢复策略

根据 dirty 原因决定重跑点：

- 图片生成失败 -> 从 generation 重试。
- 参考图选错 -> 从 Reference Selector / compiler 重试。
- prompt 编译错 -> 从 Stage 3 重试。
- segment 合同错 -> 从 Stage 2B 重试。
- 事件边界错 -> 从 Stage 1 或 Stage 2A 重试。

验收标准：

- 停止生成后继续生成，不会丢失已有成果。
- 单张图失败可以只重试单张图。
- 单个 segment 失败可以只重试该 segment 及后续依赖。

### J4. 当前落地实现

本阶段仍然只使用 `planJson.artifactMetadata`，不新增 Prisma 表。

已实现：

- `ArtifactMetadata` 增加 `retryFromStage` 和 `updatedAt`。
- 新分镜计划保存前会初始化第一版 artifact 依赖图。
- 依赖图覆盖：planning、anchor、keyframe、reference selection、prompt compiler、micro-shot image、segment video、final video。
- dirty 标记会沿 `dependsOn` 递归传播：
  - 改 narrative events 会影响 timeline、storyboard、segment、prompt、video。
  - 改 consistency anchors 会影响 anchor、keyframe、reference selection、prompt、video。
  - 改 keyframe prompt 会影响 keyframe image 和依赖该 keyframe 的 segment prompt/video。
  - 改 segment / subtitle / micro-shot 会影响对应 segment prompt/video 和 micro-shot 下游资产。
- Reference Selector 保存输出时，目标 `*:reference_selection` 标记为 `ready`。
- Prompt Compiler 保存输出时，目标 `*:prompt` 标记为 `ready`。
- 图片、子分镜参考图、视频片段、最终合成提交时标记 `generating`，成功标记 `ready`，失败标记 `failed`。
- 用户审核通过关键帧或内部子分镜参考图后，对应生成资产标记 `approved`。
- 增加局部 segment 视频重试服务和接口：`POST /api/video-projects/:projectId/shots/:shotId/clip`。
- 前端当前镜头详情中增加轻量“重新生成”按钮，可只重试当前 segment clip。

暂不做：

- 不在本阶段做可视化依赖图编辑器。
- 不在本阶段自动删除 dirty 下游资产，只记录状态和恢复起点。
- 不在本阶段自动根据 dirty 图执行批量恢复；后续可在恢复控制台中基于 `retryFromStage` 编排。

## 13. 阶段 K：GenerationQualityReport

目标：生成后自动评估，不再只靠用户肉眼发现问题。

### K1. 第一版评估范围

先覆盖：

- anchor reference image。
- boundary keyframe。
- motion checkpoint image。
- video segment。

暂缓：

- final video 全片审美评分。
- 高级镜头语言评分。

### K2. 评分字段

每个报告包含：

- `identityScore`
- `layoutScore`
- `promptAlignmentScore`
- `continuityScore`
- `singleTakeScore`
- `artifactIssues`
- `passed`
- `retryInstruction`

### K3. 候选选择

如果以后同一资产生成多个候选：

```text
生成候选 -> 质量评分 -> 选最高 passed 候选 -> 用户审核
```

不能默认使用第一个完成的候选。

### K4. 失败反馈

失败时把问题转成重试提示：

- 人物不像 -> 加强 identity reference usage。
- 产品 logo 错 -> 强化 product reference，禁止错误文字。
- 空间错 -> 加强 scene layout / parent camera reference。
- 视频切镜 -> 简化 motion contract，减少 checkpoint。
- 产品复制 -> 强化 anchor state timeline 和 instance count。

验收标准：

- 质量失败能产出具体 retryInstruction。
- 明显失败资产不会直接进入下一阶段，除非用户手动接受。

### K5. 当前落地实现

第一版采用保守启发式质检，不依赖新的视觉模型调用，后续可以替换或叠加 `qwen-vl-max` 等视觉理解评分。

已实现：

- `quality-judge.ts` 增加图片和视频统一质量报告生成器。
- 图片报告覆盖：
  - anchor reference image。
  - boundary keyframe。
  - motion checkpoint image。
- 视频报告覆盖：
  - video segment。
- 报告字段包含：
  - `identityScore`
  - `layoutScore`
  - `promptAlignmentScore`
  - `continuityScore`
  - `singleTakeScore`
  - `artifactIssues`
  - `passed`
  - `retryInstruction`
- 生成成功、生成失败、提交失败、一镜到底审计阻断都会写入 `planJson.generationQualityReports`。
- 报告会同步更新 `artifactMetadata`：
  - `passed=true` -> 对应 artifact 标记为 `ready`。
  - `passed=false` -> 对应 artifact 标记为 `failed`，并记录 `retryInstruction`。
- 明显失败不会进入下一阶段：
  - 图片报告失败会把对应 keyframe 或 motion checkpoint 标记 failed。
  - 视频报告失败会把对应 segment 标记 failed。
  - 一镜到底阻断会产出 video segment quality report，并把恢复点指向 Stage 2B / generation。
- 前端调试面板的一镜到底审计 tab 增加“质量报告”展示，按当前选中的关键帧或镜头过滤。

当前启发式失败条件：

- 缺少生成 URL。
- 上游返回失败。
- 视频 prompt 含切镜、转场、蒙太奇等段内剪辑语言。
- prompt 明显过短时降低分数并生成修复建议。

暂不做：

- 不做 final video 全片审美评分。
- 不做高级镜头语言评分。
- 不在本阶段自动多候选择优；已保留 `assetId` 去重报告结构，后续可扩展为 candidate reports。

## 14. 阶段 L：最终转场和音频后期

目标：解决“关键帧一致但成片硬拼”和“音频不一致”。

### L1. FinalTransitionPlan

每段之间输出：

- `visualMode`
- `audioMode`
- `overlapSeconds`
- `matchAnchorId`
- `generatedBridgeRequired`

执行原则：

- 段内视频 prompt 不包含转场词。
- 最终合成阶段根据 `finalTransitionPlan` 做转场。
- `generated_bridge` 必须单独生成、审核、再进入合成。

### L2. Audio Bible

项目级输出：

- BGM 风格。
- 旁白策略。
- 音效策略。
- 是否剥离片段原音轨。
- 音量、ducking、loudnorm 策略。

执行原则：

- 视频片段生成阶段默认禁止随机人声/歌词。
- 最终合成阶段统一加音频。
- 字幕和旁白从同一脚本文案派生。

验收标准：

- 成片段间声音不会每段突变。
- 如果有字幕/旁白，文案一致。
- 可单独重新合成最终视频，不必重跑图片/视频生成。

### L3. 当前落地实现

最终合成阶段已接入 `finalTransitionPlan` 和 `audioBible`，不改变单段 HappyHorse 生成方式。

已实现：

- `composeVideoProject` 会从 `planJson.finalTransitionPlan` 读取最终段间转场计划，并传给本地合成器。
- `composeVideoProject` 会从 `planJson.audioBible` 读取项目级音频策略，并传给本地合成器。
- `composeVideoProject` 支持在 `FINAL_REVIEW` 和 `DONE` 状态下重新合成最终视频，只重跑最终合成，不重跑图片或单段视频生成。
- `submitAliyunImageToVideoTask` 会强制使用 `happyhorse-1.1-i2v`，避免一句话成片被环境变量误切到其他视频模型。
- `local-compose.ts` 根据每个 pair 的 `visualMode` 和 `overlapSeconds` 执行最终视觉转场：
  - `hard_cut` / `match_cut`：近似硬切，极短 overlap。
  - `dissolve`：使用最终合成阶段 xfade。
  - `fade_to_black`：使用 fadeblack。
  - `generated_bridge`：当前阶段直接阻断合成，要求先单独生成并审核 bridge clip。
- `generatedBridgeRequired=true` 时不允许静默降级为普通转场。
- 音频策略默认剥离单段视频原音，避免每段随机人声、歌词、环境声突变。
- 最终合成会统一加音频轨：
  - 如果 `audioBible.bgmUrl` / `bgm_url` / `bgmPath` / `bgm_path` 或环境变量 `ONE_PROMPT_BGM_URL` / `ONE_PROMPT_BGM_PATH` 存在，则循环使用该 BGM。
  - 如果没有 BGM，则添加统一静音 stereo audio track，保证最终视频音轨结构稳定。
- 支持 `ONE_PROMPT_BGM_VOLUME` 或 `audioBible.volume` / `bgmVolume` 控制 BGM 音量。
- 支持 loudnorm，默认开启，可通过 `audioBible.loudnorm=false` 或 `ONE_PROMPT_AUDIO_LOUDNORM=false` 关闭。
- 字幕仍由最终合成阶段烧录，字幕文本来自 segment subtitle，和旁白文案保留同源数据基础。
- 前端调试面板会暴露 `finalTransitionPlan` 和 `audioBible`，方便排查最终合成策略。

暂不做：

- 不在本阶段生成 bridge clip；只阻断并提示必须先生成、审核。
- 不在本阶段自动 TTS 旁白；旁白策略先作为 `audioBible` 数据保留，字幕仍先落地。
- 不在本阶段做复杂 J-cut / L-cut 原声混音；默认统一剥离原音并加全片统一音轨。

## 15. 推荐开发顺序

### 第一批：低风险结构增强

1. 增加类型和 planJson 字段。
2. Stage 1 输出 `narrativeEvents` 和 `anchorStateTimeline`。
3. Stage 2B 输出 `start/end/motion/single_take` 合同。
4. 保存新字段，但不强制驱动生成。
5. 日志记录新字段。

完成标志：

- 新旧项目都能跑。
- 日志可读。
- 生成质量不变差。

### 第二批：让新结构驱动参考图和 prompt

1. hard anchor 图优先生成。
2. Reference Selector 第一版。
3. 图片 Prompt Compiler 改造。
4. 视频 Prompt Compiler 改造。
5. 记录 promptDebugArtifacts。

完成标志：

- 人物/产品一致性明显提升。
- 单段视频 prompt 更像连续运动。
- 每张图都有 referenceSelectionOutputs。

### 第三批：阻断高风险生成

1. Single-take Audit。
2. Split Repair。
3. 高风险阻断。
4. UI 显示审计失败原因。

完成标志：

- 高风险 segment 不再继续提交 HappyHorse。
- 用户知道如何修改。

### 第四批：局部恢复和质量反馈

1. artifactMetadata 第一版。
2. dirty 传播。
3. GenerationQualityReport 第一版。
4. retryInstruction 反馈到 prompt compiler。

完成标志：

- 单资产失败可以局部重试。
- 质量失败能自动给下一次生成具体修复指令。

### 第五批：转场、音频和长期数据表

1. finalTransitionPlan 驱动合成。
2. audioBible 驱动统一音频。
3. transitionReferencePlan 中期实现。
4. 高频调试产物拆表。

完成标志：

- 最终成片转场和音频更稳定。
- 大项目调试不再依赖巨大 planJson。

## 16. 每个 PR 的最低验收清单

每个 PR 至少完成：

- 类型检查通过：

```bash
npx tsc --noEmit --pretty false --allowImportingTsExtensions
```

- diff 检查通过：

```bash
git diff --check
```

- 至少跑 1 个旧项目，确认能打开。
- 至少跑 1 个新项目，确认 planJson 可保存。
- 如果改 planner，必须保存一份日志样本。
- 如果改生成调度，必须验证停止/继续生成不丢状态。
- 如果改 UI，必须验证中文/英文显示不会混用。

## 17. 风险和回滚策略

### 风险 1：大模型输出过长或不稳定

缓解：

- Stage 2 拆 2A/2B。
- 每个 stage 输出严格 schema。
- 后端归一化和默认值兜底。
- 超长时分 segment 批量处理。

回滚：

- 切回 `ONE_PROMPT_VIDEO_PLANNER_ARCH=v1`。

### 风险 2：planJson 过大

缓解：

- 第一版只保留关键 debug。
- 图片 URL 和 prompt compilation 可按需存。
- 后续拆表。

回滚：

- 新字段不参与旧读取逻辑，旧项目仍走旧字段。

### 风险 3：阻断太严格导致用户生成不了

缓解：

- 第一版用 warning 模式。
- 第二版只阻断 `requires_cut=true` 和 `risk_level=high`。
- 提供用户手动接受入口，但必须记录。

回滚：

- 关闭 Single-take Audit 阻断，只保留日志。

### 风险 4：Reference Selector 选错图

缓解：

- 记录候选和淘汰原因。
- UI 允许用户手动替换参考图。
- hard anchor 永远优先。

回滚：

- 只传 anchor 图和当前关键帧图，不使用复杂候选。

## 18. 最小可交付版本定义

如果只想先做一个最小但有价值的版本，范围如下：

1. Stage 1 输出 `narrativeEvents` 和 `anchorStateTimeline`。
2. Stage 2B 输出 `start_frame_contract`、`end_frame_contract`、`motion_contract`、`single_take_contract`。
3. hard anchor 图先生成并锁定。
4. Reference Selector 只支持 anchor 图 + 最近同机位关键帧。
5. 视频 prompt 只由 motion contract 编译。
6. 高风险 `requires_cut=true` 阻断生成。

这个最小版本已经能解决三类核心问题：

- Segment 拆分更有因果依据。
- 产品/人物状态变化更连续。
- 单段视频更接近一镜到底。
