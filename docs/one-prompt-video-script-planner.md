# 一句话成片：剧本拆解模块说明

本文档说明“一句话成片”里剧本拆解模块的当前架构、提示词结构、模型输出格式、服务端归一化规则，以及后续图片/视频生成阶段如何基于拆解结果拼装最终提示词。

相关代码入口：

- `src/services/video-orchestrator/aliyun-workflow.ts`
- `src/services/video-orchestrator/planner.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/types.ts`
- `src/app/api/video-projects/[projectId]/plan/route.ts`

## 1. 模块定位

剧本拆解模块不是直接生成视频，而是把用户的一句话需求转换成可审核、可编辑、可生成的结构化视频计划。

它负责输出：

- 全片标题、简介、比例、风格设定
- 全片视觉一致性设定，当前主要放在 `styleBible` 和 `consistencyReferences`
- N+1 个边界关键帧 `keyframes`
- N 个首尾帧视频片段 `segments`
- 每段字幕 `subtitle`
- 每段音频策略 `audioPlan`
- 每段内部子分镜 `microShots`
- 兼容旧 UI 的 `shots`

当前核心思想是：

```text
用户一句话
  -> LLM 剧本拆解 JSON
  -> 服务端归一化与落库
  -> 用户审核脚本
  -> 生成一致性参考图和边界关键帧
  -> 用户审核关键帧
  -> 生成/审核子分镜参考图
  -> 生成视频片段
  -> 合成成片
```

## 2. 当前架构

### 2.1 代码分层

| 层级 | 文件 | 作用 |
| --- | --- | --- |
| API 路由 | `src/app/api/video-projects/[projectId]/plan/route.ts` | 接收前端生成/更新剧本计划请求 |
| 项目编排 | `src/services/video-orchestrator/project-service.ts` | 创建计划、落库、审核、同步任务、拼最终生成 prompt |
| LLM/上游调用 | `src/services/video-orchestrator/aliyun-workflow.ts` | 调用百炼大模型生成 storyboard JSON，调用图片/视频任务 |
| fallback 规划 | `src/services/video-orchestrator/planner.ts` | 当需要本地兜底时生成基础结构化计划 |
| 类型定义 | `src/services/video-orchestrator/types.ts` | 定义 `OnePromptVideoPlan`、`VideoPlanSegment`、`VideoMicroShot` 等结构 |

### 2.2 主要数据结构

剧本拆解的主结构是 `OnePromptVideoPlan`：

```ts
interface OnePromptVideoPlan {
  title: string;
  logline: string;
  durationSeconds: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  keyframeCount: number;
  segmentCount: number;
  styleBible: VideoStyleBible;
  consistencyReferences?: VideoConsistencyReference[];
  keyframes: VideoPlanKeyframe[];
  segments: VideoPlanSegment[];
  shots: VideoPlanShot[];
}
```

核心关系：

```text
KF01 -> Segment 01 -> KF02 -> Segment 02 -> KF03 ... -> KFN+1
```

- `keyframes` 是静态边界帧，不是视频片段，也不是镜头中点。
- `segments` 是相邻两个边界帧之间的视频片段。
- `Segment N` 使用 `Keyframe N` 作为首帧，使用 `Keyframe N+1` 作为尾帧。
- `shots` 是兼容旧代码/旧 UI 的视图，本质上由 `segments` 映射而来。

## 3. 完整流程

### 3.1 生成剧本计划

前端调用：

```http
POST /api/video-projects/[projectId]/plan
```

路由会：

1. 校验登录态。
2. 读取请求体。
3. 调用 `normalizePlanInput` 规范输入。
4. 调用 `planVideoProject`。

`planVideoProject` 会：

1. 读取项目。
2. 拼出 `PlanVideoProjectInput`：
   - `userPrompt`
   - `aspectRatio`
   - `durationSeconds`
   - `shotCount`，仅作为可选兜底段数
   - `stylePreset`
   - `referenceImageUrls`
3. 调用 `createAliyunStoryboardPlan(input)`。
4. 将模型输出的计划写入：
   - `VideoProject.planJson`
   - `VideoKeyframe`
   - `VideoSegment`
   - 兼容旧 UI 的 `VideoShot`
5. 将项目状态改为 `PLAN_REVIEW`。

### 3.2 用户审核脚本

用户在 `PLAN_REVIEW` 阶段可以修改：

- 片段目的
- 运镜/动作
- 图片 prompt
- 视频 prompt
- 负面 prompt
- 字幕
- 子分镜
- 音频计划
- 单段时长

前端保存时调用：

```http
PATCH /api/video-projects/[projectId]/plan
```

最终进入：

```ts
updateVideoShot(...)
```

它会同时更新数据库中的 `VideoSegment` / `VideoKeyframe`，并调用 `syncPlanJsonFromShots` 把修改同步回 `planJson`，保证后续生成阶段使用用户确认后的内容。

### 3.3 审核通过后进入关键帧生成

用户确认脚本后调用：

```http
POST /api/video-projects/[projectId]/approve-plan
```

后端进入 `approveVideoPlan`，通常会提交关键帧图片生成任务。

当前计划里如果有 `consistencyReferences`，会先作为特殊 keyframe 落库，keyframeNo 通常为负数或特殊编号。它们用于生成全片一致性的参考图，例如：

- 角色一致性参考图
- 场景一致性参考图

### 3.4 审核关键帧后进入子分镜确认

用户确认边界关键帧后调用：

```http
POST /api/video-projects/[projectId]/approve-images
```

当前逻辑不是直接进入视频片段生成，而是：

1. 将已生成的关键帧锁定为 `IMAGE_APPROVED`。
2. 为需要图片约束的 `microShots` 自动提交参考图生成任务。
3. 将项目状态置为 `MICRO_SHOT_REVIEW`。

这一步的目的，是让用户在“关键帧确认”和“视频片段生成”之间，单独确认每段内部子分镜的文字约束和图片约束。

### 3.5 审核子分镜后生成视频片段

用户确认内部子分镜后调用：

```http
POST /api/video-projects/[projectId]/approve-micro-shots
```

后端进入 `approveMicroShotReferences`，会检查：

- 需要图片约束的子分镜是否有 `imagePrompt`
- 图片任务是否失败
- 图片是否已经生成出 `imageUrl`

通过后：

1. 将片段置为 `CLIP_PENDING`。
2. 调用 `submitNextClipTask`。
3. 项目状态进入 `CLIP_GENERATING`。

## 4. LLM 提示词结构

LLM 剧本拆解入口在：

```ts
createAliyunStoryboardPlan(input)
```

它现在按三阶段发送三组提示词：

- `PLANNING_ARCHITECT_SYSTEM_PROMPT`
- `STORYBOARD_WRITER_SYSTEM_PROMPT`
- `PROMPT_DETAILER_SYSTEM_PROMPT`

### 4.1 三阶段 System Prompts

三阶段提示词分别承担不同职责，后续不要再把所有要求塞进一个大 prompt。

1. `Planning Architect`
   - 只返回合法 JSON。
   - 不返回 markdown、解释、注释。
   - 判断视频任务类型、目标受众、核心交付。
   - 动态识别一致性锚点。
   - 判断分镜数量、每段起止时间、时长和切分理由。
   - 不固定 6 段。
   - 不因为 30 秒就默认 6 段/7 帧。
   - 每段必须在 3-15 秒之间。
   - 总时长必须等于用户指定时长。

2. `Storyboard Writer`
   - `keyframes.length = segments.length + 1`。
   - 第一帧是 0 秒边界参考图。
   - 最后一帧是全片结束边界参考图。
   - 必须严格遵守阶段 1 的 `timeline_blueprint`。
   - 生成关键帧、片段、字幕、音频策略、子分镜结构。
   - 所有 keyframe、segment、microShot 都要引用 `uses_consistency_anchors`。

3. `Prompt Detailer`
   - 只细化最终图片/视频/子分镜参考图 prompt。
   - 不改阶段 1 的时间骨架。
   - 不改阶段 2 的剧情、字幕、音频策略和子分镜结构。
   - 把一致性锚点注入对应生成 prompt。

跨阶段规则：

- 中间关键帧同时是上一段结尾和下一段开头。
- 关键帧必须是静态画面设计，不允许描述运动过程。
- 每个 segment 必须返回 `boundary_mode`，支持 `continuous`、`hard_cut`、`dissolve`、`match_cut`。
- 字幕是后期/审核用的编辑层文案，不是视频模型画面文字。
- `micro_shots` 是内部控制点，不是额外视频片段。
- 普通视觉片段通常至少有一个 `mixed` 或 `image_prompt` 子分镜。
- 图片型子分镜必须能生成一张可预览、可修改、可重生成的静态参考图。

### 4.2 User Payload

三阶段会分别组织 payload。

阶段 1 输入主要包括：

```json
{
  "user_idea": "用户的一句话需求",
  "aspect_ratio": "9:16",
  "duration_seconds": 30,
  "style_preset": "guofeng",
  "segment_count_min": 2,
  "segment_count_max": 10,
  "segment_duration_min_seconds": 3,
  "segment_duration_max_seconds": 15,
  "reference_images": []
}
```

阶段 2 输入主要包括：

```json
{
  "user_idea": "用户的一句话需求",
  "aspect_ratio": "9:16",
  "duration_seconds": 30,
  "planning_manifest": {},
  "confirmed_anchor_images": []
}
```

阶段 3 输入主要包括：

```json
{
  "planning_manifest": {},
  "storyboard_plan": {},
  "confirmed_anchor_images": [],
  "confirmed_keyframe_images": [],
  "user_edits": {}
}
```

如果用户上传了参考图，payload 会把它们作为多模态消息一起传给模型，并要求模型抽取稳定的：

- 人物
- 服装
- 产品
- 道具
- 场景
- 色彩
- 材质
- 氛围

## 5. 大模型输出格式

每个阶段都要求返回一个 JSON 对象。实际字段支持 snake_case，也会在归一化阶段兼容 camelCase。

阶段 1 输出：

```json
{
  "planning_manifest": {
    "project_intent": {},
    "story_strategy": {},
    "timeline_blueprint": {
      "segment_count": 6,
      "total_duration_seconds": 30,
      "segments": []
    },
    "consistency_manifest": {
      "anchors": []
    },
    "global_style": {},
    "risks": []
  }
}
```

阶段 2 输出：

```json
{
  "storyboard_plan": {
    "title": "",
    "logline": "",
    "style_bible": {},
    "consistency_references": [],
    "keyframes": [],
    "segments": []
  }
}
```

阶段 3 输出：

```json
{
  "prompt_detail_plan": {
    "keyframe_prompts": [],
    "segment_video_prompts": [],
    "micro_shot_image_prompts": [],
    "negative_prompt_groups": [],
    "generation_notes": []
  }
}
```

## 6. 输出归一化

模型输出不会直接信任。三阶段 planner 会分别归一化每一层，再合并成最终 `OnePromptVideoPlan`。

主要规则：

- 阶段 1 归一化 `PlanningManifest`。
- 从 `timeline_blueprint.segments` 推导 `segmentCount`。
- 从 `segmentCount + 1` 推导 `keyframeCount`。
- 修正片段时长，确保每段 3-15 秒，总时长等于项目时长。
- 规范 `ConsistencyAnchor`，并保留 `consistencyManifest`。
- 阶段 2 必须严格遵守阶段 1 的时间骨架。
- 阶段 3 只能补 prompt，不允许改变故事结构。
- 如果模型缺字段，使用 fallback plan 补齐。
- 规范 `styleBible`。
- 规范 `consistencyReferences`。
- 规范 `keyframes`：
  - `frameRole`
  - `frameDesign`
  - `negativePromptGroups`
  - `imagePromptZh/En`
- 规范 `segments`：
  - 起止关键帧编号
  - 起止时间
  - `boundaryMode`
  - `subtitle`
  - `outputMode`
  - `constraints`
  - `timedPrompts`
  - `microShots`
  - `audioPlan`
- 规范 `promptDetailPlan`：
  - `keyframePrompts`
  - `segmentVideoPrompts`
  - `microShotImagePrompts`
- 从 `segments` 映射生成兼容旧 UI 的 `shots`。

子分镜归一化会兼容这些字段：

```ts
referenceType: "text" | "image_prompt" | "mixed";
imagePrompt?: string;
imagePromptZh?: string;
imagePromptEn?: string;
imageUrl?: string;
imageTaskId?: string;
imageStatus?: "idle" | "pending" | "running" | "ready" | "failed";
```

如果 `imagePromptZh` 或 `imagePromptEn` 存在，而 `referenceType` 没有明确返回，会默认倾向 `mixed`。

## 7. 最终生成 Prompt 怎么拼

剧本拆解不是最终交给图片/视频模型的唯一文本。后续生成阶段会把模型 JSON、用户编辑、参考图、锁定规则重新拼装成更完整的生成 prompt。

### 7.1 关键帧图片 Prompt

关键帧图片生成读取：

- 当前 keyframe 的 `imagePromptZh/En`
- `frameDesign`
- `styleBible`
- `characterLock`
- `productLock`
- `colorPalette`
- `colorToneLock`
- `lightingToneLock`
- `negativePrompt`
- 用户上传参考图
- 已生成的一致性参考图

图片 prompt 的原则：

- 生成静态画面。
- 不写运动过程。
- 不生成字幕、UI、水印、非预期文字。
- 用结构化字段约束人物、产品、场景、构图、光线、材质。

### 7.2 子分镜参考图 Prompt

当 `microShot.referenceType` 是 `image_prompt` 或 `mixed` 时，可以生成内部参考图。

最终 prompt 由 `generationPromptForMicroShot` 拼出，包含：

- 这是单个子分镜的静态参考图
- 所属 segment 和局部时间
- 子分镜目的
- 场景/状态
- 静态动作状态
- 构图/机位
- 子分镜图片 prompt
- 子分镜文字控制 prompt
- 全片人物身份锁
- 全片色调锁
- 禁止字幕、标签、水印、UI、拼图、时间轴文字

参考图还会引用：

- 一致性参考图
- 当前片段首帧
- 当前片段尾帧
- 用户上传参考图

### 7.3 视频片段 Prompt

视频片段生成读取：

- `segment.videoPromptEn`
- 用户中文修改后的 `segment.videoPromptZh`
- `boundaryMode`
- `outputMode`
- 全片人物身份锁
- 全片色调锁
- 负面 prompt
- `audioPlan`
- `constraints`
- `microShots`
- `timedPrompts`
- 子分镜参考图 URL
- 片段首帧图
- 片段尾帧图

核心拼装函数是：

```ts
generationPromptForSegment(project, segment)
```

它会把子分镜转成类似这样的内部控制段：

```text
Internal storyboard controls for this 5s segment:
- +0s; purpose: setup; scene: ...; action: ...; camera: ...; reference image prompt: ...; generated reference image URL: ...; control prompt: ...
- +3s; purpose: product interaction; scene: ...; action: ...; camera: ...; reference image prompt: ...; generated reference image URL: ...; control prompt: ...
```

这意味着最终视频模型看到的不是单段空泛描述，而是：

- 首帧图
- 尾帧图
- 全片锁定规则
- 子分镜内部控制点
- 必要时的子分镜参考图 URL
- 时间点控制 prompt
- 音频/旁白策略

## 8. 审核点和状态机

当前与剧本拆解相关的项目状态：

| 状态 | 含义 |
| --- | --- |
| `DRAFT` | 项目刚创建 |
| `PLANNING` | 正在生成结构化计划 |
| `PLAN_REVIEW` | 用户审核剧本、关键帧规划、字幕、子分镜文字 |
| `KEYFRAME_GENERATING` | 正在生成边界关键帧 |
| `KEYFRAME_REVIEW` | 用户审核边界关键帧 |
| `MICRO_SHOT_REVIEW` | 用户审核每段内部子分镜文字/图片约束 |
| `CLIP_GENERATING` | 正在生成视频片段 |
| `CLIP_REVIEW` | 用户审核视频片段 |
| `COMPOSING` | 正在合成 |
| `FINAL_REVIEW` | 成片审核 |

当前用户可控点：

- 剧本计划可编辑
- 字幕可编辑
- 关键帧 prompt 可编辑
- 关键帧可重生成
- 子分镜文字约束可编辑
- 子分镜图片 prompt 可编辑
- 子分镜参考图可生成、预览、重生成
- 视频片段 prompt 可编辑
- 视频片段可重生成

## 9. 当前一致性能力

当前已经有三层一致性：

### 9.1 `styleBible`

保存全片风格锁：

- `visualStyle`
- `characterLock`
- `productLock`
- `colorPalette`
- `colorToneLock`
- `lightingToneLock`
- `negativePrompt`

### 9.2 `consistencyReferences`

当前支持两类：

```ts
type VideoConsistencyReferenceKind = "character" | "scene";
```

它们用于先生成全片参考图，再影响后续关键帧和视频片段。

### 9.3 生成阶段硬锁

最终视频 prompt 会追加：

- `Hard character identity lock`
- `Hard color tone continuity lock`
- segment constraints
- micro-shot controls

## 10. 目前的不足

当前一致性还不够通用。模型现在主要围绕：

- 人物一致
- 场景一致
- 产品锁定写在 `styleBible.productLock`

但真实任务里，需要贯穿全片的对象不一定是产品，也不一定只有人物/场景。

例如：

- 产品广告：产品包装、瓶型、logo、颜色、材质
- 美妆任务：皮肤状态、妆容变化、工具
- 餐饮任务：菜品、餐具、店铺环境
- 装修任务：房间结构、家具、材质
- 车辆任务：车型、颜色、内饰、车牌是否隐藏
- 教学任务：老师、器材、板书风格

所以后续不应该继续只写死 `character` / `scene` / `product`，而应该升级成更通用的“一致性锚点”。

## 11. 当前调用方式与分层设计方案

### 11.1 旧调用方式

旧版剧本拆解是“一轮大模型调用，直接输出完整 Storyboard JSON”。当前代码已按本节三阶段方案重构，旧版单轮结构只作为历史问题说明。

旧版实际链路是：

```text
用户一句话 + 参数 + 参考图
  -> 一次调用旧版单轮 storyboard prompt
  -> 一次性输出 style_bible / consistency_references / keyframes / segments / subtitles / audio_plan / micro_shots / prompts
  -> 后端做单轮归一化
  -> 写入 planJson、VideoKeyframe、VideoSegment
```

也就是说，当前不是严格分层的：

```text
第 1 轮：只分析一致性对象
第 2 轮：基于一致性对象拆剧本
第 3 轮：细化关键帧、子分镜和生成 prompt
```

旧版虽然在同一轮 prompt 里要求模型思考人物、场景、产品、色调、字幕、子分镜，但这些都挤在一次输出里。它的优点是链路短、速度快、成本低；缺点是模型容易顾此失彼，尤其是产品、道具、局部状态、品牌视觉这类需要全片贯穿的对象，容易被写成泛泛描述，后续图片和视频生成就会漂。

### 11.2 三阶段分层目标

分层的目标不是为了让流程变复杂，而是把“模型应该先想清楚的事情”从一个大 prompt 里拆出来，形成稳定的中间产物。

后续固定采用三阶段：

```text
阶段 1：Planning Architect
  任务理解 + 一致性锚点 + 分镜数量/时间骨架

阶段 2：Storyboard Writer
  基于阶段 1 的骨架，生成完整剧本、关键帧、片段、字幕、音频、子分镜结构

阶段 3：Prompt Detailer
  基于阶段 1 和阶段 2，细化图片/视频/子分镜参考图的最终生成 prompt
```

三个阶段的边界必须清楚：

- 阶段 1 决定“这条片子的战略和骨架”：任务是什么、什么必须一致、拆几个分镜、每个分镜多长、为什么这样拆。
- 阶段 2 决定“每个分镜具体演什么”：关键帧时间轴、片段内容、字幕节奏、音频策略、子分镜控制点。
- 阶段 3 决定“怎么喂给生成模型”：图片 prompt、视频 prompt、负面 prompt、参考图 prompt、连续性硬锁和时间点控制。

### 11.3 阶段 1：Planning Architect

这一轮让模型先做任务理解、全片一致性设定、分镜数量判定和时间骨架规划。不生成完整关键帧 prompt、视频 prompt 或子分镜图片 prompt。

输入：

```json
{
  "user_idea": "",
  "aspect_ratio": "9:16",
  "duration_seconds": 30,
  "style_preset": "",
  "reference_images": []
}
```

输出建议：

```json
{
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
    "timeline_blueprint": {
      "segment_count": 6,
      "total_duration_seconds": 30,
      "segment_duration_min_seconds": 3,
      "segment_duration_max_seconds": 15,
      "split_strategy_zh": "按信息节奏、动作阶段和生成连续性风险拆分。",
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
          "boundary_mode_hint": "continuous | hard_cut | dissolve | match_cut"
        }
      ]
    },
    "consistency_manifest": {
      "anchors": []
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

这一层的重点是让模型回答：

- 这条视频是什么任务？
- 整个剧本应该拆成几个分镜片段？
- 每个分镜片段的开始时间、结束时间、时长是多少？
- 为什么这里要切一段，而不是和前后片段合并？
- 每个分镜片段承担什么叙事功能、信息点、字幕意图和音频意图？
- 有没有主角？主角是否必须一致？
- 有没有产品？如果有，产品哪些细节必须锁死？
- 有没有场景？场景结构是否必须一致？
- 有没有特殊道具、效果状态、品牌视觉、菜品、车辆、空间布局等必须贯穿？
- 哪些锚点需要生成参考图？
- 哪些锚点只需要文字约束？

阶段 1 的输出是后续两轮的硬约束。除非用户在审核时修改，否则阶段 2 不应该擅自改变分镜数量、片段时长或一致性锚点。

### 11.4 阶段 2：Storyboard Writer

第二轮输入阶段 1 的 `planning_manifest`，在既定时间骨架上生成详细剧本结构。

输入：

```json
{
  "user_idea": "",
  "planning_manifest": {},
  "confirmed_anchor_images": [],
  "user_edited_manifest": {}
}
```

输出仍然接近当前主结构，但必须严格遵守 `timeline_blueprint`：

```json
{
  "title": "",
  "logline": "",
  "style_bible": {},
  "consistency_references": [],
  "keyframes": [],
  "segments": [],
  "shots": []
}
```

阶段 2 的职责：

- 根据 `timeline_blueprint.segments` 生成对应数量的 `segments`。
- 根据 segment 数量生成 `segments.length + 1` 个边界关键帧。
- 每个 segment 的起止时间和时长必须与阶段 1 一致。
- 生成每段 `purpose`、`motion`、`camera`、`subjectMotion`、`environmentMotion`。
- 生成每段字幕 `subtitle`，并让字幕序列形成一个完整小脚本。
- 生成每段 `audioPlan`。
- 生成每段 `microShots`，并决定每个子分镜是 `text`、`image_prompt` 还是 `mixed`。
- 所有关键帧、片段和子分镜都必须显式引用相关一致性锚点。

示例：

```json
{
  "segment_no": 2,
  "start_time_seconds": 5,
  "end_time_seconds": 10,
  "duration_seconds": 5,
  "uses_consistency_anchors": ["main_character", "hero_product", "courtyard_scene"],
  "key_continuity_requirements": [
    "hero_product front label area remains vertical and unobstructed",
    "main_character keeps same face, hairstyle, white hanfu, and calm expression range"
  ],
  "micro_shots": [
    {
      "micro_shot_no": 1,
      "reference_type": "mixed",
      "uses_consistency_anchors": ["main_character", "hero_product"],
      "image_prompt_en": ""
    }
  ]
}
```

如果阶段 2 发现阶段 1 的时间骨架明显不合理，不能直接改结果，而应该返回：

```json
{
  "timeline_change_request": {
    "needed": true,
    "reason_zh": "",
    "proposed_timeline_blueprint": {}
  }
}
```

这样可以防止第二轮模型偷偷推翻第一轮规划。

### 11.5 阶段 3：Prompt Detailer

第三轮输入阶段 1 和阶段 2 的结果，专门细化最终生成提示词。

输入：

```json
{
  "planning_manifest": {},
  "storyboard_plan": {},
  "confirmed_anchor_images": [],
  "confirmed_keyframe_images": [],
  "user_edits": {}
}
```

输出：

```json
{
  "prompt_detail_plan": {
    "keyframe_prompts": [],
    "segment_video_prompts": [],
    "micro_shot_image_prompts": [],
    "negative_prompt_groups": [],
    "generation_notes": []
  }
}
```

阶段 3 的职责：

- 为每个 keyframe 生成最终图片 prompt。
- 为每个 segment 生成最终视频 prompt。
- 为每个需要图片约束的 microShot 生成内部参考图 prompt。
- 生成或补全负面 prompt。
- 把一致性锚点文字和参考图注入对应 prompt。
- 把用户编辑后的字幕、片段目标、子分镜控制点纳入 prompt。
- 不允许改变阶段 1 的时间骨架。
- 不允许改变阶段 2 的剧情、字幕、音频策略和子分镜结构。

阶段 3 输出后，后端的 prompt 编译器仍然可以继续做机械拼装，例如追加 `Hard character identity lock`、`Hard color tone lock`、参考图 URL、负面 prompt 等。

### 11.6 一致性锚点的数据契约

`consistency_manifest.anchors` 建议使用通用结构，不要写死产品。

```json
{
  "id": "hero_product",
  "type": "product",
  "display_name_zh": "青瓷护肤瓶",
  "display_name_en": "jade ceramic skincare bottle",
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
  "user_editable": true
}
```

`type` 建议支持：

- `person`
- `product`
- `prop`
- `location`
- `style`
- `brand_visual`
- `task_object`
- `effect_state`
- `vehicle`
- `food`
- `space_layout`
- `custom`

`reference_strength` 建议支持：

- `hard`：必须完全一致，比如主角脸、产品外观、车型。
- `medium`：大体一致即可，比如场景氛围、道具摆放。
- `soft`：只作为风格参考，比如色彩、质感、镜头语言。

### 11.7 用户审核节点建议

分层之后，建议把用户审核点调整成：

```text
1. 任务、一致性与时间骨架审核
   用户确认任务理解、anchors、分镜数量、每段时间、切分理由是否准确。

2. 剧本与时间轴审核
   用户确认 segments、keyframes、subtitle、audioPlan 是否符合需求。

3. 关键帧审核
   用户确认边界关键帧图。

4. 子分镜审核
   用户确认 microShots 的文字约束和图片约束。

5. 视频片段审核
   用户确认每段视频。
```

其中第一步是新增的关键节点。它解决的是：

> 不要等产品/人物/场景已经生成跑偏，或者分镜数量和节奏已经不合理了，才在每个镜头里单独修。

### 11.8 后端落库建议

第一版可以先不新增表，直接扩展 `VideoProject.planJson`：

```json
{
  "planningManifest": {},
  "consistencyManifest": {},
  "timelineBlueprint": {},
  "storyboardPlan": {},
  "promptDetailPlan": {},
  "styleBible": {},
  "keyframes": [],
  "segments": []
}
```

如果后续需要更强的编辑和任务追踪，再考虑新增表：

- `VideoConsistencyAnchor`
- `VideoConsistencyAnchorImage`

这样每个 anchor 都可以单独：

- 编辑文字描述
- 生成参考图
- 重生成参考图
- 锁定
- 被 keyframe/segment/microShot 引用

后续如果要把时间骨架也结构化追踪，可以新增：

- `VideoTimelineSegment`
- `VideoStoryboardRevision`
- `VideoPromptDetailRevision`

### 11.9 Prompt 组织建议

分层后不要让后续阶段重新发明前一阶段结论。

阶段 2 prompt 应明确要求：

```text
You must treat planning_manifest.consistency_manifest.anchors as the source of truth.
You must treat planning_manifest.timeline_blueprint as the source of truth for segment count, start time, end time, and duration.
Do not change anchor identity, product shape, scene layout, brand visual rules, or effect state.
Do not change segment count or segment durations unless you return timeline_change_request.
Every keyframe, segment, and micro_shot must list which anchors it uses.
If a new recurring object becomes necessary, add it to proposed_new_anchors instead of silently inventing it.
```

阶段 3 prompt 应明确要求：

```text
You are not allowed to rewrite the story, timeline, subtitles, audio plan, or micro-shot structure.
Your only job is to compile detailed generation prompts from the approved manifest and storyboard.
Every prompt must preserve the anchors referenced by that keyframe, segment, or micro-shot.
```

这样模型可以扩展提示词细节，但不能偷偷改产品、人物、场景、分镜数量或片段节奏。

### 11.10 迁移步骤

建议按以下顺序执行：

1. 在文档和类型里定义 `PlanningManifest` / `ConsistencyAnchor`。
2. 新增第一轮 `createPlanningManifest` 调用。
3. 在第一轮输出里加入 `timelineBlueprint`，包含分镜数量、每段时间、切分理由。
4. 把 manifest 和 timeline blueprint 存入 `planJson`。
5. 在 UI 增加“任务、一致性与时间骨架”审核区。
6. 新增第二轮 `createStoryboardFromManifest` 调用，要求严格遵守阶段 1。
7. 让 keyframes / segments / microShots 引用 `usesConsistencyAnchors`。
8. 新增第三轮 `createPromptDetailsFromStoryboard` 调用，专门生成最终 prompt 细节。
9. 支持 anchor 参考图生成。
10. 在最终图片/视频 prompt 编译时注入被引用 anchors 的文字和图片。

三阶段完成后，可以同时改善两类问题：

- 产品、人物、道具、场景、效果状态不一致。
- 分镜数量、片段时长和信息节奏不稳定。

## 12. Consistency Manifest 结构补充

`Consistency Manifest` 是阶段 1 `Planning Architect` 的核心输出之一，用来描述全片必须保持一致的对象、状态和视觉规则。

```json
{
  "consistency_manifest": {
    "anchors": [
      {
        "id": "hero_product",
        "type": "product",
        "display_name": "青瓷护肤瓶",
        "must_stay_consistent": true,
        "needs_reference_image": true,
        "description_zh": "浅青色圆肩陶瓷护肤瓶，正面竖排品牌字样，金色瓶盖...",
        "description_en": "Pale jade ceramic skincare bottle with rounded shoulders, vertical front label area, gold cap...",
        "applies_to": ["keyframes", "segments", "micro_shots"]
      }
    ]
  }
}
```

升级后的模型第一步不是直接拆镜头，而是先判断：

> 这个任务里哪些对象、状态、视觉规则必须贯穿全片？

这些 anchor 可以是：

- `person`
- `product`
- `prop`
- `location`
- `style`
- `brand_visual`
- `task_object`
- `effect_state`
- `vehicle`
- `food`
- `space_layout`
- `custom`

这样产品一致性就不再是硬编码规则，而是由大模型根据任务动态识别。

推荐后续架构：

```text
用户一句话
  -> 任务理解
  -> consistency_manifest
  -> 镜头/关键帧/片段拆解引用 anchors
  -> 生成 anchor 参考图
  -> 用户确认 anchors
  -> 生成边界关键帧
  -> 用户确认关键帧
  -> 生成/确认子分镜
  -> 生成视频片段
```

对应的 segment 可以变成：

```json
{
  "segment_no": 2,
  "uses_consistency_anchors": ["main_character", "hero_product", "courtyard_scene"],
  "video_prompt_en": "The main_character applies the hero_product beside the stone table in courtyard_scene..."
}
```

关键优势：

- 不再预先假设每个任务都有产品。
- 不再只支持人物/场景两种参考图。
- 每个任务可以动态决定要锁定什么。
- 后续关键帧、子分镜、视频片段都引用同一组 anchor。
- 用户可以在统一位置修改“全片一致性资产”。

## 13. 维护建议

不要再把新增需求堆回单个大 prompt。任何新需求都要先判断属于三阶段中的哪一层：

- 剧情理解
- 分段
- 关键帧设计
- 字幕策略
- 音频策略
- 子分镜拆解
- 视觉连续性
- 一致性参考图判断
- 图片/视频 prompt 生成规则

如果继续把所有新增要求都塞进一个大 prompt，模型容易顾此失彼。

后续维护时要保持三阶段职责边界：

1. `Planning Architect`
   - 识别目标、受众、风格、核心对象、必须一致的 anchor，并规划分镜数量、每段时间和切分理由。

2. `Storyboard Writer`
   - 根据阶段 1 的 anchors 和 timeline blueprint 生成 keyframes、segments、subtitles、audioPlan、microShots。

3. `Prompt Detailer`
   - 根据阶段 1 和阶段 2 的结构化 JSON、用户编辑、参考图、anchor 图，生成最终图片/视频/子分镜参考图 prompt。

当前代码已拆出三阶段 planner。后续维护时不要把新要求塞回单个大 prompt，而应该判断它属于 `Planning Architect`、`Storyboard Writer` 还是 `Prompt Detailer`。
