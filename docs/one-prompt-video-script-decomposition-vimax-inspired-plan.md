# 一句话成片剧本拆解改造方案：吸收 ViMax 设计后的项目化方案

本文基于 ViMax 开源项目的 `SCRIPT_DECOMPOSITION_ZH.md`，提炼其中对我们“一句话成片”有价值的剧本拆解思想，并结合当前项目的真实链路、已有三阶段 planner、关键帧审核、子分镜审核、一镜到底约束、字幕后期烧录、音频一致性和一致性参考图机制，形成一份适合本项目后续重构执行的方案。

本文不是 ViMax 的照搬说明。ViMax 更偏“文件式影视生产流水线”，我们当前项目更偏“用户一句话输入 + Web 交互审核 + 多模型生成 + 数据库存储”。因此本方案的重点是吸收 ViMax 的中间产物、校验、参考图选择和可恢复思想，再改造成我们自己的三阶段结构化拆解体系。

## 1. 改造目标

当前一句话成片已经有三阶段拆解：

```text
阶段 1：Planning Architect
  任务理解 + 一致性锚点 + 分镜数量/时间骨架

阶段 2：Storyboard Writer
  关键帧 + 片段 + 字幕 + 音频计划 + 子分镜

阶段 3：Prompt Detailer
  图片 prompt + 视频 prompt + 子分镜参考图 prompt
```

但从近期问题看，仍然存在几个核心短板：

- 人物、产品、品牌视觉、道具等一致性锚点虽然被识别，但没有形成足够强的“资产优先生成、后续引用”的生产纪律。
- 单个 segment 有时仍像多个镜头拼在一起，缺少足够工程化的“首帧、尾帧、运动、可达性、机位继承”描述。
- 子分镜虽然存在，但仍容易写成“小镜头列表”，不是同一镜头内的 motion checkpoints。
- 音频只是每段 `audioPlan` 文本提示，最终仍依赖视频模型逐段生成音轨，导致音频不一致。
- 当前结构主要存在于 `planJson` 中，缺少像 ViMax 那样清晰的中间产物边界，导致调试、局部重试和质量审计不够直观。

改造目标是：

```text
把“好看的故事描述”
改造成
可审核、可重试、可生成参考图、可驱动关键帧、可驱动视频、可后期合成的结构化生产合同。
```

## 2. ViMax 最值得吸收的优点

### 2.1 中间产物明确

ViMax 不直接把长 prompt 扔给视频模型，而是逐层生成：

```text
characters.json
storyboard.json
shots/<idx>/shot_description.json
camera_tree.json
```

这几个产物分别回答不同问题：

- `characters.json`：有哪些角色，外观、服装、身份如何保持一致。
- `storyboard.json`：拆成几个镜头，每个镜头看什么，属于哪个机位，大概有什么声音。
- `shot_description.json`：每个镜头的首帧、尾帧、中间运动、变化幅度、可见角色。
- `camera_tree.json`：哪些镜头复用同一机位，哪些镜头继承前一个构图，缺失哪些信息。

对我们的启发：我们不一定要落成文件，但需要在 `planJson` 和 UI 中形成同等清晰的中间结构，而不是把所有内容混在 `segments` 和 prompt 字符串里。

### 2.2 首帧、尾帧、运动三分法

ViMax 的 `shot_description` 把一个镜头拆成：

```text
ff_desc：首帧静态描述
lf_desc：尾帧静态描述
motion_desc：首尾之间的运动描述
variation_type：变化幅度 small / medium / large
```

这个思想非常适合我们，因为我们当前链路也是：

```text
边界关键帧 N -> 图生视频片段 -> 边界关键帧 N+1
```

我们应该把每个 segment 强制描述为：

```text
start_frame_contract
end_frame_contract
motion_contract
single_take_contract
variation_type
reachable_check
```

这样能减少“一段视频里实际包含多个镜头”的问题。

### 2.3 可见角色索引

ViMax 的 `ff_vis_char_idxs` / `lf_vis_char_idxs` 会明确标记首帧和尾帧里出现哪些角色。

对我们来说，应该升级为：

```json
"visible_anchor_ids": ["main_character", "hero_product", "card_deck"]
```

并且细分到：

```json
"start_visible_anchor_ids": [],
"end_visible_anchor_ids": [],
"motion_visible_anchor_ids": []
```

这样后端才能准确决定当前关键帧应该引用哪些一致性参考图，避免把不相关锚点塞进 prompt，也避免漏掉主角或产品。

### 2.4 Camera Tree / 机位继承

ViMax 用 `camera_tree.json` 描述镜头和机位之间的继承关系。它不是为了“炫技”，而是为了让新镜头知道应该继承哪个旧镜头的构图、背景、人物位置和空间布局。

我们当前只有 `camera` 字段和一镜到底约束，还没有工程化的机位继承结构。建议增加：

```json
"camera_graph": {
  "nodes": [
    {
      "camera_id": "cam_01",
      "parent_camera_id": null,
      "covered_segment_nos": [1, 2],
      "axis_description": "",
      "framing_range": "",
      "spatial_layout_lock": "",
      "inheritance_reason": "",
      "missing_info": []
    }
  ]
}
```

这比简单的 `camera: slow dolly in` 更能约束跨镜头连续性。

### 2.5 可恢复、可局部重试

ViMax 的每个关键中间产物都会落盘。如果某一步失败，可以只重试缺失部分。

我们可以不采用文件落盘，但应在 `planJson` 中保留分层产物：

```json
{
  "planningManifest": {},
  "anchorManifest": {},
  "storyboardBrief": {},
  "segmentRenderDescriptions": [],
  "cameraGraph": {},
  "promptDetailPlan": {},
  "singleTakeAudit": {},
  "audioBible": {}
}
```

这样用户修改某个 anchor、某个 segment、某个 keyframe 时，不必整条链路全部重跑。

### 2.6 参考图选择器与 Prompt 调试产物

ViMax 新增说明里非常值得吸收的一点是：关键帧图片 prompt 不是直接等于 `ff_desc` 或 `lf_desc`，而是先经过 `ReferenceImageSelector`：

```text
frame_description
  + 开局参考图
  + 角色肖像图
  + 同机位历史帧
  + 父机位参考帧
  + 新机位过渡参考图
  -> ReferenceImageSelector
  -> selector_output
  -> 最终图片 prompt + reference image urls
```

这对我们当前项目很重要。现在我们已经有 anchor 参考图、边界关键帧、子分镜参考图，但参考图用途还不够结构化。后续应该增加一层 `referenceSelectionPlan`，明确每次生成关键帧或子分镜图时：

- 候选参考图有哪些；
- 每张参考图的用途是什么；
- 哪些图必须使用；
- 哪些图只是风格参考；
- 哪些图不能使用；
- 最终传给图片模型的参考图 URL 和文字说明是什么。

建议在 `planJson` 或任务日志中保留类似 ViMax 的调试产物：

```json
{
  "reference_selection_outputs": [
    {
      "target_type": "keyframe | motion_checkpoint | anchor",
      "target_id": "kf_01",
      "candidate_references": [
        {
          "source": "anchor_image | user_reference | parent_camera | previous_keyframe | transition_reference",
          "url": "",
          "description": "",
          "intended_usage": "identity | product | scene_layout | style | composition | brand_visual"
        }
      ],
      "selected_references": [],
      "text_prompt": "",
      "rejection_reason_for_others": []
    }
  ]
}
```

这样某张图画错时，排查顺序不再只看最终 prompt，而是可以看：

```text
1. start/end frame contract 是否写清楚；
2. visible_anchor_ids 是否漏掉；
3. candidate references 是否完整；
4. selected references 是否选错；
5. text_prompt 是否误用了参考图；
6. 最终图片/视频 prompt 是否丢失了约束。
```

### 2.7 角色三视图参考资产

ViMax 中角色肖像不是一张图，而是正面、侧面、背面三张基础参考：

```text
front.png -> side.png -> back.png
```

我们当前的一致性参考图通常是一张项目级人物图。对真人、卡通角色、游戏 mascot、IP 角色来说，一张图不足以支撑不同景别和角度。建议后续把 `person` 类型的 hard anchor 升级为可选三视图资产：

```json
{
  "anchor_id": "main_character",
  "reference_views": {
    "front": "",
    "side": "",
    "back": "",
    "three_quarter": ""
  },
  "default_view": "front",
  "view_generation_order": ["front", "side", "back"]
}
```

执行策略：

- 第一阶段只判断是否需要三视图；
- 一致性资产生成阶段先生成 `front`；
- `side/back` 尽量参考 `front` 再生成，避免三张图变成三个角色；
- 每个 keyframe 根据构图和角色朝向选择对应视图；
- 如果只生成一张图，也必须在 `referenceSelectionPlan` 里标注该图用于身份，而不是姿态或构图。

## 3. 我们不能照搬 ViMax 的地方

ViMax 的流程更像离线影视生产：

```text
script -> characters.json -> storyboard.json -> shot_description.json -> camera_tree.json -> render
```

我们当前的产品形态不同：

- 用户通常只输入一句话，而不是完整剧本。
- 前端有多轮审核：脚本、关键帧、子分镜、视频片段、最终成片。
- 关键帧、子分镜参考图、视频片段都是异步任务。
- 一致性参考图需要用户预览、修改、锁定、重生成。
- 字幕是后期烧录，不应让图片/视频模型直接生成文字。
- 视频生成目前强制使用 HappyHorse，图像生成和文本拆解又是另一组模型。
- 音频目前没有独立 TTS/BGM/音效资产链路，不能继续依赖视频模型逐段乱生成。

因此我们的方案应该是：

```text
保留三阶段 LLM 主结构
增加 ViMax 式中间产物
加强一致性资产优先生成
增加机位/首尾帧/运动合同
增加音频全局策略
保留用户交互审核和数据库状态机
```

## 4. 推荐的新剧本拆解总架构

建议改造成“四层产物、三轮大模型、两类审计”的结构。

```text
用户一句话 + 参数 + 参考图
  -> 阶段 1：Planning Architect
       输出 Planning Manifest
       输出 Anchor Manifest
       输出 Audio Bible
       输出 Candidate Timeline

  -> 一致性资产确认
       先生成 anchor reference images
       用户审核/修改/锁定

  -> 阶段 2：Storyboard Writer
       输出 Storyboard Brief
       输出 Segment Render Description
       输出 Keyframe Contracts
       输出 Motion Checkpoints
       输出 Camera Graph
       输出 Subtitle Plan

  -> Single-take Audit + Split Repair
       审计每段是否一镜到底可执行
       不通过则拆分/简化/阻止生成

  -> 阶段 3：Prompt Detailer
       输出 Keyframe Prompts
       输出 Micro-shot Image Prompts
       输出 Segment Video Prompts
       输出 Negative Prompts
       输出 Reference Usage Plan

  -> 后端 Prompt Compiler
       注入用户编辑内容
       注入 anchor reference images
       注入 camera graph
       注入 single-take contracts
       禁止字幕入画
       禁止视频模型生成不受控音频

  -> 图片/视频/字幕/音频/合成
```

关键变化是：**一致性锚点参考图必须在普通关键帧之前生成和确认**。这与最近我们已经修复的调度原则一致，但后续应在架构层正式写入剧本拆解方案。

## 5. 阶段 1：Planning Architect 改造

阶段 1 不生成具体关键帧和最终 prompt，只回答“这条片子应该如何被生产”。

### 5.1 输入

```json
{
  "user_idea": "",
  "aspect_ratio": "9:16",
  "duration_seconds": 30,
  "style_preset": "",
  "reference_images": []
}
```

### 5.2 输出

```json
{
  "planning_manifest": {
    "project_intent": {},
    "story_strategy": {},
    "timeline_blueprint": {},
    "consistency_manifest": {},
    "audio_bible": {},
    "subtitle_policy": {},
    "global_style": {},
    "risks": []
  }
}
```

### 5.3 必须让模型回答的问题

任务理解：

- 这条视频是什么类型：广告、教程、短剧、游戏推广、电商种草、品牌片还是其他？
- 目标受众是谁？
- 成功标准是什么？
- 是更重视觉氛围、产品展示、剧情转折、操作步骤，还是品牌记忆？

时间骨架：

- 总时长是多少？
- 拆几个 segment？
- 每个 segment 的起止时间和时长是多少？
- 为什么在这里切分？
- 每段是否能作为一镜到底生成？
- 哪些 beat 因为换场景、换机位、换状态，必须拆成新 segment？

一致性锚点：

- 是否有主角？主角是否必须一致？
- 是否有产品？产品哪些细节必须锁死？
- 是否有品牌视觉？logo、字体、色彩、界面元素是否必须一致？
- 是否有道具、菜品、车辆、游戏角色、UI、空间布局、效果状态等必须贯穿？
- 哪些锚点需要图片参考？
- 哪些锚点只需要文字约束？
- 每个锚点应该作用于 keyframes、segments、micro_shots 还是 audio？

字幕策略：

- 是否需要字幕？
- 字幕承担什么作用：品牌口号、卖点、旁白字幕、步骤说明、情绪文案？
- 字幕语言、位置、每行字数、避让区域是什么？

音频策略：

- 是否需要全片统一 BGM？
- 是否需要旁白？旁白是否必须同一声线？
- 是否需要角色对白？
- 哪些是全局音频锚点，哪些是局部音效？
- 是否应禁止视频模型自己生成随机人声或随机音乐？

## 6. Consistency Manifest 升级

当前 `visual_lock` 更适合产品/道具，不够适合人物、卡通角色、品牌视觉和空间布局。建议扩展成通用基础字段 + 类型专属字段。

### 6.1 基础结构

```json
{
  "id": "main_character",
  "type": "person | product | prop | location | style | brand_visual | task_object | effect_state | vehicle | food | space_layout | audio | custom",
  "display_name_zh": "",
  "display_name_en": "",
  "must_stay_consistent": true,
  "needs_reference_image": true,
  "reference_strength": "hard | medium | soft",
  "description_zh": "",
  "description_en": "",
  "visual_lock": {},
  "audio_lock": {},
  "applies_to": ["keyframes", "segments", "micro_shots"],
  "user_editable": true,
  "image_prompt_zh": "",
  "image_prompt_en": ""
}
```

### 6.2 人物/角色锁定字段

对真人、卡通角色、IP 形象、动物 mascot 都应锁定：

```json
{
  "character_lock": {
    "species_or_identity": "",
    "face_shape": "",
    "eyes": "",
    "nose": "",
    "mouth": "",
    "hair_or_fur": "",
    "body_proportion": "",
    "skin_or_fur_color": "",
    "clothing": {
      "top_color": "",
      "bottom_color": "",
      "length": "",
      "pattern": "",
      "material": "",
      "accessories": []
    },
    "signature_items": [],
    "forbidden_drift": []
  }
}
```

这能覆盖我们之前遇到的牛仔牛角色漂移问题：角、帽子、围巾、蓝外套、徽章、肚子比例、鼻子大小等都应成为结构化锁定字段，而不是泛泛写一句“same mascot”。

### 6.3 产品/道具锁定字段

```json
{
  "object_lock": {
    "shape": "",
    "size": "",
    "material": "",
    "color": "",
    "logo_or_label": "",
    "surface_details": "",
    "state": "",
    "allowed_state_changes": [],
    "forbidden_drift": []
  }
}
```

### 6.4 品牌视觉锁定字段

```json
{
  "brand_visual_lock": {
    "logo_shape": "",
    "logo_text": "",
    "brand_colors": [],
    "typography_style": "",
    "layout_rules": "",
    "forbidden_text_errors": []
  }
}
```

注意：品牌视觉可以作为图片参考锚点，但图片/视频模型仍不可靠渲染文字。真实字幕和文字应尽量走后期叠加或 UI 层生成。

### 6.5 空间布局锁定字段

```json
{
  "space_layout_lock": {
    "location_type": "",
    "main_zones": [],
    "fixed_objects": [],
    "camera_axis_options": [],
    "lighting_direction": "",
    "forbidden_layout_changes": []
  }
}
```

## 7. Audio Bible 新增

ViMax 只有 `audio_desc`，它自己也说明没有独立 TTS、BGM、混音模块。我们当前也遇到了音频一致性问题，所以不能只照搬 `audio_desc`。

建议阶段 1 输出项目级 `audio_bible`：

```json
{
  "audio_bible": {
    "needs_audio": true,
    "global_bgm_required": true,
    "bgm_style_zh": "",
    "bgm_style_en": "",
    "bgm_mood_curve": [
      {
        "start_seconds": 0,
        "end_seconds": 5,
        "mood": ""
      }
    ],
    "voiceover_required": false,
    "voice_lock_required": false,
    "voice_language": "",
    "voice_gender": "",
    "voice_age": "",
    "voice_tone": "",
    "voice_speed": "",
    "dialogue_required": false,
    "sfx_policy": "",
    "forbidden_audio_drift": [
      "no random narrator voice",
      "no changing music genre between segments",
      "no unrelated dialogue generated by video model"
    ],
    "post_production_strategy": "strip_clip_audio_and_add_global_mix"
  }
}
```

后续每段 `audioPlan` 只描述局部事件：

```json
{
  "mode": "ambient | voiceover | dialogue | mixed | silent",
  "inherits_audio_bible": true,
  "local_sfx": [],
  "voiceover_lines_zh": [],
  "voiceover_lines_en": [],
  "ducking_required": false,
  "rationale": ""
}
```

推荐策略：

- 视频片段生成阶段默认禁止模型生成随机人声、歌词、突变 BGM。
- 最终合成阶段剥离每段原音轨。
- 使用统一 BGM、统一 TTS 声线、统一音效层做后期混音。

## 8. 阶段 2：Storyboard Writer 改造

阶段 2 的目标不是写最终 prompt，而是生成渲染可执行的结构化镜头合同。

### 8.1 输出结构

```json
{
  "storyboard_plan": {
    "title": "",
    "logline": "",
    "style_bible": {},
    "storyboard_brief": [],
    "camera_graph": {},
    "keyframes": [],
    "segments": [],
    "subtitle_plan": {},
    "audio_plan": {}
  }
}
```

### 8.2 Storyboard Brief

借鉴 ViMax 的 `storyboard.json`，每段先有一个简洁分镜草案：

```json
{
  "segment_no": 1,
  "is_last": false,
  "camera_id": "cam_01",
  "visual_desc_zh": "",
  "visual_desc_en": "",
  "audio_desc_zh": "",
  "required_anchor_ids": [],
  "beat_role": "hook"
}
```

它回答：

- 这段主要看什么？
- 叙事功能是什么？
- 使用哪个机位？
- 大概声音意图是什么？
- 依赖哪些一致性锚点？

### 8.3 Segment Render Description

借鉴 ViMax 的 `shot_description.json`，每个 segment 必须输出：

```json
{
  "segment_no": 1,
  "camera_id": "cam_01",
  "start_frame_contract": {
    "keyframe_no": 1,
    "static_description_zh": "",
    "visible_anchor_ids": [],
    "composition": "",
    "lighting": "",
    "forbidden_elements": []
  },
  "end_frame_contract": {
    "keyframe_no": 2,
    "static_description_zh": "",
    "visible_anchor_ids": [],
    "composition": "",
    "lighting": "",
    "forbidden_elements": []
  },
  "motion_contract": {
    "motion_desc_zh": "",
    "subject_path": "",
    "prop_paths": [],
    "camera_path": "",
    "environment_motion": "",
    "variation_type": "small | medium | large",
    "variation_reason_zh": ""
  },
  "single_take_contract": {
    "continuous_time": true,
    "requires_cut": false,
    "physically_reachable": true,
    "risk_level": "low | medium | high",
    "risk_reasons": []
  },
  "motion_checkpoints": []
}
```

注意：这里建议把 `micro_shots` 在语义上改名为 `motion_checkpoints`。前端仍可兼容显示“子分镜”，但提示词和内部结构应减少 `shot` 这个词带来的误导。

### 8.4 Motion Checkpoints

```json
{
  "checkpoint_no": 1,
  "local_time_seconds": 0,
  "subject_state": "",
  "anchor_states": [
    {
      "anchor_id": "hero_product",
      "state": "",
      "position": "",
      "holder": ""
    }
  ],
  "camera_progress": 0,
  "action_delta": "",
  "continuity_from_previous": "",
  "reference_type": "text | image_prompt | mixed",
  "image_prompt_zh": "",
  "image_prompt_en": ""
}
```

它描述的是同一条运动路径上的检查点，而不是几个小镜头。

### 8.5 Camera Graph

借鉴 ViMax 的 `camera_tree.json`，但用 graph 更贴近我们多段广告/短视频结构：

```json
{
  "camera_graph": {
    "nodes": [
      {
        "camera_id": "cam_01",
        "covered_segment_nos": [1, 2],
        "parent_camera_id": null,
        "parent_segment_no": null,
        "axis_description": "",
        "framing_range": "",
        "movement_style": "",
        "spatial_layout_lock": "",
        "is_parent_fully_covers_child": true,
        "missing_info": [],
        "inheritance_reason_zh": ""
      }
    ]
  }
}
```

后续生成 keyframe 和视频 prompt 时，应注入 camera graph 的继承规则。

### 8.6 Transition Reference Plan

ViMax 的新增文档里提到一个很实用的机制：当新机位依赖父机位时，先生成一个 transition video，再从 transition video 里抽取“新机位参考图”。这个视频不一定进入最终成片，它更像中间素材，用来帮助后续关键帧保持背景、空间和风格连续。

我们当前不一定马上实现 transition video，但应该在剧本拆解结构里预留 `transition_reference_plan`：

```json
{
  "transition_reference_plan": [
    {
      "from_camera_id": "cam_01",
      "to_camera_id": "cam_02",
      "from_segment_no": 1,
      "to_segment_no": 2,
      "needed": true,
      "reason_zh": "新机位需要继承庭院空间布局，但景别从中景变为近景，需要过渡参考图。",
      "source_reference_keyframe_no": 1,
      "target_usage": "scene_layout | composition | lighting | character_position",
      "prompt_zh": "",
      "generated_reference_url": ""
    }
  ]
}
```

短期可以先不生成 transition video，而是把父机位关键帧直接作为候选参考图；中期再实现：

```text
父机位关键帧
  -> transition reference video
  -> 抽帧得到新机位参考图
  -> 新机位关键帧生成时强制作为布局参考
```

注意：这种图只能用于空间、构图和光线继承。如果里面的人物、产品或文字不准确，必须由 anchor 参考图替换，不能把错误元素继续扩散。

### 8.7 Stage 2 Prompt 边界补充

ViMax 把分镜设计 prompt 和镜头拆解 prompt 分开：前者像“专业分镜师”，后者像“视觉文本分析师”。我们仍保留三阶段，但阶段 2 内部应该明确两个子任务边界：

```text
Storyboard Brief 子任务：
  把故事变成 segment 列表，决定每段看什么、属于哪个机位、有哪些声音意图。

Segment Render Description 子任务：
  把每个 segment 拆成 start_frame_contract、end_frame_contract、motion_contract、visible_anchor_ids、variation_type。
```

阶段 2 prompt 应增加这些硬规则：

- 每个 `storyboard_brief.visual_desc` 必须独立完整，不能写“同上一段”“继续上一镜头”。
- 只写画面中可见的角色、产品和道具，不可见的不要放入 `visible_anchor_ids`。
- 角色/锚点名称必须来自 `consistency_manifest.anchors`，新增对象必须进入 `proposed_new_anchors`，不能临时发明。
- 如果有对白，一个 segment 内每个角色最多一句，且对白应进入 `audioPlan` 或字幕策略，不要让图片模型渲染台词文字。
- `start_frame_contract` 和 `end_frame_contract` 必须是静态画面描述，不能包含“正在”“逐渐”“即将”等运动过程。
- `motion_contract` 才能描述从首帧到尾帧的运动，必须区分摄影机运动、主体运动、道具运动。
- `variation_type` 必须解释为什么是 `small`、`medium` 或 `large`。

## 9. Single-take Audit

在阶段 2 之后、阶段 3 之前，必须有单独审计。它不负责写好看的 prompt，只判断 segment 是否真的能一镜到底。

输入：

- `segment_render_description`
- `start_frame_contract`
- `end_frame_contract`
- `motion_contract`
- `motion_checkpoints`
- `camera_graph`
- `visible_anchor_ids`

输出：

```json
{
  "segment_no": 2,
  "passed": false,
  "requires_cut": true,
  "risk_level": "high",
  "reasons": [],
  "recommended_split": [
    {
      "purpose_zh": "",
      "duration_seconds": 4
    }
  ],
  "simplification_suggestion": ""
}
```

规则：

- `requires_cut=true` 或 `risk_level=high` 时不能继续进入视频生成。
- 没有 `recommended_split` 时，应调用 Split Repair。
- 最多修复 3 轮。
- 仍失败则阻止生成，并提示用户简化动作或修改分镜。

## 10. 阶段 3：Prompt Detailer 改造

阶段 3 只做 prompt 编译，不重写故事和结构。

输入：

```json
{
  "planning_manifest": {},
  "approved_anchor_images": [],
  "storyboard_plan": {},
  "camera_graph": {},
  "segment_render_descriptions": [],
  "single_take_audit": {},
  "user_edits": {}
}
```

输出：

```json
{
  "prompt_detail_plan": {
    "keyframe_prompts": [],
    "segment_video_prompts": [],
    "motion_checkpoint_image_prompts": [],
    "negative_prompt_groups": [],
    "reference_usage_plan": [],
    "generation_notes": []
  }
}
```

阶段 3 必须遵守：

- 不改 segment 数量、时长、起止关键帧。
- 不改 anchor identity。
- 不改字幕策略和音频策略。
- 不把字幕要求写成“画面内文字”。
- 不把 `motion_checkpoints` 写成剪辑点。
- 每个 prompt 明确引用哪些 anchor 图片。
- 每个视频 prompt 都包含 single-take contract。
- 每个视频 prompt 都禁止内部 cut、dissolve、montage、scene swap。
- 每个视频 prompt 都禁止随机音频漂移，最终音频由后期统一处理。

### 10.1 图片 Prompt 不应直接等于帧描述

ViMax 的新增内容强调：关键帧图片 prompt 不是直接把 `ff_desc/lf_desc` 丢给图片模型，而是由参考图选择器加工成：

```text
Image 0: 参考图说明
Image 1: 参考图说明
...

ReferenceImageSelector 生成的 text_prompt
```

我们应采用类似的 Prompt Compiler 结构：

```json
{
  "keyframe_prompt_compilation": {
    "keyframe_no": 1,
    "frame_contract_source": "start_frame_contract",
    "reference_candidates": [],
    "selected_reference_urls": [],
    "reference_usage_notes": [
      "Image 0 is identity reference for main_character.",
      "Image 1 is scene layout reference for courtyard_scene."
    ],
    "text_prompt": "",
    "negative_prompt": ""
  }
}
```

最终图片模型收到的内容应包含：

- 当前帧静态画面描述；
- 选中的参考图 URL；
- 每张参考图的用途说明；
- 哪些内容必须继承；
- 哪些内容不得继承；
- 字幕、UI、水印、错误文字的负面约束。

这能避免一个常见问题：参考图里某个元素是错的，但模型不知道它应该继承背景还是继承人物，最后把错误也复制进新图。

### 10.2 视频 Prompt 只使用 Motion Contract，不重复完整 Visual Desc

ViMax 的视频 prompt 主要由：

```text
motion_desc + audio_desc
```

而不是完整 `visual_desc`。原因是完整视觉描述容易同时包含起点、终点、运动、情绪、对话、背景，视频模型会自己猜路径。

我们的 HappyHorse 视频 prompt 应改为：

```text
start boundary frame: 由图片输入提供，是 HappyHorse 的硬输入
end boundary frame: HappyHorse 不接收 last_frame；尾帧只能作为文字软目标、审核参考和一致性约束，不是硬输入
motion_contract: 主要运动指令
single_take_contract: 一镜到底硬约束
motion_checkpoints: 同一运动路径上的中间状态
audio_policy: 禁止随机人声/随机音乐，最终音频后期统一处理
```

也就是说，视频 prompt 不应再堆大量画面设定，而要让模型做一件事：

```text
从首帧硬输入出发，按 motion_contract 连续运动，并尽量朝 end_frame_contract 描述的尾帧状态靠近。
```

因此，文档中的 `end_frame_contract` 不能被理解为 HappyHorse 的真实尾帧输入。它在当前项目里的作用是：

- 供用户审核该 segment 的结束状态是否合理；
- 供一镜到底审计判断首尾状态是否物理可达；
- 供视频 prompt 写入“软目标”；
- 供后续如果切换到支持首尾帧的模型时复用；
- 供关键帧/片段间连续性检查使用。

当前 HappyHorse 真实输入关系应按下面理解：

```text
Keyframe N 图片：硬输入 first_frame
Keyframe N+1 图片：不作为 HappyHorse 输入，只作为 end_frame_contract 的视觉参考和软约束来源
Video prompt：motion_contract + single_take_contract + motion_checkpoints + end_frame soft target
```

### 10.3 Prompt 调试产物

参考 ViMax 的 `first_frame_selector_output.json` / `last_frame_selector_output.json`，我们建议记录：

```json
{
  "prompt_debug_artifacts": {
    "keyframe_prompt_compilations": [],
    "motion_checkpoint_prompt_compilations": [],
    "segment_video_prompt_compilations": [],
    "reference_selection_outputs": [],
    "prompt_conflict_cleanup_logs": []
  }
}
```

这些内容可以先存在 `planJson` 或日志中，后续再做 UI 展示。它的价值是：当某一张图或某段视频生成错误时，可以定位到底是：

- 拆解描述错；
- 可见锚点漏选；
- 参考图选错；
- prompt 误用了参考图；
- 视频 prompt 缺少运动约束；
- 负面约束不足；
- 用户编辑后没有同步回 `planJson`。

## 11. 用户审核节点改造

推荐从当前审核流程升级为：

```text
1. 任务 / 时间骨架 / 一致性锚点审核
   用户确认任务理解、segment 数量、时长、anchors、字幕策略、音频策略。

2. 一致性参考图审核
   先生成人物、产品、品牌视觉、场景等 anchor 参考图。
   用户可修改 prompt、重生成、锁定。

3. 详细分镜审核
   用户确认 keyframes、segments、motion checkpoints、camera graph、subtitle、audio plan。

4. 边界关键帧审核
   普通关键帧必须引用已锁定的一致性参考图。

5. 子分镜 / motion checkpoint 审核
   用户确认文字限制、图片限制、参考图生成结果。

6. 视频片段审核
   用户确认每段视频是否一镜到底、是否保持一致性。

7. 音频 / 字幕 / 最终合成审核
   用户确认后期字幕、BGM、旁白、音效和最终成片。
```

短期如果不想增加太多 UI，可以先把第 1 和第 2 步合并为“剧本与一致性资产审核”，但后端逻辑仍应先生成并锁定一致性参考图，再生成普通关键帧。

## 12. 后端数据落地建议

第一版可以继续放在 `VideoProject.planJson`，避免立刻改 Prisma schema：

```json
{
  "planningManifest": {},
  "consistencyManifest": {},
  "audioBible": {},
  "storyboardBrief": [],
  "cameraGraph": {},
  "transitionReferencePlan": [],
  "segmentRenderDescriptions": [],
  "singleTakeAudit": {},
  "promptDetailPlan": {},
  "referenceSelectionOutputs": [],
  "promptDebugArtifacts": {},
  "keyframes": [],
  "segments": []
}
```

后续如果要更强的编辑和追踪，再新增表：

- `VideoConsistencyAnchor`
- `VideoConsistencyAnchorImage`
- `VideoAnchorReferenceView`
- `VideoCameraNode`
- `VideoTransitionReference`
- `VideoSegmentRenderDescription`
- `VideoMotionCheckpoint`
- `VideoReferenceSelectionOutput`
- `VideoPromptCompilation`
- `VideoAudioAsset`
- `VideoStoryboardRevision`

## 13. 后端校验规则

建议增加这些硬校验：

时间线：

- segment 时长必须在 3-15 秒。
- 总时长必须等于项目时长。
- keyframes 数量必须等于 segments + 1。
- start/end keyframe 编号必须连续。

一致性：

- 每个 keyframe/segment/motion checkpoint 必须有 `uses_consistency_anchors`。
- 引用的 anchor id 必须存在。
- `reference_strength=hard` 且 `needs_reference_image=true` 的 anchor 必须先生成并锁定参考图。
- 普通关键帧不能早于硬一致性参考图生成。
- 如果 keyframe 的 `visible_anchor_ids` 包含 hard anchor，最终 `referenceSelectionOutputs` 必须选中对应 anchor 图片。
- 如果 `person` anchor 配置了三视图，当前帧的角色朝向应选择最接近的 view；无法判断时使用 `front` 或 `three_quarter`，并记录原因。
- 参考图选择器不能把 `style` 参考图当成 identity 参考图，也不能把带错误文字的图当成 brand text 权威参考。

一镜到底：

- `requires_cut=true` 禁止进入视频生成。
- `risk_level=high` 禁止进入视频生成，除非被 Split Repair 修复。
- motion checkpoint 不允许出现 cut、switch angle、montage、dissolve、scene transition 等词。
- `start_frame_contract` 和 `end_frame_contract` 不允许写运动过程。
- `motion_contract` 必须至少包含主体运动或摄影机运动之一；如果完全为空，视频 prompt 只能做轻微环境运动。

音频：

- 如果 `audio_bible.post_production_strategy=strip_clip_audio_and_add_global_mix`，最终合成应剥离片段原音轨。
- 如果需要旁白，旁白文案必须来自全局脚本或 segment audio plan，不能依赖视频模型随机生成。

字幕：

- 图片 prompt 和视频 prompt 都禁止要求模型渲染字幕。
- 字幕只作为后期 overlay/burn-in 文案。

参考图选择：

- 每个关键帧生成任务必须记录候选参考图、选中参考图、用途说明和最终 text prompt。
- 候选参考图超过阈值时，应先做文本筛选，再做多模态筛选；用户上传的开局参考图和 hard anchor 图不能被第一轮文本筛选误删。
- 父机位/transition reference 图如果被选中，必须标注“只继承空间/构图/光线，不继承错误人物、错误产品或错误文字”。

## 14. Prompt 组织建议

### 14.1 阶段 1 提示词新增重点

```text
You must produce production-grade intermediate planning artifacts.
Do not write final image or video prompts.
Identify all consistency anchors dynamically.
For each anchor, decide whether it needs a reference image, text lock, audio lock, or no lock.
Create a candidate timeline only if every segment can be a single continuous take.
Define global audio policy; do not leave audio consistency to per-segment video generation.
```

### 14.2 阶段 2 提示词新增重点

```text
For every segment, decompose it into:
start_frame_contract,
end_frame_contract,
motion_contract,
single_take_contract,
motion_checkpoints.

Do not use micro_shots as separate shots.
They are motion checkpoints inside one continuous take.

Assign a camera_id to every segment.
Construct a camera_graph that explains camera inheritance and missing information.

The storyboard brief and segment render description are different artifacts:
- storyboard_brief explains what the segment is about;
- segment_render_description explains how to render first frame, last frame, and motion.

Visible anchors must only include objects actually visible in the frame.
If a recurring object appears but is not in consistency_manifest, return proposed_new_anchors.
```

### 14.3 阶段 3 提示词新增重点

```text
Compile prompts only.
Do not rewrite timeline, anchors, audio bible, subtitles, or camera graph.
Inject only the anchors used by the current keyframe/segment/checkpoint.
Do not let generated images/videos contain subtitles, UI text, watermark, or timeline labels.
For video prompts, state that final audio will be added in post-production unless audio is explicitly allowed.

For image prompts, create a reference usage plan:
- which reference image is used for identity,
- which reference image is used for product,
- which reference image is used for scene layout,
- which reference image is used only for style.

Do not blindly inherit every detail from reference images.
Explain what should be inherited and what should be ignored.
```

## 15. 迁移步骤

建议按风险从低到高推进：

1. 文档和类型层增加 `audioBible`、`cameraGraph`、`transitionReferencePlan`、`segmentRenderDescriptions`、`motionCheckpoints`。
2. 阶段 1 prompt 增加 `audio_bible`、更细的 anchor 类型专属锁定字段、是否需要角色三视图的判断。
3. 阶段 2 prompt 增加 `storyboard_brief` 和 `segment_render_description` 的明确分工。
4. 阶段 2 prompt 增加 `start_frame_contract`、`end_frame_contract`、`motion_contract`、`variation_type`、`visible_anchor_ids`、`camera_id`、`camera_graph`。
5. 后端归一化保留这些新字段到 `planJson`，先不急着新增表。
6. 先实现硬一致性 anchor 图片优先生成和锁定；`person` anchor 可先支持一张主参考图，再扩展三视图。
7. 增加 `referenceSelectionOutputs` 调试结构，记录关键帧/子分镜图生成时的候选参考图、选中参考图、用途说明和最终 text prompt。
8. 改造图片 Prompt Compiler：最终图片 prompt = 参考图用途说明 + 静态帧描述 + text prompt + negative prompt，而不是直接使用 keyframe image prompt。
9. 普通关键帧生成前，强制等待 hard anchor 参考图生成并锁定；生成时只传当前帧实际可见锚点相关参考图。
10. Prompt compiler 注入 `cameraGraph`、`visible_anchor_ids`、`singleTakeContract`、`audioBible` 和 `referenceSelectionOutputs`。
11. 将 `microShots` UI 文案逐步迁移为“子分镜 / 运动检查点”，内部结构优先使用 `motionCheckpoints`。
12. 增加 Single-take Audit，失败时 Split Repair，达到最大轮次仍失败则阻止生成。
13. 增加父机位继承策略：短期用父关键帧作为候选参考图；中期实现 `transitionReferencePlan`，用 transition video 抽帧作为新机位参考图。
14. 增加视频 Prompt Compiler 规则：视频 prompt 主要使用 `motion_contract + single_take_contract + motion_checkpoints`，不要重复堆完整 visual desc。
15. 增加音频后期策略：剥离片段原音轨，统一加 BGM/TTS/SFX。
16. 增加调试 UI 或日志入口：展示某张图的 `referenceSelectionOutputs`、最终 prompt、选中参考图和被忽略参考图原因。
17. 后续再考虑新增数据库表，把 anchor、camera、checkpoint、reference selection、prompt compilation、audio asset 从 `planJson` 中拆出来。

### 15.1 推荐的首批落地顺序

如果要控制风险，建议第一批只做这些：

```text
1. 阶段 2 输出 visible_anchor_ids / start_frame_contract / end_frame_contract / motion_contract。
2. 后端保存 segmentRenderDescriptions。
3. 图片生成前根据 visible_anchor_ids 选择 anchor 参考图。
4. 记录 referenceSelectionOutputs。
5. 视频 prompt 改为优先使用 motion_contract。
```

这一批不需要马上做 transition video、三视图、TTS 或新增数据库表，但已经能明显提升人物/产品一致性和一镜到底可控性。

### 15.2 第二批落地顺序

```text
1. person anchor 支持 front / side / back / three_quarter 多视图。
2. cameraGraph 参与关键帧参考图选择。
3. 父机位关键帧作为新机位候选参考图。
4. promptDebugArtifacts 展示到前端调试窗口。
5. Single-take Audit 和 Split Repair 阻断高风险 segment。
```

### 15.3 第三批落地顺序

```text
1. transitionReferencePlan 生成过渡参考素材。
2. 从 transition reference video 抽帧作为新机位参考图。
3. 建立统一音频后期链路：BGM / TTS / SFX / loudnorm / ducking。
4. 将高频调试产物拆出独立数据表，支持局部重跑和版本比较。
```

## 16. 最终推荐架构

最终目标结构如下：

```text
用户输入
  -> Planning Manifest
      - task intent
      - timeline blueprint
      - consistency manifest
      - audio bible
      - subtitle policy

  -> Anchor Assets
      - character reference image
      - optional character front / side / back views
      - product/reference image
      - brand visual reference
      - scene/layout reference

  -> Storyboard Plan
      - storyboard brief
      - keyframe contracts
      - segment render descriptions
      - camera graph
      - transition reference plan
      - motion checkpoints

  -> Audits
      - anchor validation
      - timeline validation
      - single-take audit
      - prompt conflict cleanup

  -> Reference Selection
      - candidate reference images
      - selected reference images
      - reference usage notes
      - selector text prompt

  -> Prompt Detail Plan
      - keyframe prompts
      - checkpoint image prompts
      - video prompts
      - negative prompts
      - reference usage plan
      - prompt debug artifacts

  -> Generation
      - anchor images first
      - boundary keyframes
      - checkpoint reference images
      - optional transition reference frames
      - HappyHorse video clips
      - subtitle burn-in
      - unified audio mix
      - final compose
```

一句话总结：

> ViMax 的价值不在于它的具体文件名，而在于它把剧本拆解变成了一组清晰、可校验、可恢复、可被后续生成消费的中间产物。我们应该保留当前三阶段架构，但把阶段 2 的输出升级为 ViMax 式的“首帧、尾帧、运动、机位、可见锚点、变化幅度、音频策略、参考图选择计划”的生产合同，并让每次图片/视频生成都留下可调试的 prompt 编译产物。
