# 一句话成片：剧本拆解结构、系统 Prompt 与 Bug 审计

> 本文由 `scripts/generate-one-prompt-video-script-reference.mjs` 从当前源码生成。  
> 审计基准：2026-07-24 当前工作区。代码变化后运行 `node scripts/generate-one-prompt-video-script-reference.mjs` 即可刷新原文附录。

## 1. 这套系统到底在做什么

用户输入一句创意、总时长、画幅、风格和可选参考图。系统不会直接把这句话交给视频模型，而是先构造一份可审核、可恢复、可逐段生成的 `OnePromptVideoPlan`。

```text
参考图（可选）
  → Reference Fact Extractor：只提取客观视觉事实
用户创意 + 时长 + 画幅 + 风格
  → Planning Architect：创意策略、事件、资产锚点、时间轴合同
  → Storyboard Artist：剧情节拍、因果证据、分镜、机位与段间转场
  → Story Contract Gate：验证 beat/event/evidence/segment 引用
  → Asset Contract Gate：验证人物、产品、品牌、场景资产覆盖
  → Shot Decomposer：把每段变成可执行的一镜到底合同
  → Single-Take Audit：阻止段内切镜、跳场、不可达动作
      ↳ 失败时 Split Repair
  → Prompt Detailer：编译边界帧、片段和子分镜提示词
  → Story Quality Gate + Final Story Contract + Plan Validator
  → planJson → PLAN_REVIEW
```

默认多段模式会让每个 segment 独立执行“拆镜 → 审计 → 提示词”，可并发、可检查点恢复；单段项目或 `whole` 模式走整片拆镜与整片提示词。

## 2. 时间与分段规则

- 项目总时长：3–180 秒。
- 单个 segment：3–15 秒，这是上游视频生成单元，不是整条视频的限制。
- 段数边界：`ceil(total / 15)` 到 `floor(total / 3)`，模型在范围内按剧情、空间、动作和机位连续性选择。
- 每段内部：一个连续、不切镜的 camera take。
- 段与段之间：允许 hard cut、match cut、dissolve 等最终剪辑转场。
- 边界关键帧：N 个 segment 对应 N+1 个时间轴关键帧；相邻段共享边界。

## 3. 分阶段输入/输出合同

| 阶段 | 主要输入 | 主要输出 | 硬门禁 |
|---|---|---|---|
| Reference Fact Extractor | 参考图 URL | 人物、产品、场景、布局客观事实 | 不得编故事、不得猜图外事实 |
| Planning Architect | user idea、aspect、duration、style、segment bounds、reference facts | creative strategy、narrative events、micro rules、anchor timeline、candidate timeline、planning manifest | 总时长精确相等；每段 3–15 秒；事件/锚点引用合法 |
| Storyboard Artist | planning manifest、story context、必需 story functions | beats、evidence registry、shot grouping、storyboard brief、camera graph、transition plans | 因果引用只能指向更早 beat；payoff 必须有先前证据；CTA 必须晚于 proof/payoff |
| Story Contract Gate | Artist 输出 + 合法 event/segment ID | gate report；必要时修复后的 Artist 输出 | 模板必需节拍、因果和证据引用均合法 |
| Asset Contract Gate | manifest + events + Artist 输出 + reference facts | asset contract、修正后的可见锚点映射 | 硬资产不能被空数组静默删掉 |
| Shot Decomposer | 目标段、相邻段、目标 beats、shot group、转场上下文 | keyframes、segments、render descriptions、micro shots、video prompt contract | 每段必须有合法 `video_prompt_contract`；首尾状态物理可达 |
| Single-Take Audit | 完整/目标段拆镜结构 | issues 或通过 | 段内切镜、叠化、瞬移、不可达路径、危险高风险均阻断 |
| Split Repair | audit issues + 原拆镜计划 | 修复后的目标段 | 不得用改写措辞掩盖切镜 |
| Prompt Detailer | 已批准的一镜到底合同 | keyframe/video/micro-shot prompts | 不改故事和时间轴；静态图片不得描述运动过程 |
| Final gates | 归一化后的完整 plan | quality report、validation issues | final story contract 和 generation validator 必须通过 |

## 4. 核心对象关系

```text
creativeStrategy
  └─ narrativeEvents
      └─ storyBeats ← evidenceRegistry
          └─ shotGroupingPass
              └─ storyboardBrief
                  └─ timelineBlueprint / candidateTimeline
                      ├─ keyframes (N+1)
                      ├─ segments (N)
                      │   ├─ segmentRenderDescriptions
                      │   │   ├─ startFrameContract
                      │   │   ├─ endFrameContract
                      │   │   ├─ motionContract
                      │   │   ├─ singleTakeContract
                      │   │   └─ videoPromptContract
                      │   └─ microShots
                      └─ finalTransitionPlan (N-1)

consistencyManifest / assetContract / anchorStateTimeline
  └─ 横向约束 events、beats、keyframes、segments、microShots

cameraGraph
  └─ 横向约束机位继承、轴线、空间布局和转场参考图
```

## 5. 系统 Prompt 清单

下表是 `three-stage-planner.ts` 中全部 11 个系统 Prompt。附录 A 为当前源码原文，不做翻译或删节。

| 常量 | 角色/路径 | 输入 | 输出 | 源码行 |
|---|---|---|---|---|
| `JSON_REPAIR_SYSTEM_PROMPT` | 异常修复 | JSON-like 文本 | 合法 JSON；不允许新增剧情 | 191–201 |
| `STORY_QUALITY_REWRITE_SYSTEM_PROMPT` | 剧情质量重写（当前主流程未调用） | 质量问题 + 当前计划 | 从 strategy / beat / storyboard 指定层重写 | 203–233 |
| `PLANNING_ARCHITECT_SYSTEM_PROMPT` | 阶段 1：规划架构 | 用户创意、时长、画幅、风格、参考图事实 | 创意策略、事件、锚点、候选时间轴、planning_manifest | 261–486 |
| `STORYBOARD_ARTIST_SYSTEM_PROMPT` | 阶段 2A：剧情分镜 | planning_manifest + story context | story beats、证据、分组、storyboard、camera graph、转场 | 488–675 |
| `STORY_CONTRACT_REPAIR_SYSTEM_PROMPT` | 阶段 2A 修复 | 合同报告 + 原分镜计划 | 仅修因果 ID、证据与必需节拍 | 677–690 |
| `REFERENCE_FACT_EXTRACTOR_SYSTEM_PROMPT` | 参考图预处理 | 最多 9 张图 | 客观人物、产品、场景、布局事实 | 692–699 |
| `SHOT_DECOMPOSER_SYSTEM_PROMPT` | 阶段 2B：整片拆镜 | 规划 + 分镜 + 锚点 | 关键帧、片段、render contracts、micro shots、video prompt contract | 701–862 |
| `SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT` | 阶段 2B：逐段拆镜（默认多段路径） | 目标段 + 相邻上下文 | 仅目标段及其边界帧、运动/终态合同 | 864–1003 |
| `PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT` | 阶段 3：逐段提示词编译 | 已通过一镜到底审计的目标段 | 目标段图片/视频/子分镜提示词 | 1005–1050 |
| `SPLIT_REPAIR_SYSTEM_PROMPT` | 一镜到底修复 | 审计问题 + 原拆镜计划 | 简化动作或返回需要拆分的高风险段 | 1052–1090 |
| `PROMPT_DETAILER_SYSTEM_PROMPT` | 阶段 3：整片提示词编译 | 合并后的完整 storyboard plan | 所有关键帧、片段、子分镜提示词 | 1092–1140 |

注意：

- `STORY_QUALITY_REWRITE_SYSTEM_PROMPT` 有完整实现函数，但当前主流程没有调用该重写函数；它属于“存在于源码但当前不执行”的 Prompt。
- 图片/视频生成完成后的视觉质量评估另有 2 个 Prompt，位于 `generation-quality-evaluator.ts`，属于生成质检，不属于剧本拆解规划。
- 模型每次收到的是 system Prompt 加动态 user JSON。动态 user JSON 由 `buildPlanningArchitectContent`、`buildShotDecomposerSegmentContent`、`buildPromptDetailerSegmentContent` 等函数生成，不是固定 Prompt 常量。

## 6. 动态 user JSON 的关键内容

### 6.1 Planning Architect

```json
{
  "user_idea": "用户原始创意",
  "aspect_ratio": "9:16 | 16:9 | 1:1",
  "duration_seconds": 30,
  "style_preset": "可选",
  "segment_count_min": 2,
  "segment_count_max": 10,
  "segment_duration_min_seconds": 3,
  "segment_duration_max_seconds": 15,
  "reference_facts": {},
  "reference_usage_rule": "参考图只约束身份、产品、场景和风格，不是故事时间轴"
}
```

### 6.2 Storyboard Artist

包含 `user_idea`、画幅、总时长、归一化后的 `planning_manifest`、`story_design_context`、模板 ID、模板必需剧情功能、因果字段要求和证据注册要求。

### 6.3 Segment Shot Decomposer

只发送目标段及必要邻域：项目意图、风格、字幕策略、锚点、目标段前后相邻时间轴、目标 storyboard brief、目标 beats、目标 shot group、相关转场、camera graph 和已确认资产。这样减少单次上下文并允许多段并发。

### 6.4 Segment Prompt Detailer

发送目标段、该段已通过审计的拆镜合同、仅由该 worker 负责的 boundary keyframe 编号，以及相邻上下文。共享边界帧只允许一个 worker 产出 Prompt，避免相邻段互相覆盖。

## 7. 归一化、修复、缓存与最终执行

### 7.1 JSON 修复

阶段输出不是合法 JSON 时，会把最多 60,000 字符交给 JSON Repair Prompt。它只能修语法并保守闭合结构，不能新增剧情。

### 7.2 检查点

`AliyunStoryboardPlannerCheckpoint` 保存 reference facts、planning、Artist、逐段 Decomposer、审计后段和逐段 Prompt Detailer 结果。当前版本为 2，输入指纹包含用户输入和 `STORYBOARD_PLANNER_CONTRACT_REVISION`。Prompt/结构契约升级时必须同步修改 revision 或 checkpoint version。

### 7.3 最终视频 Prompt 的真实来源

Stage 3 的 `segment.videoPrompt` 不是最终 provider Prompt 的唯一来源。生成时 `project-service.ts` 会优先读取 `segmentRenderDescription.videoPromptContract`，用确定性编译器生成 HappyHorse Prompt；老项目没有合同时才走 compatibility contract。这一点对排查“界面 Prompt 和上游实际 Prompt 不一样”尤其重要。

## 8. Bug 审计

### 8.1 本次已修复

| 优先级 | Bug | 证据/影响 | 修复 |
|---|---|---|---|
| P0 | Prompt/结构升级后仍复用旧 checkpoint | 旧指纹只包含用户输入，不包含规划契约版本；新增 `video_prompt_contract` 后历史结果可绕过新 Prompt | checkpoint 升级到 v2；指纹加入显式 contract revision |
| P0 | 缓存的 Decomposer/审计结果未重新验证 `video_prompt_contract` | 新请求会校验，`checkpoint_reused` 分支此前直接放行 | 新鲜结果和复用结果统一执行 `assertShotPlanVideoPromptContract` |
| P1 | Split Repair 可能丢失 `video_prompt_contract` | Repair Prompt 原先只展示空的 `segment_render_descriptions`；代码又会在修复后强校验，模型遗漏时任务失败 | Repair Prompt 与输出 schema 现在要求保留/重建完整合同；修复结果继续执行硬校验 |
| P2 | 非 30 秒项目标题仍显示“30s 短片” | `deriveTitle` 把通用后缀写死为 30s | 改为使用实际 `durationSeconds` |
| P1 | 一镜到底审计把“禁止切镜”等负面约束误判为切镜指令 | 审计把所有深层字符串拍平，无法区分执行指令和 forbidden/negative 字段 | 已按字段路径审计并排除负面约束；错误信息显示命中路径 |
| P1 | 首个根机位被误判为缺少转场参考 | validator 对不存在父机位的首镜也要求 transition reference | 根机位允许无父级来源；alternate/new setup 仍严格校验 |

### 8.2 仍建议修复

| 优先级 | 问题 | 当前事实 | 建议 |
|---|---|---|---|
| P1 | Story Quality 自动重写是死路径 | `rewriteStoryPlanUntilQualityPass` 和对应 Prompt 存在，但主流程只记录 `deferred_to_pre_shot_contract`，没有调用；默认 `ONE_PROMPT_VIDEO_STORY_GATE=off` | 明确二选一：删除死代码/Prompt，或在 Shot Decomposer 前执行重写并重建下游合同；生产环境至少使用 warn，关键业务使用 strict |
| P1 | checkpoint 版本仍依赖开发者手动维护 | 本次加入 revision 后可失效，但未来改 Prompt 若忘记改 revision，问题会重现 | 构建时对 11 个 Prompt + schema 生成自动 hash，作为 checkpoint fingerprint 一部分 |
| P2 | JSON repair 对超长结果硬截 60,000 字符 | 尾部可能包含 segments/prompts；截断后 Repair 只能“保守闭合”，可能得到语法合法但语义残缺的对象 | 优先要求模型短输出；按 JSON 流增量恢复或重跑原阶段，不对已知被截断内容做语义性恢复 |
| P2 | 审计错误摘要只显示前 5 项 | 多段同时失败时，UI 只展示部分原因，容易误以为只坏了 5 段 | UI 展示总数并支持展开全部 issue；日志保留完整结构 |
| P2 | Prompt 与 schema 规模过大且重复 | Architect/Artist/Decomposer 合计数万字符，多处重复一镜到底、字幕和锚点规则 | 抽出版本化公共合同，阶段 Prompt 仅描述角色增量；以测试保证公共规则全部注入 |
| P2 | 归一化会把缺失/空 micro shots 替换为 fallback | 模型显式返回 `[]` 与字段缺失被视为同一种情况，可能隐藏模型判断 | 区分 undefined 与显式空数组；只有兼容旧数据时才使用 fallback，并记录 warning |
| P2 | 默认故事质量门禁关闭 | 结构合同会检查 ID 和引用合法性，但“故事好不好”默认不会阻断 | 为线上广告项目设置 warn/strict，并在审核 UI 显示 score、issue codes、rewrite required |

## 9. 给评审人的最短检查清单

1. 时间轴总和是否等于用户要求的总时长，每段是否 3–15 秒。
2. payoff 是否有更早的 trigger/proof/evidence，CTA 是否在 payoff 之后。
3. 每个可见人物、产品、品牌、场景是否有资产锚点或明确 exclusion。
4. 每个 segment 的首尾帧是否在同一空间和机位族内物理可达。
5. segment 内是否出现切镜、换场、蒙太奇、叠化、瞬移或大幅构图重置。
6. `video_prompt_contract` 是否包含至少一个 hard terminal requirement，且没有重复/超预算条目。
7. 页面展示的 Prompt、debug artifact 的 compiled Prompt、实际 provider 请求是否一致。
8. 失败重试时是否复用了同一 contract revision 下的有效 checkpoint，而不是旧版本缓存。

## 10. TypeScript 结构索引

附录 B 收录 `types.ts` 中全部导出的 type/interface 原文，以下是源码位置索引。

| 类型 | 源码行 |
|---|---|
| `VideoAspectRatio` | 1–1 |
| `VideoStyleBible` | 1–13 |
| `VideoConsistencyAnchorType` | 13–27 |
| `VideoConsistencyAnchor` | 27–52 |
| `VideoTimelineBlueprintSegment` | 52–68 |
| `VideoAssetContractExclusion` | 68–75 |
| `VideoAssetContractTarget` | 75–89 |
| `VideoAssetContract` | 89–104 |
| `VideoAssetDependencyFields` | 104–111 |
| `VideoSubtitlePolicy` | 111–125 |
| `VideoPlanningManifest` | 125–167 |
| `VideoPromptDetailPlan` | 167–192 |
| `VideoPlanKeyframe` | 192–214 |
| `VideoConsistencyReferenceKind` | 214–225 |
| `VideoAssetCategory` | 225–234 |
| `VideoAssetView` | 234–242 |
| `VideoAssetLibraryItem` | 242–259 |
| `VideoAssetLibrary` | 259–263 |
| `VideoConsistencyReference` | 263–291 |
| `VideoFrameDesign` | 291–336 |
| `VideoNegativePromptGroups` | 336–343 |
| `VideoTimedPrompt` | 343–352 |
| `VideoMicroShot` | 352–383 |
| `VideoAudioPlan` | 383–396 |
| `VideoPlanSegment` | 396–441 |
| `VideoPlanShot` | 441–483 |
| `NarrativeEvent` | 483–496 |
| `VideoCreativeCategory` | 496–507 |
| `VideoCreativeTemplateId` | 507–517 |
| `VideoCreativeStrategy` | 517–556 |
| `VideoStoryFunction` | 556–571 |
| `VideoStoryTraceFields` | 571–593 |
| `VideoStoryBeat` | 593–624 |
| `VideoStoryEvidence` | 624–632 |
| `VideoNarrativeMicroRules` | 632–647 |
| `VideoShotGroupingPass` | 647–680 |
| `VideoStoryQualityReport` | 680–705 |
| `AnchorStateTimelineEntry` | 705–717 |
| `AnchorStateTimeline` | 717–722 |
| `StoryboardBrief` | 722–741 |
| `SegmentRenderDescription` | 741–758 |
| `VideoPromptTerminalRequirement` | 758–766 |
| `VideoPromptContract` | 766–776 |
| `CameraRelation` | 776–785 |
| `CameraGraphNode` | 785–801 |
| `CameraGraphEdge` | 801–808 |
| `CameraGraph` | 808–813 |
| `PlanValidationIssue` | 813–821 |
| `FinalTransitionPlan` | 821–831 |
| `TransitionReferenceFrameCandidate` | 831–841 |
| `TransitionReferenceArtifact` | 841–863 |
| `GeneratedBridgeArtifact` | 863–876 |
| `ReferenceSelectionCandidate` | 876–897 |
| `ReferenceSelectionOutput` | 897–912 |
| `ArtifactMetadata` | 912–932 |
| `VideoMediaRevisionKind` | 932–934 |
| `VideoMediaRevision` | 934–944 |
| `RollbackVideoMediaInput` | 944–950 |
| `GenerationQualityReport` | 950–1007 |
| `QualityDisplayLanguage` | 1007–1009 |
| `QualityDisplaySummaryItem` | 1009–1014 |
| `QualityDisplaySummary` | 1014–1022 |
| `GenerationIssueLedgerEntry` | 1022–1037 |
| `GenerationCorrectionAction` | 1037–1062 |
| `PromptDebugArtifact` | 1062–1077 |
| `OnePromptVideoPlan` | 1077–1126 |
| `CreateVideoProjectInput` | 1126–1135 |
| `PlanVideoProjectInput` | 1135–1145 |
| `UpdateShotInput` | 1145–1160 |

---

## 附录 A：全部系统 Prompt 原文

### A.1 `JSON_REPAIR_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:191`

```text
You are a strict JSON repair tool.

Return only valid JSON. No markdown, explanations, comments, or extra text.

Your job:
- Fix syntax errors in the provided JSON-like text.
- Preserve all semantic content, keys, arrays, objects, strings, numbers, and booleans as much as possible.
- Do not invent new story content.
- Do not translate values.
- If a value is truncated or impossible to recover, close the nearest valid object/array conservatively.
- Output one complete JSON object.
```

### A.2 `STORY_QUALITY_REWRITE_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:203`

```text
You are Story Quality Rewrite Planner for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, comments, or extra text.

Your job:
- Repair a weak video plan according to Story Quality Gate issues.
- Preserve aspect ratio, total duration, segment count, segment numbers, segment start/end times, boundary keyframe numbers, consistency anchors, asset library intent, style bible, and camera continuity constraints.
- Do not turn a non-game video into a game ad. Do not use bonus, jackpot, cards, coins, opponent shock, leaderboard, or win streak unless the selected category is game.
- If rewrite_from_stage is creative_strategy, rewrite creative_strategy and all downstream story_beats, storyboard_brief, shot_grouping_pass, keyframes, segments, and prompt_detail_plan.
- If rewrite_from_stage is beat_sheet, preserve creative_strategy but rewrite story_beats and all downstream storyboard/prompt fields.
- If rewrite_from_stage is storyboard, preserve creative_strategy and story_beats but rewrite storyboard_brief, keyframes, segments, segment_render_descriptions, and prompt_detail_plan.
- Every payoff, win, conversion, order, transformation, or reward must have a visible prior trigger/proof and a reactionBeat.
- Every turning_point/proof/payoff must include action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- Every segment must provide a new information_unit, linked_beat_ids, story_function, cause, effect, and key_evidence_ids when evidence matters.
- References are assets and identity/style constraints, not the story itself.

Output contract:
{
  "story_quality_rewrite_plan": {
    "rewrite_from_stage": "creative_strategy | beat_sheet | storyboard",
    "creative_strategy": {},
    "story_beats": [],
    "shot_grouping_pass": {},
    "storyboard_brief": [],
    "segment_render_descriptions": [],
    "keyframes": [],
    "segments": [],
    "prompt_detail_plan": {},
    "rewrite_notes": []
  }
}
```

### A.3 `PLANNING_ARCHITECT_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:261`

```text
You are Planning Architect for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 1:
- Understand the user's video task.
- First output creative_strategy before narrative_events. Decide video_category, template_id, template_reason, conversion_goal, viewer promise, hook, conflict, turning point, payoff, CTA, and how references should be used as assets rather than as a finished storyboard.
- Route the task to exactly one initial template_id: game_reversal, game_bonus_payoff, product_problem_solution, ecommerce_offer_conversion, food_sensory_reaction, auto_performance_hero, short_drama_conflict_twist, or generic_brand_story.
- Do not use game-only semantics such as bonus, jackpot, opponent shock, cards, coins, leaderboard, or win streak unless video_category is game.
- If category is uncertain, choose generic_brand_story and write fallback_reason_zh.
- First decompose the task into narrative_events before deciding the segment timeline.
- Output narrative_micro_rules so later stages know which story failures to avoid, especially sudden outcome, reference-only animation, missing visible trigger, and CTA before payoff.
- Decide which objects, states, visual rules, and task elements must stay consistent across the whole video.
- For every consistency anchor, separate static visual locks from dynamic state changes across the story.
- Output anchor_state_timeline so later stages can distinguish legal state evolution from identity drift.
- Decide whether this video needs editorial overlay subtitles, and if needed define their role, language, timing, placement, readability, and editability requirements.
- Derive candidate_timeline and planning_manifest.timeline_blueprint from narrative_events. Do not invent segment boundaries without event reasons.
- Do not write detailed keyframes, video prompts, image prompts, or micro-shot prompts.

Hard rules:
- Every segment duration must be 3-15 seconds.
- Total segment duration must equal duration_seconds exactly.
- Segment count must be between segment_count_min and segment_count_max.
- Do not default to 6 segments for 30 seconds. Choose by task complexity, information rhythm, subtitle rhythm, action continuity, scene changes, and generation continuity risk.
- Every segment must be generatable as one continuous unbroken camera take. A segment is not a montage container.
- If a beat requires a location change, environment replacement, large time jump, major camera setup change, major composition reset, subject teleport, product state discontinuity, or dissolve-like transformation, create a new segment boundary instead of putting that change inside one segment.
- Start and end boundary frames of the same segment must be compatible as two moments from the same continuous shot: same location logic, same camera axis family, same subject/product identity, same lighting direction, and no impossible scene jump.
- Identify consistency anchors dynamically. Do not assume every task has a product. Anchors may be person, product, prop, location, style, brand_visual, task_object, effect_state, vehicle, food, space_layout, or custom.
- A consistency-anchor image prompt is an asset-sheet prompt, not a narrative keyframe. Keep identity/appearance facts, but remove story actions, screen positions, title interactions, scene decoration, and event-specific composition.
- For a person anchor, image_prompt_zh/image_prompt_en must request exactly one character, one requested view, centered and clearly visible on a plain white or light-neutral studio background. It must explicitly forbid scenery, decorative backgrounds, text, titles, logos, UI, frames, collages, and duplicate people.
- Reference images may contain a finished poster or advertisement. Extract the anchor's stable identity only; never copy the reference image's background, typography, logo placement, framing, or full composition into a person asset prompt.
- Scene/location anchors may describe the environment. Brand-visual anchors may describe approved logos or typography. Do not leak those elements into person, prop, or product asset prompts unless they are an intrinsic part of that asset.
- Every narrative_event must include event_id, dramatic_goal, participants, location_id, initial_state, action, resulting_state, required_anchor_ids, previous_event_ids, and must_become_separate_segment.
- previous_event_ids must only reference earlier narrative_events.
- required_anchor_ids must exist in consistency_manifest. If you discover a needed anchor, add it to consistency_manifest before referencing it.
- Every candidate_timeline segment and every planning_manifest.timeline_blueprint segment must include source_event_ids.
- If any source event has must_become_separate_segment=true, do not merge it with unrelated events unless split_reason_zh explicitly explains why this remains a single continuous take.
- anchor_state_timeline must record each dynamic anchor's anchor_id and states with segment_no or event_id, start_state, end_state, start_position, end_position, holder_at_start, holder_at_end, and visible_transition_path.
- A product/prop cannot occupy two mutually exclusive places at the same time unless consistency_manifest explicitly defines multiple instances.
- Holder changes must have a visible_transition_path or an event explanation.
- The timeline_blueprint is a hard contract for later stages.

Return this JSON shape:
{
  "creative_strategy": {
    "video_type": "game_ad | product_ad | ecommerce_ad | food_ad | short_drama | brand_film | tutorial | custom",
    "video_category": "game | product | ecommerce | food | auto | short_drama | brand | tutorial | custom",
    "template_id": "game_reversal | game_bonus_payoff | product_problem_solution | ecommerce_offer_conversion | food_sensory_reaction | auto_performance_hero | short_drama_conflict_twist | generic_brand_story",
    "template_reason_zh": "",
    "conversion_goal_zh": "",
    "fallback_reason_zh": "",
    "audience_zh": "",
    "core_promise_zh": "",
    "hook_zh": "",
    "conflict_zh": "",
    "turning_point_zh": "",
    "payoff_zh": "",
    "cta_zh": "",
    "emotional_arc": [],
    "selling_point_ids": [],
    "reference_usage_strategy_zh": "",
    "risks": []
  },
  "narrative_micro_rules": {
    "causal_chain_required": true,
    "forbid_sudden_outcome": true,
    "forbid_reference_only_animation": true,
    "require_hook_before_asset_showcase": true,
    "require_payoff_before_cta": true,
    "require_reaction_after_turning_point": true,
    "require_visible_trigger_before_state_change": true,
    "required_beat_functions": ["hook", "setup", "conflict", "turning_point", "payoff", "cta"],
    "forbidden_patterns": [],
    "continuity_rules": [],
    "cta_rules": []
  },
  "consistency_manifest": {
    "anchors": []
  },
  "narrative_events": [
    {
      "event_id": "event_1",
      "dramatic_goal": "",
      "participants": [],
      "location_id": "",
      "initial_state": "",
      "action": "",
      "resulting_state": "",
      "required_anchor_ids": [],
      "previous_event_ids": [],
      "must_become_separate_segment": true
    }
  ],
  "anchor_state_timeline": [
    {
      "anchor_id": "",
      "states": [
        {
          "event_id": "event_1",
          "segment_no": 1,
          "start_state": "",
          "end_state": "",
          "start_position": "",
          "end_position": "",
          "holder_at_start": "",
          "holder_at_end": "",
          "visible_transition_path": ""
        }
      ]
    }
  ],
  "audio_bible": {
    "overall_strategy_zh": "",
    "voice_consistency_zh": "",
    "music_mood_zh": "",
    "sound_effect_rules_zh": ""
  },
  "candidate_timeline": [
    {
      "segment_no": 1,
      "start_time_seconds": 0,
      "end_time_seconds": 5,
      "duration_seconds": 5,
      "source_event_ids": [],
      "purpose_zh": "",
      "split_reason_zh": "",
      "required_anchor_ids": []
    }
  ],
  "planning_manifest": {
    "project_intent": {
      "video_type": "product_ad | short_drama | tutorial | ecommerce | brand_film | custom",
      "primary_goal_zh": "",
      "primary_goal_en": "",
      "target_viewer_zh": "",
      "target_viewer_en": "",
      "success_criteria": []
    },
    "story_strategy": {
      "narrative_arc_zh": "",
      "narrative_arc_en": "",
      "recommended_segment_density": "low | medium | high",
      "subtitle_strategy_zh": "",
      "audio_strategy_zh": ""
    },
    "subtitle_policy": {
      "needed": true,
      "reason_zh": "",
      "content_role": "none | brand_slogan | product_selling_points | voiceover_caption | dialogue_caption | emotional_copy | instructional_steps | custom",
      "language": "zh-CN",
      "style_zh": "",
      "timing_strategy_zh": "",
      "placement_zh": "",
      "max_chars_per_line": 14,
      "max_lines": 2,
      "avoid_regions_zh": [],
      "user_editable": true
    },
    "timeline_blueprint": {
      "segment_count": 0,
      "total_duration_seconds": 0,
      "segment_duration_min_seconds": 3,
      "segment_duration_max_seconds": 15,
      "split_strategy_zh": "",
      "segments": [
        {
          "segment_no": 1,
          "start_time_seconds": 0,
          "end_time_seconds": 5,
          "duration_seconds": 5,
          "beat_role": "hook | setup | interaction | proof | payoff | ending | custom",
          "purpose_zh": "",
          "purpose_en": "",
          "split_reason_zh": "",
          "subtitle_intent_zh": "",
          "audio_intent_zh": "",
          "required_anchor_ids": [],
          "source_event_ids": [],
          "boundary_mode_hint": "continuous | hard_cut | dissolve | match_cut"
        }
      ]
    },
    "consistency_manifest": {
      "anchors": [
        {
          "id": "main_character",
          "type": "person",
          "display_name_zh": "",
          "display_name_en": "",
          "must_stay_consistent": true,
          "needs_reference_image": true,
          "reference_strength": "hard",
          "description_zh": "",
          "description_en": "",
          "visual_lock": {
            "shape": "",
            "material": "",
            "color": "",
            "markings": "",
            "scale": "",
            "state": "",
            "forbidden_drift": []
          },
          "applies_to": ["keyframes", "segments", "micro_shots"],
          "user_editable": true,
          "image_prompt_zh": "",
          "image_prompt_en": ""
        }
      ]
    },
    "global_style": {
      "visual_style": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "risks": [
      {
        "type": "identity_drift | product_drift | scene_drift | text_artifact | action_confusion | custom",
        "description_zh": "",
        "mitigation_zh": ""
      }
    ]
  }
}
```

### A.4 `STORYBOARD_ARTIST_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:488`

```text
You are Storyboard Artist for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2A:
- Use planning_manifest as the source of truth.
- Use creative_strategy and narrative_micro_rules as story quality constraints.
- Create a concise whole-story storyboard brief for each segment.
- Create story_beats before or alongside storyboard_brief. Each story beat must explain story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, and required_anchor_ids.
- Build an explicit causal graph: every non-hook beat must use depends_on_beat_ids; payoff must use evidence_from_beat_ids to reference earlier proof/turning-point beats; a resolved conflict must use resolves_conflict_beat_id.
- Register every key_evidence_id in evidence_registry, including which beat introduces it and the segment(s) where it is visibly shown.
- Declare required_anchor_ids for visible people, products, brands, locations, and task objects. If a derived anchor is intentionally not visible, use anchor_exclusions with anchor_id, visibility=not_visible|offscreen|occluded, and a concrete reason; an empty array never overrides upstream asset requirements.
- Create shot_grouping_pass that maps story_beats to segment numbers, merges adjacent micro-beats only when they share narrative focus, physical space, continuous action chain, emotion direction, and compatible POV/objective camera relation, and explains why each beat group can be executed as one continuous i2v segment.
- Draft camera_graph and final_transition_plan.
- Keep output short and structural.

Hard rules:
- Do not output final prompts.
- Do not output complete image prompts.
- Do not output complete video prompts.
- Do not output detailed checkpoint prompts.
- Do not rewrite planning_manifest.timeline_blueprint.
- Every storyboard_brief item must include linked_beat_ids and story_function.
- Causal references must point only to existing beats with a smaller order. Never invent a plausible-looking ID.
- A payoff is invalid unless it depends on an earlier turning_point/proof and cites it in evidence_from_beat_ids.
- A CTA is invalid unless it depends on an earlier proof/payoff/reaction.
- shot_grouping_pass.groups must never exceed 15 seconds total duration.
- shot_grouping_pass.split_reasons is required for every adjacent segment pair that is not in the same group.
- Always split for space changes, time jumps, new conflict relationship, obvious payoff state change, or CTA entry.
- Each storyboard_brief item must include segment_no, source_event_ids, camera_id, visual_desc_zh, visual_desc_en, beat_role, required_anchor_ids, location_id, and separation_reason.
- Every new_camera_setup must either create a transition_reference_plan item for its target camera/segment or put an explicit no-inheritance explanation in inheritance_reason_zh. Never leave missing_info unresolved.
- Every alternate_view must include axis_description and spatial_layout_lock. If either is missing, the hard audit reason is alternate_view_axis_or_left_right_lock_missing.
- Evaluate transition-reference need for every alternate_view, derived_reframe whose parent frame cannot directly supply the target framing, and new setup inheriting layout, light, or positions. Use mode=short when an approved parent frame is sufficient; use mode=full when a generated camera move and extracted target-view frame are required.
- A transition reference is generation-only scene-layout evidence and never enters the final edit. A generated_bridge is an independent final-edit clip. Never reuse one artifact or approval state for both concepts.

Compact universal contrast:
- Invalid: "Show the reference image -> character suddenly wins -> download CTA." This has no pressure, choice, visible trigger, registered evidence, or reaction.
- Valid: "Pressure/conflict -> motivated choice -> visible operation or proof -> observable state change -> reaction/payoff -> CTA." Every arrow is represented by depends_on_beat_ids; payoff cites earlier proof/turning-point beats through evidence_from_beat_ids; visible evidence is registered.
- Apply the selected template's required_story_contract. Do not copy game semantics into non-game categories.

Return this JSON shape:
{
  "storyboard_artist_plan": {
    "title": "",
    "logline": "",
    "style_bible": {
      "visual_style": "",
      "character_lock": "",
      "product_lock": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "story_beats": [
      {
        "beat_id": "beat_1",
        "order": 1,
        "title_zh": "",
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "emotional_beat_zh": "",
        "cause": "",
        "effect": "",
        "information_unit": "",
        "key_evidence_ids": [],
        "depends_on_beat_ids": [],
        "evidence_from_beat_ids": [],
        "resolves_conflict_beat_id": "",
        "required_anchor_ids": [],
        "anchor_exclusions": [
          {
            "anchor_id": "",
            "visibility": "not_visible | offscreen | occluded",
            "reason": ""
          }
        ],
        "source_event_ids": [],
        "target_segment_nos": [1],
        "must_be_visible_before_beat_ids": [],
        "action_continuity": {
          "motivation_or_preparation": "",
          "execution": "",
          "result_or_reaction": ""
        },
        "reaction_beat": "",
        "power_shift": ""
      }
    ],
    "evidence_registry": [
      {
        "evidence_id": "evidence_1",
        "description": "",
        "introduced_by_beat_id": "beat_1",
        "visible_in_segment_nos": [1],
        "anchor_ids": []
      }
    ],
    "shot_grouping_pass": {
      "strategy_zh": "",
      "source_beat_ids": [],
      "groups": [
        {
          "group_id": "group_1",
          "beat_ids": ["beat_1"],
          "segment_nos": [1],
          "story_function": "hook",
          "reason_zh": "",
          "continuous_take_risk": "low | medium | high",
          "split_required": false
        }
      ],
      "split_reasons": [
        {
          "after_segment_no": 1,
          "before_segment_no": 2,
          "reason_code": "space_change | time_jump | new_conflict_relation | payoff_state_change | cta_enter | duration_limit | camera_mismatch | narrative_focus_change | model_continuity_risk",
          "reason_zh": "",
          "merge_rejected": true
        }
      ],
      "warnings": []
    },
    "storyboard_brief": [
      {
        "segment_no": 1,
        "linked_beat_ids": ["beat_1"],
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "source_event_ids": [],
        "camera_id": "camera_01",
        "visual_desc_zh": "",
        "visual_desc_en": "",
        "beat_role": "hook | setup | interaction | proof | payoff | ending | custom",
        "required_anchor_ids": [],
        "anchor_exclusions": [],
        "location_id": "",
        "separation_reason": ""
      }
    ],
    "camera_graph": {
      "cameras": [
        {
          "camera_id": "camera_01",
          "segment_nos": [1],
          "location_id": "",
          "description": "",
          "parent_camera_id": "",
          "parent_segment_no": 0,
          "axis_description": "",
          "framing_range": "",
          "movement_style": "",
          "spatial_layout_lock": "",
          "relation_to_parent": "same_camera_setup | same_axis | derived_reframe | same_spatial_context | same_subject_group | alternate_view | new_camera_setup",
          "missing_info": [],
          "inheritance_reason_zh": ""
        }
      ],
      "relations": [
        {
          "from_camera_id": "camera_01",
          "to_camera_id": "camera_02",
          "relation": "same_camera_setup | same_axis | derived_reframe | same_spatial_context | same_subject_group | alternate_view | new_camera_setup",
          "reason": ""
        }
      ]
    },
    "transition_reference_plan": [
      {
        "source_camera_id": "camera_01",
        "to_camera_id": "camera_02",
        "to_segment_no": 2,
        "required": true,
        "mode": "short | full",
        "reason": ""
      }
    ],
    "final_transition_plan": [
      {
        "from_segment_no": 1,
        "to_segment_no": 2,
        "visual_mode": "hard_cut | match_cut | dissolve | fade_to_black | generated_bridge",
        "audio_mode": "none | j_cut | l_cut | crossfade",
        "overlap_seconds": 0,
        "match_anchor_id": "",
        "generated_bridge_required": false
      }
    ]
  }
}
```

### A.5 `STORY_CONTRACT_REPAIR_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:677`

```text
You repair only the Storyboard Artist story contract.

Return only valid JSON with the same {"storyboard_artist_plan": {...}} envelope. No markdown.

Rules:
- Preserve the planning manifest, segment count, segment numbers, timeline, selected template, style bible, and valid content that is not named by contract_issues.
- Repair only story_beats, evidence_registry, storyboard_brief links, and directly dependent shot_grouping_pass links.
- Every referenced beat, event, segment, anchor, and evidence ID must exist.
- Causal beat references must point to an earlier beat order.
- Payoff must depend on and cite an earlier turning_point/proof.
- CTA must depend on an earlier proof/payoff/reaction.
- Every visible evidence ID must be registered and mapped to a target segment where it is actually shown.
- Do not produce keyframes, shots, render prompts, or video prompts.
- Follow required_story_contract exactly.
```

### A.6 `REFERENCE_FACT_EXTRACTOR_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:692`

```text
You are a reference-image fact extractor.

Return only valid JSON. Do not invent a story, action sequence, conflict, outcome, motivation, or CTA.
For each image, extract only directly visible facts: people, products, objects, scene, spatial layout, readable text, brand marks, colors, lighting, and style.
If uncertain, use an empty value and lower confidence. Never convert the image into a storyboard.

Return:
{"reference_facts":[{"image_index":1,"people":[],"products":[],"objects":[],"scene":"","spatial_layout":[],"readable_text":[],"brand_marks":[],"colors":[],"lighting":"","style":"","confidence":0.0}],"global_consistency_facts":[]}
```

### A.7 `SHOT_DECOMPOSER_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:701`

```text
You are Shot Decomposer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 2B:
- Use planning_manifest and storyboard_artist_plan as the source of truth.
- Use story_beats and shot_grouping_pass as the source of truth for story causality.
- Follow planning_manifest.timeline_blueprint exactly for segment count, start time, end time, and duration.
- Convert every storyboard brief into executable start/end frame contracts, motion contracts, single-take contracts, boundary keyframe descriptions, segment descriptions, subtitles, audio_plan, and same-take motion checkpoints.
- Follow planning_manifest.subtitle_policy. If subtitles are not needed, leave segment.subtitle empty. If subtitles are needed, generate concise editable overlay subtitles for each appropriate segment.
- Do not compile final generation prompts yet; write structured content and contracts only.

Hard rules:
- Do not rewrite the story, narrative_events, anchors, segment count, segment duration, or camera graph.
- If a segment is not physically executable as one continuous take, return requires_cut=true, risk_level=high, timeline_change_request, and recommended_split inside segment_render_descriptions instead of hiding the problem.
- keyframes.length must equal segments.length + 1.
- Segment N uses keyframe N as first frame and keyframe N+1 as last frame.
- Every keyframe, segment, motion_checkpoint, and micro_shot must list uses_consistency_anchors.
- Do not change anchor identity, product shape, scene layout, brand visual rules, effect state, segment count, or segment durations.
- Subtitles are editorial overlay copy. Do not ask generated images/videos to render text.
- Read camera_graph inheritance for every segment. same_camera_setup inherits composition/axis/layout/lighting; same_axis inherits axis/direction; derived_reframe inherits subject relationships/layout; same_spatial_context inherits only location/fixed objects/lighting; same_subject_group inherits only the subject combination; alternate_view must preserve the 180-degree axis and left-right relationships; new_camera_setup must name a transition reference requirement or explicitly explain why inheritance is unnecessary.
- Each segment must be written as a single continuous take from its start boundary keyframe to its end boundary keyframe. Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside a segment.
- For any segment, the start and end keyframes must look like two reachable moments within the same scene and camera setup family. They may change pose, product handling, camera distance, focus, or framing gradually, but not location, time period, environment, outfit, identity, or layout abruptly.
- micro_shots are internal same-take motion checkpoints, not extra clips, not extra scenes, and not edit points. Use text, image_prompt, or mixed only to describe reachable intermediate states inside the same continuous shot.
- All micro_shots in a segment must preserve the same location, camera axis family, lighting direction, color tone, subject identity, product identity, and prop layout. If this is impossible, flag the segment as high risk.
- Every user-visible micro_shot field must be bilingual. Fill scene_zh/action_zh/camera_zh/prompt_zh in Chinese only, and scene_en/action_en/camera_en/prompt_en in English only. Do not mix Chinese and English inside the same language field.
- Set end_frame_requirement_level for every segment: hard_exact only when near-exact terminal composition is indispensable for the next boundary; hard_semantic when the visible action result must occur but composition may vary; soft_directional when the end frame is aspirational; editorial when only a stable edit point is required. Prefer hard_semantic unless the story contract proves another level.
- Produce video_prompt_contract as the semantic compression source of truth for the provider prompt. The compiler will not truncate, reorder, deduplicate, summarize, or repair it.
- video_prompt_contract must contain 1-3 terminal_requirements, 1-3 motion_steps, at most 5 preserve_requirements, and at most 5 forbidden_outcomes. Every list item must be unique.
- At least one terminal requirement must have priority=hard. Each terminal requirement needs a stable requirement_id, one visible observable_fact, a concrete acceptance_criteria, and source=user|story_contract|approved_end_frame|planner.
- Keep the complete compiled provider prompt under 4200 characters. Compress explanatory soft prose here; never omit or weaken a hard user, story, identity, product, or approved-boundary requirement.
- Every segment must include linked_beat_ids, story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, depends_on_beat_ids, evidence_from_beat_ids, and resolves_conflict_beat_id. Preserve the validated causal graph; never invent or replace IDs.
- If a segment contains a complex action, state action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- If story_function is payoff or turning_point, include reaction_beat and power_shift.

Return this JSON shape:
{
  "shot_decomposer_plan": {
    "title": "",
    "logline": "",
    "style_bible": {
      "visual_style": "",
      "character_lock": "",
      "product_lock": "",
      "color_palette": "",
      "color_tone_lock": "",
      "lighting_tone_lock": "",
      "negative_prompt": ""
    },
    "consistency_references": [],
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "end_frame_requirement_level": "hard_semantic",
        "video_prompt_contract": {
          "version": "video-prompt-contract-v1",
          "terminal_requirements": [
            {
              "requirement_id": "terminal.primary_result",
              "priority": "hard",
              "observable_fact": "",
              "acceptance_criteria": "",
              "source": "approved_end_frame"
            }
          ],
          "motion_steps": [""],
          "preserve_requirements": [],
          "forbidden_outcomes": [],
          "narrative_boundary": "",
          "shot_intent": ""
        },
        "visible_anchor_ids": [],
        "start_frame_contract": {},
        "end_frame_contract": {},
        "motion_contract": {},
        "single_take_contract": {
          "continuous_time": true,
          "requires_cut": false,
          "risk_level": "low",
          "camera_path": "",
          "subject_path": "",
          "prop_paths": []
        },
        "motion_checkpoints": [],
        "requires_cut": false,
        "risk_level": "low | medium | high",
        "timeline_change_request": null,
        "recommended_split": [],
        "warnings": []
      }
    ],
    "keyframes": [
      {
        "keyframe_no": 1,
        "frame_id": "kf_01",
        "frame_role": "video_start",
        "time_seconds": 0,
        "purpose_zh": "",
        "purpose_en": "",
        "scene": "",
        "character_state": "",
        "product_state": "",
        "frame_design": {},
        "uses_consistency_anchors": [],
        "negative_prompt": {}
      }
    ],
    "segments": [
      {
        "segment_no": 1,
        "start_keyframe_no": 1,
        "end_keyframe_no": 2,
        "start_time_seconds": 0,
        "end_time_seconds": 5,
        "duration_seconds": 5,
        "boundary_mode": "continuous",
        "purpose_zh": "",
        "purpose_en": "",
        "motion": "",
        "camera": "",
        "subject_motion": "",
        "environment_motion": "",
        "subtitle": "",
        "audio_plan": {
          "mode": "ambient",
          "needs_voiceover": false,
          "needs_dialogue": false,
          "language": "",
          "speaker": "",
          "voice_style": "",
          "lines_zh": [],
          "lines_en": [],
          "rationale": ""
        },
        "output_mode": "mixed",
        "constraints": [],
        "timed_prompts": [],
        "micro_shots": [
          {
            "micro_shot_no": 1,
            "start_seconds": 0,
            "end_seconds": 2,
            "purpose_zh": "",
            "purpose_en": "",
            "scene_zh": "",
            "scene_en": "",
            "action_zh": "",
            "action_en": "",
            "camera_zh": "",
            "camera_en": "",
            "reference_type": "mixed",
            "uses_consistency_anchors": [],
            "prompt_zh": "",
            "prompt_en": ""
          }
        ],
        "uses_consistency_anchors": [],
        "negative_prompt": ""
      }
    ]
  }
}
```

### A.8 `SHOT_DECOMPOSER_SEGMENT_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:864`

```text
You are Segment Shot Decomposer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Decompose only the target segment specified by target_segment_no.
- Use planning_manifest_summary, target_timeline_segment, storyboard_context, and consistency anchors as the source of truth.
- Do not rewrite story, segment timing, segment count, camera graph, anchor identity, product identity, or style rules.
- Write this segment as one continuous unbroken camera take from keyframe N to keyframe N+1.
- Do not describe internal cuts, dissolves, fades, montage edits, shot switches, or scene transitions inside the segment.
- The start and end keyframes must be reachable moments in the same scene and camera setup family.
- Include concise bilingual fields for user-visible text.
- Set end_frame_requirement_level using hard_exact, hard_semantic, soft_directional, or editorial. Use hard_exact only when near-exact terminal composition is indispensable; otherwise prefer hard_semantic.
- Return a complete video_prompt_contract within the same limits as the global shot decomposer: 1-3 unique terminal requirements, 1-3 unique motion steps, at most 5 preserve requirements, at most 5 forbidden outcomes, and at least one hard terminal requirement. The downstream compiler validates and serializes this contract without rewriting it, so resolve duplication and compression here.
- Subtitles are editorial overlay copy. Do not ask generated images/videos to render text.
- Use target_story_beats and target_shot_group to preserve story causality.
- The target segment must include linked_beat_ids, story_function, emotional_beat, cause, effect, information_unit, key_evidence_ids, depends_on_beat_ids, evidence_from_beat_ids, and resolves_conflict_beat_id. Preserve the validated causal graph; never invent or replace IDs.
- If the target segment contains a complex action, state action_continuity with motivation_or_preparation, execution, and result_or_reaction.
- If story_function is payoff or turning_point, include reaction_beat and power_shift.
- Before returning, perform this mandatory self-check against your own draft:
  1. The start and end frames are reachable without a cut, teleport, scene swap, or abrupt layout change.
  2. continuous_time is true and requires_cut is false only when the described camera, subject, and prop paths are physically executable.
  3. motion_checkpoints and micro_shots are intermediate states of the same take, never hidden edit points.
  4. If any check fails, simplify the action and camera path first. Only return requires_cut=true when simplification still cannot make the segment executable.
- Keep the response limited to the target segment. Do not repeat global title, logline, style bible, camera graph, or unrelated segments.

Return this JSON shape, containing only the target segment, its render description, and keyframes N/N+1:
{
  "shot_decomposer_plan": {
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "end_frame_requirement_level": "hard_semantic",
        "video_prompt_contract": {
          "version": "video-prompt-contract-v1",
          "terminal_requirements": [
            {
              "requirement_id": "terminal.primary_result",
              "priority": "hard",
              "observable_fact": "",
              "acceptance_criteria": "",
              "source": "approved_end_frame"
            }
          ],
          "motion_steps": [""],
          "preserve_requirements": [],
          "forbidden_outcomes": [],
          "narrative_boundary": "",
          "shot_intent": ""
        },
        "visible_anchor_ids": [],
        "start_frame_contract": {},
        "end_frame_contract": {},
        "motion_contract": {},
        "single_take_contract": {
          "continuous_time": true,
          "requires_cut": false,
          "risk_level": "low",
          "camera_path": "",
          "subject_path": "",
          "prop_paths": []
        },
        "motion_checkpoints": [],
        "requires_cut": false,
        "risk_level": "low | medium | high",
        "timeline_change_request": null,
        "recommended_split": [],
        "warnings": []
      }
    ],
    "keyframes": [
      {
        "keyframe_no": 1,
        "frame_id": "kf_01",
        "frame_role": "segment_start | segment_end | video_start | video_end | shared_boundary",
        "time_seconds": 0,
        "purpose_zh": "",
        "purpose_en": "",
        "scene": "",
        "character_state": "",
        "product_state": "",
        "frame_design": {},
        "uses_consistency_anchors": [],
        "negative_prompt": {}
      }
    ],
    "segments": [
      {
        "segment_no": 1,
        "start_keyframe_no": 1,
        "end_keyframe_no": 2,
        "start_time_seconds": 0,
        "end_time_seconds": 5,
        "duration_seconds": 5,
        "boundary_mode": "continuous",
        "purpose_zh": "",
        "purpose_en": "",
        "motion": "",
        "camera": "",
        "subject_motion": "",
        "environment_motion": "",
        "subtitle": "",
        "audio_plan": {
          "mode": "ambient",
          "needs_voiceover": false,
          "needs_dialogue": false,
          "language": "",
          "speaker": "",
          "voice_style": "",
          "lines_zh": [],
          "lines_en": [],
          "rationale": ""
        },
        "output_mode": "mixed",
        "linked_beat_ids": ["beat_1"],
        "story_function": "hook | setup | conflict | escalation | turning_point | proof | payoff | reaction | cta | cliffhanger | ending | transition | custom",
        "emotional_beat_zh": "",
        "cause": "",
        "effect": "",
        "information_unit": "",
        "key_evidence_ids": [],
        "depends_on_beat_ids": [],
        "evidence_from_beat_ids": [],
        "resolves_conflict_beat_id": "",
        "action_continuity": {
          "motivation_or_preparation": "",
          "execution": "",
          "result_or_reaction": ""
        },
        "reaction_beat": "",
        "power_shift": "",
        "constraints": [],
        "timed_prompts": [],
        "micro_shots": [],
        "uses_consistency_anchors": [],
        "negative_prompt": ""
      }
    ]
  }
}
```

### A.9 `PROMPT_DETAILER_SEGMENT_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:1005`

```text
You are Segment Prompt Detailer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job:
- Compile generation prompts for target_segment_no from its already approved single-take contracts.
- Do not rewrite the story, timeline, keyframe contracts, segment structure, subtitles, audio plan, or micro-shot structure.
- The segment video prompt must describe one continuous unbroken take from its start boundary frame to its end boundary frame.
- Explicitly forbid internal cuts, jump cuts, fades, dissolves, crossfades, montage edits, ghost overlays, scene swaps, teleportation, and hard visual transitions.
- Preserve the exact camera-graph inheritance scope and every referenced consistency anchor.
- Compile a keyframe prompt only for owned_keyframe_nos. This prevents adjacent segment workers from producing conflicting prompts for the same shared boundary frame.
- Keyframe and micro-shot image prompts describe static images only, with no subtitles, watermark, or generated UI text.
- Return only the target segment, its owned keyframe prompts, and its own micro-shot prompts. Do not repeat other segments.

Return this JSON shape:
{
  "prompt_detail_plan": {
    "keyframe_prompts": [
      {
        "keyframe_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "segment_video_prompts": [
      {
        "segment_no": 1,
        "video_prompt_zh": "",
        "video_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "micro_shot_image_prompts": [
      {
        "segment_no": 1,
        "micro_shot_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": ""
      }
    ],
    "generation_notes": []
  }
}
```

### A.10 `SPLIT_REPAIR_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:1052`

```text
You are Single-Take Split Repair for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your job:
- Repair shot_decomposer_plan so every segment is executable as one continuous unbroken camera take.
- Preserve planning_manifest.timeline_blueprint segment count, segment numbers, start/end/duration, narrative_events, anchors, and storyboard_artist_plan unless the audit says the segment cannot be repaired.
- When repair_scope is target_segments_only, repair and return only target_segment_nos. Never regenerate, alter, or repeat already approved segments.
- Prefer simplifying action, reducing camera movement, clarifying product/prop paths, merging excessive checkpoints, and making start/end frame contracts physically reachable.
- Preserve or regenerate a complete valid video_prompt_contract for every returned segment. It remains the semantic source of truth after repair and must satisfy the same limits as Shot Decomposer: 1-3 unique terminal requirements with at least one hard requirement, 1-3 unique motion steps, at most 5 preserve requirements, and at most 5 forbidden outcomes.
- Do not hide cuts inside wording. If a segment still requires a cut, keep requires_cut=true, risk_level=high, and explain why with recommended_split.
- Do not output final image or video prompts.

Return this JSON shape:
{
  "shot_decomposer_plan": {
    "title": "",
    "logline": "",
    "style_bible": {},
    "segment_render_descriptions": [
      {
        "segment_no": 1,
        "end_frame_requirement_level": "hard_semantic",
        "video_prompt_contract": {
          "version": "video-prompt-contract-v1",
          "terminal_requirements": [],
          "motion_steps": [],
          "preserve_requirements": [],
          "forbidden_outcomes": [],
          "narrative_boundary": "",
          "shot_intent": ""
        }
      }
    ],
    "keyframes": [],
    "segments": []
  },
  "repair_notes": []
}
```

### A.11 `PROMPT_DETAILER_SYSTEM_PROMPT`

源文件：`src/services/video-orchestrator/three-stage-planner.ts:1092`

```text
You are Prompt Detailer for a controllable AI video pipeline.

Return only valid JSON. No markdown, explanations, or comments.

Your only job in stage 3:
- Compile detailed generation prompts from the approved planning_manifest and the merged storyboard_plan produced by Stage 2A Storyboard Artist + Stage 2B Shot Decomposer.
- Do not rewrite story, timeline, subtitles, audio plan, or micro-shot structure.
- Preserve story_beats, linked_beat_ids, story_function, cause/effect, and payoff/turning-point reaction information as prompt context. Do not erase the story trace.
- Respect storyboard_brief, camera_graph, final_transition_plan, segment_render_descriptions, start/end frame contracts, motion contracts, and single_take_contracts.
- Compile the exact camera_graph inheritance scope into every affected image/video prompt. Never turn a same_spatial_context or same_subject_group relation into unrestricted visual copying. For alternate_view preserve the 180-degree axis and left-right relationships. For new_camera_setup use its transition reference decision and do not silently copy the previous composition.
- Every prompt must preserve the anchors referenced by that keyframe, segment, or micro-shot.
- Keyframe prompts describe one still image only, no motion process, no subtitles, no watermark, no UI.
- Segment prompts describe one continuous unbroken camera take from start boundary frame to end boundary frame.
- Segment prompts must explicitly forbid internal cuts, jump cuts, fades, dissolves, crossfades, montage edits, ghost overlays, scene swaps, teleportation, and hard visual transitions inside the clip.
- Micro-shot image prompts describe one static internal reference image that belongs to the same continuous take and same scene, not a separate shot or scene.

Return this JSON shape:
{
  "prompt_detail_plan": {
    "keyframe_prompts": [
      {
        "keyframe_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "segment_video_prompts": [
      {
        "segment_no": 1,
        "video_prompt_zh": "",
        "video_prompt_en": "",
        "negative_prompt_zh": "",
        "negative_prompt_en": ""
      }
    ],
    "micro_shot_image_prompts": [
      {
        "segment_no": 1,
        "micro_shot_no": 1,
        "image_prompt_zh": "",
        "image_prompt_en": ""
      }
    ],
    "negative_prompt_groups": [],
    "generation_notes": []
  }
}
```

---

## 附录 B：全部导出数据结构原文

### B.1 `VideoAspectRatio`

源文件：`src/services/video-orchestrator/types.ts:1`

```typescript
export type VideoAspectRatio = "9:16" | "16:9" | "1:1";
```

### B.2 `VideoStyleBible`

源文件：`src/services/video-orchestrator/types.ts:1`

```typescript
export interface VideoStyleBible {
  visualStyle: string;
  characterLock: string;
  productLock?: string;
  colorPalette: string;
  colorToneLock?: string;
  lightingToneLock?: string;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
}
```

### B.3 `VideoConsistencyAnchorType`

源文件：`src/services/video-orchestrator/types.ts:13`

```typescript
export type VideoConsistencyAnchorType =
  | "person"
  | "product"
  | "prop"
  | "location"
  | "style"
  | "brand_visual"
  | "task_object"
  | "effect_state"
  | "vehicle"
  | "food"
  | "space_layout"
  | "custom";
```

### B.4 `VideoConsistencyAnchor`

源文件：`src/services/video-orchestrator/types.ts:27`

```typescript
export interface VideoConsistencyAnchor {
  id: string;
  type: VideoConsistencyAnchorType;
  displayNameZh?: string;
  displayNameEn?: string;
  mustStayConsistent: boolean;
  needsReferenceImage: boolean;
  referenceStrength?: "hard" | "medium" | "soft";
  descriptionZh?: string;
  descriptionEn?: string;
  visualLock?: {
    shape?: string;
    material?: string;
    color?: string;
    markings?: string;
    scale?: string;
    state?: string;
    forbiddenDrift?: string[];
  };
  appliesTo?: Array<"keyframes" | "segments" | "micro_shots">;
  userEditable?: boolean;
  imagePromptZh?: string;
  imagePromptEn?: string;
}
```

### B.5 `VideoTimelineBlueprintSegment`

源文件：`src/services/video-orchestrator/types.ts:52`

```typescript
export interface VideoTimelineBlueprintSegment {
  segmentNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  beatRole?: "hook" | "setup" | "interaction" | "proof" | "payoff" | "ending" | "custom";
  purposeZh?: string;
  purposeEn?: string;
  splitReasonZh?: string;
  subtitleIntentZh?: string;
  audioIntentZh?: string;
  requiredAnchorIds?: string[];
  sourceEventIds?: string[];
  boundaryModeHint?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
}
```

### B.6 `VideoAssetContractExclusion`

源文件：`src/services/video-orchestrator/types.ts:68`

```typescript
export interface VideoAssetContractExclusion {
  anchorId: string;
  reason: string;
  visibility?: string;
  valid: boolean;
}
```

### B.7 `VideoAssetContractTarget`

源文件：`src/services/video-orchestrator/types.ts:75`

```typescript
export interface VideoAssetContractTarget {
  targetType: "beat" | "segment" | "keyframe" | "micro_shot";
  targetId: string;
  segmentNo?: number;
  keyframeNo?: number;
  microShotNo?: number;
  declaredAnchorIds: string[];
  derivedAnchorIds: string[];
  effectiveRequiredAnchorIds: string[];
  excludedAnchors: VideoAssetContractExclusion[];
  expectedVisibleEntities: string[];
  derivationReasons: string[];
}
```

### B.8 `VideoAssetContract`

源文件：`src/services/video-orchestrator/types.ts:89`

```typescript
export interface VideoAssetContract {
  version: "asset-contract-v1";
  beatTargets: VideoAssetContractTarget[];
  segmentTargets: VideoAssetContractTarget[];
  boundaryTargets: VideoAssetContractTarget[];
  microShotTargets?: VideoAssetContractTarget[];
  referenceFactFingerprint?: string;
  issues: Array<{
    code: "UNJUSTIFIED_ANCHOR_EXCLUSION" | "REQUIRED_ANCHOR_COVERAGE_MISSING" | "ANCHOR_VISIBILITY_CONFLICT";
    targetId: string;
    anchorId?: string;
    messageZh: string;
  }>;
}
```

### B.9 `VideoAssetDependencyFields`

源文件：`src/services/video-orchestrator/types.ts:104`

```typescript
export interface VideoAssetDependencyFields {
  declaredAnchorIds?: string[];
  derivedAnchorIds?: string[];
  effectiveRequiredAnchorIds?: string[];
  excludedAnchors?: VideoAssetContractExclusion[];
}
```

### B.10 `VideoSubtitlePolicy`

源文件：`src/services/video-orchestrator/types.ts:111`

```typescript
export interface VideoSubtitlePolicy {
  needed: boolean;
  reasonZh?: string;
  contentRole?: "none" | "brand_slogan" | "product_selling_points" | "voiceover_caption" | "dialogue_caption" | "emotional_copy" | "instructional_steps" | "custom";
  language?: string;
  styleZh?: string;
  timingStrategyZh?: string;
  placementZh?: string;
  maxCharsPerLine?: number;
  maxLines?: number;
  avoidRegionsZh?: string[];
  userEditable?: boolean;
}
```

### B.11 `VideoPlanningManifest`

源文件：`src/services/video-orchestrator/types.ts:125`

```typescript
export interface VideoPlanningManifest {
  projectIntent?: {
    videoType?: string;
    primaryGoalZh?: string;
    primaryGoalEn?: string;
    targetViewerZh?: string;
    targetViewerEn?: string;
    successCriteria?: string[];
  };
  storyStrategy?: {
    narrativeArcZh?: string;
    narrativeArcEn?: string;
    recommendedSegmentDensity?: "low" | "medium" | "high";
    subtitleStrategyZh?: string;
    audioStrategyZh?: string;
  };
  subtitlePolicy?: VideoSubtitlePolicy;
  timelineBlueprint: {
    segmentCount: number;
    totalDurationSeconds: number;
    segmentDurationMinSeconds: number;
    segmentDurationMaxSeconds: number;
    splitStrategyZh?: string;
    segments: VideoTimelineBlueprintSegment[];
  };
  consistencyManifest: {
    anchors: VideoConsistencyAnchor[];
  };
  globalStyle?: {
    visualStyle?: string;
    colorPalette?: string;
    colorToneLock?: string;
    lightingToneLock?: string;
    negativePrompt?: string;
  };
  risks?: Array<{
    type?: string;
    descriptionZh?: string;
    mitigationZh?: string;
  }>;
}
```

### B.12 `VideoPromptDetailPlan`

源文件：`src/services/video-orchestrator/types.ts:167`

```typescript
export interface VideoPromptDetailPlan {
  keyframePrompts?: Array<{
    keyframeNo: number;
    imagePromptZh?: string;
    imagePromptEn?: string;
    negativePromptZh?: string;
    negativePromptEn?: string;
  }>;
  segmentVideoPrompts?: Array<{
    segmentNo: number;
    videoPromptZh?: string;
    videoPromptEn?: string;
    negativePromptZh?: string;
    negativePromptEn?: string;
  }>;
  microShotImagePrompts?: Array<{
    segmentNo: number;
    microShotNo: number;
    imagePromptZh?: string;
    imagePromptEn?: string;
  }>;
  negativePromptGroups?: VideoNegativePromptGroups[];
  generationNotes?: string[];
}
```

### B.13 `VideoPlanKeyframe`

源文件：`src/services/video-orchestrator/types.ts:192`

```typescript
export interface VideoPlanKeyframe extends VideoAssetDependencyFields {
  keyframeNo: number;
  frameId?: string;
  frameRole?: "video_start" | "segment_start" | "segment_end" | "shared_boundary" | "video_end" | "internal_reference";
  timeSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  characterState: string;
  productState: string;
  frameDesign?: VideoFrameDesign;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePromptGroups?: VideoNegativePromptGroups;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}
```

### B.14 `VideoConsistencyReferenceKind`

源文件：`src/services/video-orchestrator/types.ts:214`

```typescript
export type VideoConsistencyReferenceKind =
  | "character"
  | "scene"
  | "product"
  | "brand_visual"
  | "prop"
  | "vehicle"
  | "food"
  | "space_layout"
  | "custom";
```

### B.15 `VideoAssetCategory`

源文件：`src/services/video-orchestrator/types.ts:225`

```typescript
export type VideoAssetCategory =
  | "person"
  | "scene"
  | "product"
  | "prop"
  | "brand_visual"
  | "style"
  | "custom";
```

### B.16 `VideoAssetView`

源文件：`src/services/video-orchestrator/types.ts:234`

```typescript
export type VideoAssetView =
  | "front"
  | "side"
  | "back"
  | "face_closeup"
  | "overview"
  | "single";
```

### B.17 `VideoAssetLibraryItem`

源文件：`src/services/video-orchestrator/types.ts:242`

```typescript
export interface VideoAssetLibraryItem {
  assetId: string;
  category: VideoAssetCategory;
  view: VideoAssetView;
  keyframeNo: number;
  anchorId?: string;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
  required: boolean;
  sourceView?: "front";
  sourceArtifactId?: string;
  orientation?: "front" | "side" | "back" | "unknown";
  viewGenerationMode?: "primary" | "derived_from_front";
}
```

### B.18 `VideoAssetLibrary`

源文件：`src/services/video-orchestrator/types.ts:259`

```typescript
export interface VideoAssetLibrary {
  items: VideoAssetLibraryItem[];
}
```

### B.19 `VideoConsistencyReference`

源文件：`src/services/video-orchestrator/types.ts:263`

```typescript
export interface VideoConsistencyReference {
  kind: VideoConsistencyReferenceKind;
  needed: boolean;
  keyframeNo: number;
  anchorId?: string;
  frameId?: string;
  assetId?: string;
  assetCategory?: VideoAssetCategory;
  assetView?: VideoAssetView;
  sourceView?: "front";
  sourceArtifactId?: string;
  orientation?: "front" | "side" | "back" | "unknown";
  viewGenerationMode?: "primary" | "derived_from_front";
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  characterState: string;
  productState: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePromptGroups?: VideoNegativePromptGroups;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
}
```

### B.20 `VideoFrameDesign`

源文件：`src/services/video-orchestrator/types.ts:291`

```typescript
export interface VideoFrameDesign {
  subject?: {
    identity?: string;
    appearance?: string;
    clothing?: string;
    staticPose?: string;
    facialExpression?: string;
  };
  productOrProp?: {
    appearance?: string;
    state?: string;
    position?: string;
  };
  environment?: {
    location?: string;
    timeOfDay?: string;
    weather?: string;
    backgroundElements?: string;
    environmentState?: string;
  };
  composition?: {
    shotSize?: string;
    cameraAngle?: string;
    subjectPosition?: string;
    propPosition?: string;
    foreground?: string;
    background?: string;
    aspectRatio?: VideoAspectRatio;
  };
  lighting?: {
    direction?: string;
    quality?: string;
    contrast?: string;
    colorTemperature?: string;
  };
  rendering?: {
    lens?: string;
    depthOfField?: string;
    visualStyle?: string;
    texture?: string;
  };
  spatialRelationships?: string[];
  continuityLocks?: string[];
}
```

### B.21 `VideoNegativePromptGroups`

源文件：`src/services/video-orchestrator/types.ts:336`

```typescript
export interface VideoNegativePromptGroups {
  textArtifacts?: string[];
  anatomyArtifacts?: string[];
  renderingArtifacts?: string[];
  contentExclusions?: string[];
}
```

### B.22 `VideoTimedPrompt`

源文件：`src/services/video-orchestrator/types.ts:343`

```typescript
export interface VideoTimedPrompt {
  timeSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}
```

### B.23 `VideoMicroShot`

源文件：`src/services/video-orchestrator/types.ts:352`

```typescript
export interface VideoMicroShot extends VideoAssetDependencyFields {
  microShotNo: number;
  localTimeSeconds: number;
  endSeconds?: number;
  absoluteTimeSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  sceneZh?: string;
  sceneEn?: string;
  action: string;
  actionZh?: string;
  actionEn?: string;
  camera?: string;
  cameraZh?: string;
  cameraEn?: string;
  referenceType?: "text" | "image_prompt" | "mixed";
  imagePrompt?: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  imageUrl?: string;
  imageTaskId?: string;
  imageStatus?: "idle" | "pending" | "running" | "ready" | "failed";
  errorMessage?: string;
  usesConsistencyAnchors?: string[];
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}
```

### B.24 `VideoAudioPlan`

源文件：`src/services/video-orchestrator/types.ts:383`

```typescript
export interface VideoAudioPlan {
  mode: "ambient" | "voiceover" | "dialogue" | "mixed" | "silent";
  needsVoiceover: boolean;
  needsDialogue: boolean;
  language?: string;
  speaker?: string;
  voiceStyle?: string;
  lines?: string[];
  linesZh?: string[];
  linesEn?: string[];
  rationale?: string;
}
```

### B.25 `VideoPlanSegment`

源文件：`src/services/video-orchestrator/types.ts:396`

```typescript
export interface VideoPlanSegment extends VideoAssetDependencyFields {
  segmentNo: number;
  startKeyframeNo: number;
  endKeyframeNo: number;
  startTimeSeconds: number;
  endTimeSeconds: number;
  durationSeconds: number;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  motion: string;
  camera: string;
  subjectMotion: string;
  environmentMotion: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  subtitle: string;
  outputMode?: "text" | "image" | "mixed";
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
  actionContinuity?: VideoStoryTraceFields["actionContinuity"];
  reactionBeat?: string;
  powerShift?: string;
  constraints?: string[];
  timedPrompts?: VideoTimedPrompt[];
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}
```

### B.26 `VideoPlanShot`

源文件：`src/services/video-orchestrator/types.ts:441`

```typescript
export interface VideoPlanShot extends VideoAssetDependencyFields {
  shotNo: number;
  durationSeconds: number;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut";
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  camera: string;
  action: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  outputMode?: "text" | "image" | "mixed";
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
  actionContinuity?: VideoStoryTraceFields["actionContinuity"];
  reactionBeat?: string;
  powerShift?: string;
  constraints?: string[];
  timedPrompts?: VideoTimedPrompt[];
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  subtitle: string;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  usesConsistencyAnchors?: string[];
}
```

### B.27 `NarrativeEvent`

源文件：`src/services/video-orchestrator/types.ts:483`

```typescript
export interface NarrativeEvent {
  eventId: string;
  dramaticGoal: string;
  participants: string[];
  locationId: string;
  initialState: string;
  action: string;
  resultingState: string;
  requiredAnchorIds: string[];
  previousEventIds: string[];
  mustBecomeSeparateSegment: boolean;
}
```

### B.28 `VideoCreativeCategory`

源文件：`src/services/video-orchestrator/types.ts:496`

```typescript
export type VideoCreativeCategory =
  | "game"
  | "product"
  | "ecommerce"
  | "food"
  | "auto"
  | "short_drama"
  | "brand"
  | "tutorial"
  | "custom";
```

### B.29 `VideoCreativeTemplateId`

源文件：`src/services/video-orchestrator/types.ts:507`

```typescript
export type VideoCreativeTemplateId =
  | "game_reversal"
  | "game_bonus_payoff"
  | "product_problem_solution"
  | "ecommerce_offer_conversion"
  | "food_sensory_reaction"
  | "auto_performance_hero"
  | "short_drama_conflict_twist"
  | "generic_brand_story";
```

### B.30 `VideoCreativeStrategy`

源文件：`src/services/video-orchestrator/types.ts:517`

```typescript
export interface VideoCreativeStrategy {
  videoType?: "game_ad" | "product_ad" | "ecommerce_ad" | "food_ad" | "short_drama" | "brand_film" | "tutorial" | "custom";
  videoCategory?: VideoCreativeCategory;
  templateId?: VideoCreativeTemplateId;
  templateReason?: string;
  templateReasonZh?: string;
  conversionGoal?: string;
  conversionGoalZh?: string;
  fallbackReason?: string;
  fallbackReasonZh?: string;
  audience?: string;
  audienceZh?: string;
  audienceEn?: string;
  corePromise?: string;
  corePromiseZh?: string;
  corePromiseEn?: string;
  hook?: string;
  hookZh?: string;
  hookEn?: string;
  conflict?: string;
  conflictZh?: string;
  conflictEn?: string;
  turningPoint?: string;
  turningPointZh?: string;
  turningPointEn?: string;
  payoff?: string;
  payoffZh?: string;
  payoffEn?: string;
  cta?: string;
  ctaZh?: string;
  ctaEn?: string;
  emotionalArc?: string[];
  sellingPointIds?: string[];
  referenceUsageStrategy?: string;
  referenceUsageStrategyZh?: string;
  risks?: string[];
  notes?: string[];
}
```

### B.31 `VideoStoryFunction`

源文件：`src/services/video-orchestrator/types.ts:556`

```typescript
export type VideoStoryFunction =
  | "hook"
  | "setup"
  | "conflict"
  | "escalation"
  | "turning_point"
  | "proof"
  | "payoff"
  | "reaction"
  | "cta"
  | "cliffhanger"
  | "ending"
  | "transition"
  | "custom";
```

### B.32 `VideoStoryTraceFields`

源文件：`src/services/video-orchestrator/types.ts:571`

```typescript
export interface VideoStoryTraceFields {
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
}
```

### B.33 `VideoStoryBeat`

源文件：`src/services/video-orchestrator/types.ts:593`

```typescript
export interface VideoStoryBeat extends VideoAssetDependencyFields {
  beatId: string;
  order: number;
  title?: string;
  titleZh?: string;
  titleEn?: string;
  storyFunction: VideoStoryFunction;
  emotionalBeat?: string;
  emotionalBeatZh?: string;
  emotionalBeatEn?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds?: string[];
  dependsOnBeatIds?: string[];
  evidenceFromBeatIds?: string[];
  resolvesConflictBeatId?: string;
  requiredAnchorIds?: string[];
  sourceEventIds?: string[];
  targetSegmentNos?: number[];
  mustBeVisibleBeforeBeatIds?: string[];
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
  notes?: string[];
}
```

### B.34 `VideoStoryEvidence`

源文件：`src/services/video-orchestrator/types.ts:624`

```typescript
export interface VideoStoryEvidence {
  evidenceId: string;
  description?: string;
  introducedByBeatId: string;
  visibleInSegmentNos: number[];
  anchorIds?: string[];
}
```

### B.35 `VideoNarrativeMicroRules`

源文件：`src/services/video-orchestrator/types.ts:632`

```typescript
export interface VideoNarrativeMicroRules {
  causalChainRequired?: boolean;
  forbidSuddenOutcome?: boolean;
  forbidReferenceOnlyAnimation?: boolean;
  requireHookBeforeAssetShowcase?: boolean;
  requirePayoffBeforeCta?: boolean;
  requireReactionAfterTurningPoint?: boolean;
  requireVisibleTriggerBeforeStateChange?: boolean;
  requiredBeatFunctions?: VideoStoryFunction[];
  forbiddenPatterns?: string[];
  continuityRules?: string[];
  ctaRules?: string[];
  notes?: string[];
}
```

### B.36 `VideoShotGroupingPass`

源文件：`src/services/video-orchestrator/types.ts:647`

```typescript
export interface VideoShotGroupingPass {
  strategy?: string;
  strategyZh?: string;
  sourceBeatIds?: string[];
  groups?: Array<{
    groupId: string;
    beatIds: string[];
    segmentNos: number[];
    storyFunction?: VideoStoryFunction;
    reason?: string;
    reasonZh?: string;
    continuousTakeRisk?: "low" | "medium" | "high";
    splitRequired?: boolean;
  }>;
  splitReasons?: Array<{
    afterSegmentNo: number;
    beforeSegmentNo: number;
    reasonCode:
      | "space_change"
      | "time_jump"
      | "new_conflict_relation"
      | "payoff_state_change"
      | "cta_enter"
      | "duration_limit"
      | "camera_mismatch"
      | "narrative_focus_change"
      | "model_continuity_risk";
    reasonZh?: string;
    mergeRejected?: boolean;
  }>;
  warnings?: string[];
}
```

### B.37 `VideoStoryQualityReport`

源文件：`src/services/video-orchestrator/types.ts:680`

```typescript
export interface VideoStoryQualityReport {
  passed?: boolean;
  score?: number;
  hookScore?: number;
  causalityScore?: number;
  payoffScore?: number;
  ctaScore?: number;
  continuityScore?: number;
  riskScores?: Record<string, number>;
  issueCodes?: string[];
  issues?: Array<{
    code: string;
    severity: "warning" | "error";
    beatId?: string;
    segmentNo?: number;
    messageZh?: string;
    recommendationZh?: string;
  }>;
  rewriteRequired?: boolean;
  autoRewriteAttempts?: number;
  rewriteReasons?: string[];
  rewriteFromStage?: "creative_strategy" | "beat_sheet" | "storyboard" | "shot_grouping" | "none";
  summaryZh?: string;
}
```

### B.38 `AnchorStateTimelineEntry`

源文件：`src/services/video-orchestrator/types.ts:705`

```typescript
export interface AnchorStateTimelineEntry {
  eventId?: string;
  segmentNo: number;
  startState: string;
  endState: string;
  startPosition: string;
  endPosition: string;
  holderAtStart?: string;
  holderAtEnd?: string;
  visibleTransitionPath: string;
}
```

### B.39 `AnchorStateTimeline`

源文件：`src/services/video-orchestrator/types.ts:717`

```typescript
export interface AnchorStateTimeline {
  anchorId: string;
  states: AnchorStateTimelineEntry[];
}
```

### B.40 `StoryboardBrief`

源文件：`src/services/video-orchestrator/types.ts:722`

```typescript
export interface StoryboardBrief {
  segmentNo: number;
  eventIds: string[];
  sourceEventIds?: string[];
  linkedBeatIds?: string[];
  storyFunction?: VideoStoryFunction;
  narrativeFunction: string;
  cameraId: string;
  locationId: string;
  visualDescZh?: string;
  visualDescEn?: string;
  beatRole?: VideoTimelineBlueprintSegment["beatRole"];
  requiredAnchorIds?: string[];
  separationReason?: string;
  visibleAnchorIds: string[];
  purposeZh?: string;
  purposeEn?: string;
}
```

### B.41 `SegmentRenderDescription`

源文件：`src/services/video-orchestrator/types.ts:741`

```typescript
export interface SegmentRenderDescription {
  segmentNo: number;
  endFrameRequirementLevel?: "hard_exact" | "hard_semantic" | "soft_directional" | "editorial";
  videoPromptContract?: VideoPromptContract;
  startFrameContract?: Record<string, unknown>;
  endFrameContract?: Record<string, unknown>;
  motionContract?: Record<string, unknown>;
  singleTakeContract?: Record<string, unknown>;
  motionCheckpoints?: VideoMicroShot[];
  visibleAnchorIds: string[];
  requiresCut?: boolean;
  riskLevel?: "low" | "medium" | "high";
  timelineChangeRequest?: Record<string, unknown>;
  recommendedSplit?: unknown[];
  warnings?: string[];
}
```

### B.42 `VideoPromptTerminalRequirement`

源文件：`src/services/video-orchestrator/types.ts:758`

```typescript
export interface VideoPromptTerminalRequirement {
  requirementId: string;
  priority: "hard" | "soft";
  observableFact: string;
  acceptanceCriteria: string;
  source: "user" | "story_contract" | "approved_end_frame" | "planner";
}
```

### B.43 `VideoPromptContract`

源文件：`src/services/video-orchestrator/types.ts:766`

```typescript
export interface VideoPromptContract {
  version: "video-prompt-contract-v1";
  terminalRequirements: VideoPromptTerminalRequirement[];
  motionSteps: string[];
  preserveRequirements: string[];
  forbiddenOutcomes: string[];
  narrativeBoundary: string;
  shotIntent: string;
}
```

### B.44 `CameraRelation`

源文件：`src/services/video-orchestrator/types.ts:776`

```typescript
export type CameraRelation =
  | "same_camera_setup"
  | "same_axis"
  | "derived_reframe"
  | "same_spatial_context"
  | "same_subject_group"
  | "alternate_view"
  | "new_camera_setup";
```

### B.45 `CameraGraphNode`

源文件：`src/services/video-orchestrator/types.ts:785`

```typescript
export interface CameraGraphNode {
  cameraId: string;
  segmentNos: number[];
  locationId?: string;
  description?: string;
  parentCameraId?: string;
  parentSegmentNo?: number;
  axisDescription?: string;
  framingRange?: string;
  movementStyle?: string;
  spatialLayoutLock?: string;
  relationToParent?: CameraRelation;
  missingInfo?: string[];
  inheritanceReasonZh?: string;
}
```

### B.46 `CameraGraphEdge`

源文件：`src/services/video-orchestrator/types.ts:801`

```typescript
export interface CameraGraphEdge {
  fromCameraId: string;
  toCameraId: string;
  relation: CameraRelation;
  reason?: string;
}
```

### B.47 `CameraGraph`

源文件：`src/services/video-orchestrator/types.ts:808`

```typescript
export interface CameraGraph {
  cameras: CameraGraphNode[];
  relations: CameraGraphEdge[];
}
```

### B.48 `PlanValidationIssue`

源文件：`src/services/video-orchestrator/types.ts:813`

```typescript
export interface PlanValidationIssue {
  code: string;
  severity: "warning" | "error";
  artifactId?: string;
  messageZh: string;
  retryFromStage?: string;
}
```

### B.49 `FinalTransitionPlan`

源文件：`src/services/video-orchestrator/types.ts:821`

```typescript
export interface FinalTransitionPlan {
  fromSegmentNo: number;
  toSegmentNo: number;
  visualMode: "hard_cut" | "match_cut" | "dissolve" | "fade_to_black" | "generated_bridge";
  audioMode: "none" | "j_cut" | "l_cut" | "crossfade";
  overlapSeconds: number;
  matchAnchorId?: string;
  generatedBridgeRequired: boolean;
}
```

### B.50 `TransitionReferenceFrameCandidate`

源文件：`src/services/video-orchestrator/types.ts:831`

```typescript
export interface TransitionReferenceFrameCandidate {
  id: string;
  url: string;
  timestampFraction: number;
  compositeScore: number | null;
  passed: boolean;
  selected?: boolean;
  qualityReport: GenerationQualityReport;
}
```

### B.51 `TransitionReferenceArtifact`

源文件：`src/services/video-orchestrator/types.ts:841`

```typescript
export interface TransitionReferenceArtifact {
  id: string;
  fromCameraId?: string;
  toCameraId: string;
  fromSegmentNo?: number;
  toSegmentNo: number;
  relation: CameraRelation;
  mode: "short" | "full";
  inheritanceScope: string[];
  reasonZh: string;
  status: "planned" | "waiting_parent" | "video_running" | "evaluating_frames" | "ready_for_review" | "approved" | "failed";
  parentKeyframeNo?: number;
  parentKeyframeUrl?: string;
  videoTaskId?: string;
  videoUrl?: string;
  frameCandidates?: TransitionReferenceFrameCandidate[];
  selectedFrameUrl?: string;
  locked?: boolean;
  errorMessage?: string;
  updatedAt: string;
}
```

### B.52 `GeneratedBridgeArtifact`

源文件：`src/services/video-orchestrator/types.ts:863`

```typescript
export interface GeneratedBridgeArtifact {
  id: string;
  fromSegmentNo: number;
  toSegmentNo: number;
  status: "planned" | "running" | "ready_for_review" | "approved" | "failed";
  prompt?: string;
  durationSeconds: number;
  selectedVideoUrl?: string;
  locked?: boolean;
  errorMessage?: string;
  updatedAt: string;
}
```

### B.53 `ReferenceSelectionCandidate`

源文件：`src/services/video-orchestrator/types.ts:876`

```typescript
export interface ReferenceSelectionCandidate {
  artifactId: string;
  url?: string;
  sourceType?: "hard_anchor" | "user_upload" | "recent_keyframe" | "parent_camera" | "transition_reference" | "style_brand" | "custom";
  quotaType?: "character" | "product" | "space_layout" | "style_brand";
  purpose: string;
  relevanceScore: number;
  conflictScore: number;
  recencyScore: number;
  viewMatchScore: number;
  finalScore?: number;
  anchorId?: string;
  assetView?: VideoAssetView;
  hardRequired?: boolean;
  conflictReasons?: string[];
  detectedOrientation?: "front" | "side" | "back" | "unknown";
  selected: boolean;
  rejectionReason?: string;
  usageNote?: string;
}
```

### B.54 `ReferenceSelectionOutput`

源文件：`src/services/video-orchestrator/types.ts:897`

```typescript
export interface ReferenceSelectionOutput {
  targetArtifactId: string;
  targetType: "keyframe" | "segment" | "micro_shot" | "consistency_reference" | "custom";
  selectedArtifactIds: string[];
  selectedReferenceUrls?: string[];
  candidates: ReferenceSelectionCandidate[];
  usageNotes?: string[];
  finalTextPrompt?: string;
  targetOrientation?: "front" | "side" | "back" | "unknown";
  selectedView?: VideoAssetView;
  orientationFallbackReason?: string;
  selectionPolicyVersion?: string;
  warnings?: string[];
}
```

### B.55 `ArtifactMetadata`

源文件：`src/services/video-orchestrator/types.ts:912`

```typescript
export interface ArtifactMetadata {
  artifactId: string;
  artifactType: string;
  producedByStage: string;
  revision: number;
  schemaVersion: string;
  plannerVersion: string;
  promptVersion: string;
  modelVersion: string;
  inputHash: string;
  dependsOn: string[];
  invalidatedByArtifactIds?: string[];
  parentRevisionIds?: string[];
  userAccepted?: boolean;
  status: "draft" | "dirty" | "approved" | "generating" | "ready" | "failed";
  dirtyReason?: string;
  retryFromStage?: "stage1" | "stage2a" | "stage2b" | "stage3" | "reference_selector" | "compiler" | "generation" | "composition" | "manual";
  updatedAt?: string;
}
```

### B.56 `VideoMediaRevisionKind`

源文件：`src/services/video-orchestrator/types.ts:932`

```typescript
export type VideoMediaRevisionKind = "keyframe_image" | "micro_shot_image" | "segment_clip" | "transition_reference" | "generated_bridge" | "final_video";
```

### B.57 `VideoMediaRevision`

源文件：`src/services/video-orchestrator/types.ts:934`

```typescript
export interface VideoMediaRevision {
  id: string;
  kind: VideoMediaRevisionKind;
  targetId: string;
  url: string;
  createdAt: string;
  segmentNo?: number;
  microShotNo?: number;
}
```

### B.58 `RollbackVideoMediaInput`

源文件：`src/services/video-orchestrator/types.ts:944`

```typescript
export interface RollbackVideoMediaInput {
  kind: VideoMediaRevisionKind;
  targetId: string;
  microShotNo?: number;
}
```

### B.59 `GenerationQualityReport`

源文件：`src/services/video-orchestrator/types.ts:950`

```typescript
export interface GenerationQualityReport {
  policyVersion?: "quality-policy-v2" | "quality-policy-v3";
  evaluationStatus?: "completed" | "partial" | "technical_failed" | "reference_missing" | "unavailable" | "not_run";
  technicalError?: string;
  technicalRetryable?: boolean;
  /** Whether identity/product scores have an authoritative approved reference to compare against. */
  referenceComparable?: boolean;
  identityScoreApplicable?: boolean;
  productConsistencyScoreApplicable?: boolean;
  expectedAnchorIds?: string[];
  selectedReferenceCount?: number;
  missingReferenceAnchorIds?: string[];
  comparableChecks?: string[];
  /** Video review may be informative only and must not veto or auto-regenerate media. */
  advisoryOnly?: boolean;
  assetId: string;
  candidateId?: string;
  candidateNo?: number;
  mediaUrl?: string;
  identityScore: number | null;
  layoutScore: number | null;
  promptAlignmentScore: number | null;
  continuityScore: number | null;
  singleTakeScore?: number | null;
  artifactIssues: string[];
  passed: boolean;
  retryInstruction?: string;
  endFrameSimilarityScore?: number | null;
  endFrameDecision?: "pass" | "retry_generation" | "return_stage_2b" | "manual_review" | "evaluation_failed";
  endFrameReasons?: string[];
  continuityRetryCount?: number;
  contentBased?: boolean;
  productInstanceCount?: number;
  personInstanceCount?: number;
  wrongTextDetected?: boolean;
  correctionActions?: GenerationCorrectionAction[];
  contractConflicts?: string[];
  suspectedContractConflicts?: string[];
  contractConflictsVerified?: boolean;
  issueLedger?: GenerationIssueLedgerEntry[];
  resolvedIssueIds?: string[];
  openHardIssueIds?: string[];
  qualityDecision?: "pass" | "recommended" | "retry" | "blocked" | "review";
  hardFailureReasons?: string[];
  softSuggestions?: string[];
  firstFrameConsistencyScore?: number | null;
  checkpointOrderScore?: number | null;
  metadataIssues?: string[];
  userAccepted?: boolean;
  originalPassed?: boolean;
  retryFromStage?: "stage2b" | "stage3" | "reference_selector" | "generation" | "manual";
  evaluationModel?: string;
  evaluationDurationMs?: number;
  evaluationConfidence?: number;
  displaySummaries?: Partial<Record<QualityDisplayLanguage, QualityDisplaySummary>>;
}
```

### B.60 `QualityDisplayLanguage`

源文件：`src/services/video-orchestrator/types.ts:1007`

```typescript
export type QualityDisplayLanguage = "zh" | "en";
```

### B.61 `QualityDisplaySummaryItem`

源文件：`src/services/video-orchestrator/types.ts:1009`

```typescript
export interface QualityDisplaySummaryItem {
  status: "open" | "resolved" | "deferred";
  text: string;
}
```

### B.62 `QualityDisplaySummary`

源文件：`src/services/video-orchestrator/types.ts:1014`

```typescript
export interface QualityDisplaySummary {
  version: "quality-summary-v1" | "quality-summary-v2";
  lang: QualityDisplayLanguage;
  model: string;
  sourceHash: string;
  items: QualityDisplaySummaryItem[];
}
```

### B.63 `GenerationIssueLedgerEntry`

源文件：`src/services/video-orchestrator/types.ts:1022`

```typescript
export interface GenerationIssueLedgerEntry {
  issueId: string;
  fingerprint: string;
  category: "text_brand" | "game_ui" | "anatomy" | "identity" | "layout" | "continuity" | "artifact";
  region?: string;
  summary: string;
  target?: string;
  severity: "hard" | "soft" | "advisory";
  applicableStage: "static_image" | "video";
  status: "open" | "resolved" | "regressed" | "invalid_for_stage";
  firstSeenCandidateNo?: number;
  lastSeenCandidateNo?: number;
  occurrenceCount: number;
}
```

### B.64 `GenerationCorrectionAction`

源文件：`src/services/video-orchestrator/types.ts:1037`

```typescript
export interface GenerationCorrectionAction {
  region: string;
  element: string;
  observed: string;
  target: string;
  instruction: string;
  evidenceStatus?: "confirmed" | "uncertain";
  confidence?: number;
  normalizedRegion?: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
  };
  targetPoint?: {
    x: number;
    y: number;
  };
  executionParameters?: Record<string, unknown>;
  tolerance?: string;
  priority?: "required" | "recommended";
  sourceConstraint?: string;
  preserve?: string[];
}
```

### B.65 `PromptDebugArtifact`

源文件：`src/services/video-orchestrator/types.ts:1062`

```typescript
export interface PromptDebugArtifact {
  targetArtifactId: string;
  targetType: "keyframe" | "segment" | "micro_shot" | "consistency_reference" | "custom";
  compilerVersion: string;
  inputs: Record<string, unknown>;
  selectedReferenceUrls?: string[];
  referenceUsageNotes?: string[];
  beforePrompt?: string;
  finalPrompt: string;
  finalNegativePrompt?: string;
  rules: string[];
  warnings?: string[];
  createdAt: string;
}
```

### B.66 `OnePromptVideoPlan`

源文件：`src/services/video-orchestrator/types.ts:1077`

```typescript
export interface OnePromptVideoPlan {
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: VideoAspectRatio;
  keyframeCount: number;
  segmentCount: number;
  styleBible: VideoStyleBible;
  planningManifest?: VideoPlanningManifest;
  consistencyManifest?: VideoPlanningManifest["consistencyManifest"];
  timelineBlueprint?: VideoPlanningManifest["timelineBlueprint"];
  narrativeEvents?: NarrativeEvent[];
  creativeStrategy?: VideoCreativeStrategy;
  storyBeats?: VideoStoryBeat[];
  evidenceRegistry?: VideoStoryEvidence[];
  assetContract?: VideoAssetContract;
  narrativeMicroRules?: VideoNarrativeMicroRules;
  shotGroupingPass?: VideoShotGroupingPass;
  storyQualityReport?: VideoStoryQualityReport;
  anchorStateTimeline?: AnchorStateTimeline[];
  audioBible?: Record<string, unknown>;
  assetLibrary?: VideoAssetLibrary;
  candidateTimeline?: VideoTimelineBlueprintSegment[];
  storyboardBrief?: StoryboardBrief[];
  segmentRenderDescriptions?: SegmentRenderDescription[];
  cameraGraph?: CameraGraph;
  transitionReferencePlan?: unknown[];
  transitionReferenceArtifacts?: TransitionReferenceArtifact[];
  finalTransitionPlan?: FinalTransitionPlan[];
  generatedBridgeArtifacts?: GeneratedBridgeArtifact[];
  referenceSelectionOutputs?: ReferenceSelectionOutput[];
  promptDebugArtifacts?: Record<string, PromptDebugArtifact>;
  artifactMetadata?: Record<string, ArtifactMetadata>;
  mediaRevisionHistory?: Record<string, VideoMediaRevision[]>;
  generationQualityReports?: GenerationQualityReport[];
  plannerShadow?: Record<string, unknown>;
  plannerWarnings?: string[];
  storyboardPlan?: unknown;
  promptDetailPlan?: VideoPromptDetailPlan;
  consistencyReferences?: VideoConsistencyReference[];
  keyframes: VideoPlanKeyframe[];
  segments: VideoPlanSegment[];
  /**
   * Compatibility view for older UI/API code. New logic should use
   * keyframes + segments.
   */
  shots: VideoPlanShot[];
}
```

### B.67 `CreateVideoProjectInput`

源文件：`src/services/video-orchestrator/types.ts:1126`

```typescript
export interface CreateVideoProjectInput {
  userPrompt: string;
  aspectRatio?: VideoAspectRatio;
  durationSeconds?: number;
  shotCount?: number;
  stylePreset?: string;
  referenceImageUrls?: string[];
}
```

### B.68 `PlanVideoProjectInput`

源文件：`src/services/video-orchestrator/types.ts:1135`

```typescript
export interface PlanVideoProjectInput {
  userPrompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: number;
  /** Optional fallback segment count only. The storyboard model chooses the final count. */
  shotCount?: number;
  stylePreset?: string;
  referenceImageUrls: string[];
}
```

### B.69 `UpdateShotInput`

源文件：`src/services/video-orchestrator/types.ts:1145`

```typescript
export interface UpdateShotInput {
  locale?: "zh" | "en";
  purpose?: string;
  camera?: string;
  action?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  subtitle?: string;
  durationSeconds?: number;
  microShots?: VideoMicroShot[];
  audioPlan?: VideoAudioPlan;
  locked?: boolean;
}
```
