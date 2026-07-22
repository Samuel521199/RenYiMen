# 一句话成片：剧情设计与连贯性改进方案

## 1. 文档目的

本文专门用于解决一句话成片中“剧情设计生硬、不连贯、只是让参考图动起来”的问题。

典型失败样例：

- 用户要做游戏广告，但系统只是把参考图拆成几段动态画面。
- 角色突然赢了、突然庆祝，中间没有铺垫、选择、压力、反转和爽点释放。
- 参考图被当成“剧情本身”，而不是人物、场景、产品、品牌视觉等可复用资产。
- 分镜看起来完整，但观众感受不到为什么要继续看，也没有明确的广告转化动机。

本文的结论是：这不是单纯“剧本拆解 prompt 写得不好”的问题，而是工程结构不够精细。Prompt 需要改，但更关键的是把广告创意、剧情因果、分镜拆解、质量审核拆成明确阶段，并让后续流程不能跳过这些阶段。

## 2. 问题判断

### 2.1 Prompt 问题只占一部分

如果只是 prompt 写得不好，通常表现为：同一个流程结构下，文字不够精彩、描述不够细、镜头语言不够强。

但当前问题更严重：系统没有被迫先做广告创意判断，再做剧情因果设计，最后才做分镜执行。它可以直接从“用户需求 + 参考图”跳到“分镜和边界帧”，这会天然鼓励模型偷懒。

参考图越强，模型越容易把任务理解成：

```text
复现参考图
  -> 让参考图中的角色动起来
  -> 拼成一条视频
```

而一个游戏广告真正应该是：

```text
设计让人想看的广告爽点
  -> 设计冲突、压力、选择、反转和奖励释放
  -> 决定需要哪些人物、场景、道具、UI、Logo 资产
  -> 再生成边界帧、子分镜和视频片段
```

### 2.2 当前核心缺口

| 缺口 | 当前表现 | 后果 |
|---|---|---|
| 缺广告创意策略层 | 直接从用户需求进入分镜 | 分镜只是信息展示，不像广告 |
| 缺剧情 beat sheet | 没有 hook/conflict/turning point/payoff/CTA | 胜利和转化显得突然 |
| 缺剧情功能字段 | 镜头只描述画面，不说明剧情作用 | 每个镜头都漂亮但没有因果 |
| 缺质量门禁 | 分镜生成后不检查剧情是否成立 | 烂剧情也能进入资产/边界帧 |
| 参考图权重过高 | 参考图被当成目标画面而非资产 | 只会“让图动起来” |
| 视频模型职责错位 | 期待 i2v 模型补剧情 | 视频模型只能执行首尾帧之间的运动 |

## 3. 设计原则

### 3.1 工程结构优先，Prompt 作为执行细节

建议将问题归因为：

- 70% 是工程结构问题：缺少强制阶段、结构化字段、审核门禁和重写机制。
- 30% 是 prompt 问题：提示词没有足够明确地要求钩子、冲突、转折、爽点、CTA 和因果链。

只改 prompt 可以短期改善，但不稳定。模型可能这次写得像广告，下次又退回“参考图动起来”。工程结构要负责“不能跳步骤”，prompt 负责“每一步写得好”。

### 3.2 参考图只能是资产，不是剧情

所有 Planner 必须遵守：

```text
用户上传的参考图用于定义资产库中的人物、场景、产品、道具、Logo、品牌视觉和风格。
参考图不能替代广告剧情。
不得只围绕参考图做浅层动画，必须重新设计符合广告目标的剧情因果链。
```

### 3.3 视频模型只执行，不负责创作剧情

当前视频模型被限定为 `happyhorse-1.1-i2v` 时，系统不能假设视频模型会自动理解完整广告叙事。剧情、转折和情绪递进必须在前置规划中完成：

- 创意策略阶段定义广告爽点。
- Beat sheet 定义因果链。
- 分镜阶段把每个镜头绑定到具体剧情功能。
- 边界帧阶段把剧情节点变成可视画面。
- i2v 阶段只负责把首尾帧之间顺滑运动起来。

## 4. 目标流程

### 4.1 当前流程

```text
用户需求 + 参考图
  -> 一次性生成分镜
  -> 资产库 / 边界帧
  -> 视频片段
  -> 成片
```

问题：模型可以直接跳过广告创意和剧情因果，导致“参考图动起来”。

### 4.2 目标流程

```text
用户需求 + 参考图
  -> 广告创意策略
  -> 剧情 beat sheet
  -> 分镜拆解
  -> 资产库
  -> 边界参考帧
  -> 子分镜
  -> 视频片段
  -> 成片
```

关键变化：

1. 先确定“这个广告为什么值得看”。
2. 再确定“剧情如何推进、观众情绪如何变化”。
3. 再决定“需要哪些画面和资产”。
4. 最后才进入图像和视频生成。

## 5. 新增阶段一：广告创意策略

广告创意策略阶段负责判断广告类型、目标用户、转化目标和创意钩子。

### 5.1 输入

- 用户原始 prompt。
- 上传参考图的摘要。
- 项目类型：游戏、应用、产品、电商、短剧、本地生活等。
- 时长、比例、语言、风格。
- 已有资产或品牌约束。

### 5.2 输出字段

建议在 `planJson` 中新增或规范化以下结构：

```json
{
  "creativeStrategy": {
    "adCategory": "game",
    "targetAudience": "casual mobile card game players",
    "conversionGoal": "download",
    "corePromise": "轻松触发 bonus，逆风也能爽快翻盘",
    "hook": "主角只剩最后一枚金币，对手已经开始嘲笑",
    "conflict": "牌局进入最后一轮，主角看起来必输",
    "turningPoint": "主角大胆 double up，触发 bonus round",
    "payoff": "金币爆发、排行榜反超、围观角色震惊",
    "cta": "立即下载，挑战你的翻盘时刻",
    "referencePolicy": "参考图仅作为人物、场景、品牌视觉资产，不作为剧情替代品"
  }
}
```

### 5.3 游戏广告模板

游戏广告应至少支持以下创意模板：

| 模板 | 结构 | 适用场景 |
|---|---|---|
| 逆风翻盘型 | 快输 -> 关键选择 -> bonus/连击 -> 反超 | 棋牌游戏、休闲闯关 |
| 社交炫耀型 | 被朋友质疑 -> 赢大奖 -> 朋友围观震惊 | 社交棋牌、派对游戏 |
| 新手爽感型 | 第一次玩 -> 操作简单 -> 连续奖励 | 低门槛休闲游戏 |
| 稀有奖励型 | 差一点失败 -> 触发稀有机制 -> jackpot | Slot、抽卡、bonus 类广告 |
| 角色喜剧型 | 角色笨拙开局 -> 意外做对 -> 爆笑获胜 | 动物、卡通角色广告 |
| 挑战通关型 | 关卡压力 -> 一步选择 -> 通关展示 | 益智、消除、闯关 |

Planner 不应随机选择模板，而应根据用户 prompt、参考图和广告目标选择最匹配的模板，并记录选择理由。

## 6. 新增阶段二：剧情 Beat Sheet

Beat sheet 是分镜前的剧情骨架。它必须先于分镜存在。

### 6.1 必需字段

```json
{
  "storyBeats": [
    {
      "beatId": "beat_01_hook",
      "beatType": "hook",
      "timeRangeSeconds": [0, 3],
      "storyEvent": "水牛主持人只剩最后一枚金币，对手已经露出得意表情",
      "emotionalIntent": "压力、好奇、停留观看",
      "viewerQuestion": "它真的还能翻盘吗？",
      "requiredAssets": ["main_buffalo", "card_table", "opponent", "coin"],
      "mustNotDo": ["不要直接展示胜利", "不要提前出现下载按钮"]
    },
    {
      "beatId": "beat_02_conflict",
      "beatType": "conflict",
      "timeRangeSeconds": [3, 8],
      "storyEvent": "最后一轮发牌，水牛手牌看起来很弱，对手筹码明显更多",
      "emotionalIntent": "劣势、紧张",
      "viewerQuestion": "它会怎么选？",
      "requiredAssets": ["main_buffalo", "cards", "opponent_chips"]
    },
    {
      "beatId": "beat_03_turning_point",
      "beatType": "turning_point",
      "timeRangeSeconds": [8, 15],
      "storyEvent": "水牛按下 DOUBLE UP BONUS，桌面灯效爆发",
      "emotionalIntent": "期待、反转",
      "viewerQuestion": "bonus 会带来什么？",
      "requiredAssets": ["double_up_button", "bonus_vfx", "cards"]
    },
    {
      "beatId": "beat_04_payoff",
      "beatType": "payoff",
      "timeRangeSeconds": [15, 24],
      "storyEvent": "金币和奖励爆发，水牛反超排行榜，对手震惊",
      "emotionalIntent": "爽感、释放、炫耀",
      "viewerQuestion": "我也能这样赢吗？",
      "requiredAssets": ["main_buffalo", "coin_burst", "leaderboard", "opponent_reaction"]
    },
    {
      "beatId": "beat_05_cta",
      "beatType": "cta",
      "timeRangeSeconds": [24, 30],
      "storyEvent": "游戏 Logo 和下载按钮出现，水牛邀请观众加入下一局",
      "emotionalIntent": "行动、转化",
      "viewerQuestion": "现在就试试？",
      "requiredAssets": ["game_logo", "download_button", "main_buffalo"]
    }
  ]
}
```

### 6.2 Beat 类型枚举

建议支持：

- `hook`
- `setup`
- `conflict`
- `decision`
- `turning_point`
- `payoff`
- `social_proof`
- `product_proof`
- `cta`

游戏广告至少必须包含：

```text
hook -> conflict -> decision/turning_point -> payoff -> cta
```

## 7. 分镜阶段改造

分镜不能只描述“画面是什么”，必须绑定剧情功能。

### 7.1 每个镜头必需字段

```json
{
  "shotNo": 1,
  "linkedBeatIds": ["beat_01_hook"],
  "storyFunction": "hook_conflict",
  "emotionalBeat": "主角快输、对手压迫、观众产生好奇",
  "cause": "主角只剩最后一枚金币",
  "effect": "观众知道主角处于劣势，等待下一步选择",
  "visualGoal": "水牛在牌桌前紧张但不服输，对手筹码堆高",
  "mustShow": ["最后一枚金币", "对手得意", "主角压力"],
  "mustNotShow": ["主角已经获胜", "奖励爆发", "下载按钮"],
  "transitionIntent": "从压力局面推进到关键选择"
}
```

### 7.2 分镜验收规则

分镜生成后必须通过以下规则，才能进入资产库和边界帧：

- 每个 shot 必须至少引用一个 `storyBeat`。
- 每个 shot 必须有 `storyFunction`。
- 相邻 shot 之间必须有因果或情绪递进。
- `payoff` 不能出现在 `conflict` 之前。
- `cta` 不能早于最后 20% 时长，除非广告类型明确要求。
- 不能出现“突然赢了”“突然下载”“突然出现大奖”等无铺垫事件。
- 不能只把参考图描述成动态镜头。

## 8. 边界帧阶段改造

边界帧不是“漂亮静态图”，而是剧情节点的可视化证据。

### 8.1 边界帧必须服务 beat

每个边界帧应包含：

```json
{
  "keyframeNo": 2,
  "linkedBeatId": "beat_03_turning_point",
  "storyMoment": "水牛按下 DOUBLE UP BONUS 的瞬间",
  "narrativeStateBefore": "主角仍然处于劣势",
  "narrativeStateAfter": "bonus 被触发，反转开始",
  "requiredVisibleEvidence": ["DOUBLE UP BONUS", "主角手部动作", "桌面灯效开始爆发"],
  "forbiddenEvidence": ["最终获胜结果", "下载按钮提前出现"]
}
```

### 8.2 首尾帧与剧情关系

对于 i2v 片段，起始边界帧和结束边界帧必须表达一个明确的小因果：

```text
start frame = 当前剧情状态
end frame   = 该片段造成的剧情变化
video       = 从 start 到 end 的连续运动
```

错误示例：

```text
start: 水牛坐在牌桌前
end: 水牛突然赢得大奖
```

正确示例：

```text
start: 水牛只剩一枚金币，准备按下 double up
end: double up bonus 被触发，桌面奖励光效开始爆发
```

## 9. 剧情质量质检器

### 9.1 质检目标

新增一个 Story Quality Gate，用于阻止生硬、不连贯、只让参考图动起来的计划进入后续生成。

### 9.2 建议评分字段

```json
{
  "storyQualityReport": {
    "score": 82,
    "hasHook": true,
    "hasConflict": true,
    "hasTurningPoint": true,
    "hasPayoff": true,
    "hasCta": true,
    "causalChainScore": 0.86,
    "emotionalProgressionScore": 0.8,
    "referenceOveruseRisk": 0.22,
    "suddenOutcomeRisk": 0.12,
    "issues": [],
    "rewriteRequired": false
  }
}
```

### 9.3 硬阻断条件

以下情况应直接要求重写，不能进入资产库：

- 没有 hook。
- 没有 conflict。
- 有 payoff，但没有 decision 或 turning point。
- CTA 没有和前面的爽点或利益点连接。
- 任何关键胜利、奖励、转化结果没有原因。
- 超过一半镜头只是描述参考图外观或让参考图动起来。
- 游戏广告没有玩法/奖励/胜负/社交反馈中的至少两个元素。

### 9.4 自动重写策略

质检失败时，不要简单“润色原分镜”，而是回到以下最早失败层级重写：

| 失败类型 | 回退重写层级 |
|---|---|
| 广告目标不清 | 广告创意策略 |
| 无冲突/无转折 | Beat sheet |
| 镜头之间无因果 | 分镜拆解 |
| 边界帧不表达剧情变化 | 边界帧规划 |
| 只是复现参考图 | 创意策略 + Beat sheet |

## 10. 可参考 Skill 的工程化执行方案集

参考仓库：[YvonneMovingon/short-drama-skills](https://github.com/YvonneMovingon/short-drama-skills)。

该仓库对本问题有参考价值的点，不是“短剧题材”本身，而是它把多镜头叙事拆解成了一组可执行、可校验、可结构化输出的规则。其 README 将问题定位为：AI 视频难点不只是生成单个 clip，而是让故事在多镜头间成立，包括镜头数量、每个镜头展示内容、时长、对白、反应、情绪 beat、动作场景、转场和结构化输出。

### 10.1 可借鉴点到本项目的映射

| 参考 Skill | 可借鉴原则 | 本项目改造成什么 |
|---|---|---|
| 01 通用叙事拆解 | 信息密度、复杂动作三段式、关键道具特写、时长估算、非叙事镜头占比控制 | 新增 `narrativeMicroRules`，用于分镜切分和 story gate |
| 02 深度情绪刻画 | 权力变化触发切镜、信息单位拆分、反应优先、情绪越强景别越近 | 新增 `reactionBeat`、`powerShift`、`informationUnit` 字段 |
| 04 按剧情连贯拆分副本 | 叙事焦点、空间一致性、动作连贯性、情绪/视线一致性、主动合并和防孤立 | 新增 `shotGroupingPass`，避免镜头碎裂或无因果跳转 |
| 05 单视频提示词润色 | 固定字段顺序：时长、人物、核心动作、台词、镜头语言、氛围 | 规范 `videoPrompt` 编译模板，防止提示词只描述静态画面 |
| 06 高能戏剧化情节润色 | 前 3 秒黄金开场、高信息密度、高冲击视觉动词 | 为游戏广告 hook/payoff 建立高能润色器 |
| 07 慢节奏细腻质感润色 | 留白、微反应、情绪承接空镜 | 仅用于情绪广告或 payoff 后的呼吸镜头，不作为游戏广告默认节奏 |

### 10.2 新增模块：Narrative Micro-Rule Engine

在 `Creative Strategy -> Story Beat Sheet -> Shot Decomposer` 之间增加一个微规则执行器。它不生成新剧情，只负责把已经生成的 beat 拆成可执行镜头，并校验镜头是否承载新信息。

建议输出：

```json
{
  "narrativeMicroRules": {
    "informationDensity": {
      "rule": "new_shot_requires_new_information",
      "maxNonNarrativeRatioPerBeat": 0.2
    },
    "actionTriplet": {
      "requiredForComplexAction": true,
      "phases": ["motivation_or_preparation", "execution", "result_or_reaction"]
    },
    "reactionPriority": {
      "requiredAfter": ["reveal", "humiliation", "bonus_trigger", "victory_reversal", "loss_threat"],
      "visibleReactionTypes": ["eye_change", "hand_tension", "body_freeze", "breath_change", "opponent_shock"]
    },
    "keyEvidenceCloseup": {
      "requiredFor": ["last_coin", "double_up_button", "winning_card", "jackpot_counter", "download_button"]
    }
  }
}
```

### 10.3 信息密度规则

每个镜头必须提供至少一种新信息：

- 新剧情推进：局势变化、选择发生、机制触发、奖励出现。
- 新情绪强度：压力升级、犹豫、惊讶、释放、炫耀。
- 新关键证据：最后一枚金币、DOUBLE UP 按钮、bonus 标识、获胜牌面、排行榜反超。
- 新空间/视角必要性：从牌桌全局切到手部下注特写，必须是为了展示关键操作，而不是凑镜头。

质量门禁新增：

```json
{
  "informationDensityCheck": {
    "shotsWithoutNewInformation": [],
    "nonNarrativeDurationRatioByBeat": {
      "beat_01_hook": 0.12
    },
    "pass": true
  }
}
```

硬规则：

- 单个 beat 内，空镜、过渡镜头、纯氛围镜头总时长占比不得超过 20%。
- 如果一个镜头既没有新剧情，也没有新情绪，也没有新关键证据，应合并到前后镜头或删除。

### 10.4 复杂动作三段式

游戏广告里的“翻盘”不能直接从弱势跳到胜利，必须拆成：

```text
动机/准备：主角意识到只剩最后机会，手伸向 double up。
执行过程：主角按下按钮，桌面灯效和牌面开始变化。
结果/反应：bonus 触发，金币爆发，对手震惊。
```

建议在 `storyBeats` 或 `segments` 中新增：

```json
{
  "actionContinuity": {
    "actionId": "double_up_reversal",
    "phase": "execution",
    "previousPhase": "motivation_or_preparation",
    "nextPhase": "result_or_reaction",
    "physicalBridge": "main_buffalo_hand_moves_from_last_coin_to_double_up_button"
  }
}
```

硬规则：

- payoff 前必须能找到对应的 `motivation_or_preparation` 和 `execution`。
- 如果 `victory`、`jackpot`、`bonus` 出现，但前面没有触发动作，必须重写。
- 动作有跳跃时必须补过渡动作，禁止“角色突然换位置 / 牌局突然结束 / 奖励突然爆发”。

### 10.5 反应优先规则

广告不是只拍主角，也要拍观众能理解爽点的反应。游戏广告尤其需要对手、朋友、围观者或 UI 反馈来证明“赢得爽”。

新增字段：

```json
{
  "reactionBeat": {
    "trigger": "double_up_bonus_revealed",
    "reactor": "opponent",
    "reactionType": "shock",
    "visibleEvidence": "opponent eyes widen, cards slip from hand, body leans back",
    "storyPurpose": "prove the reversal is surprising and satisfying"
  }
}
```

硬规则：

- `payoff` beat 必须至少有一个反应镜头或反应证据。
- 重大信息出现后，不能只拍信息本身，必须拍主角或对手的可见反应。
- 禁止使用“惊讶、开心、震撼”等抽象词单独作为画面描述，必须转成眼神、手部、身体、道具或 UI 变化。

### 10.6 权力/局势变化规则

短剧 skill 中的“权力变化”可迁移为广告里的“局势变化”。游戏广告不是人物谈判，但有胜负、筹码、排行、奖励倍率等局势权力。

新增字段：

```json
{
  "powerShift": {
    "before": "opponent_leading",
    "after": "main_buffalo_reversal_started",
    "visibleEvidence": ["last_coin", "opponent_chip_lead", "double_up_bonus_glow"],
    "cameraTreatment": "low-angle close-up on the buffalo after the bonus trigger"
  }
}
```

硬规则：

- 每个 turning point 必须声明 `before` 和 `after`。
- 如果 `before` 和 `after` 没有可见证据，不能进入边界帧。
- 局势上升者可用更强势构图；局势下降者必须给反应或被压迫画面。

### 10.7 关键证据特写规则

参考 skill 强调“推动剧情的关键道具必须分配独立特写”。在我们这里，关键道具/证据是广告剧情因果的证据链。

游戏广告关键证据示例：

- 最后一枚金币。
- 下注按钮。
- DOUBLE UP / BONUS / multiplier UI。
- 关键牌面。
- 金币爆发计数器。
- 排行榜反超。
- Logo 和下载按钮。

新增字段：

```json
{
  "keyEvidenceShots": [
    {
      "evidenceId": "double_up_button",
      "linkedBeatId": "beat_03_turning_point",
      "shotNo": 3,
      "requiredVisibility": "clear_readable_ui_or_symbol",
      "reason": "the audience must understand why the reversal starts"
    }
  ]
}
```

硬规则：

- 关键触发点不能淹没在全景中。
- 如果胜利依赖某个游戏机制，该机制必须在 payoff 前有明确视觉证据。
- CTA 按钮属于转化证据，也必须在最后 beat 中清楚出现。

### 10.8 Shot Grouping Pass：防碎裂与防孤立

参考“按剧情连贯拆分副本”的思路，在 Beat Sheet 生成后、Video Segment 生成前增加一次 Shot Grouping Pass。

目标：

- 把同一叙事焦点、同一空间、同一连续动作链的微镜头合并成一个 segment。
- 避免为了“看起来很多镜头”而切碎剧情。
- 避免一个关键动作被拆成前后不连贯的孤立片段。

建议输出：

```json
{
  "shotGroupingPass": {
    "groups": [
      {
        "segmentNo": 2,
        "clipIds": ["shot_02_prepare", "shot_03_press_button"],
        "mergeReason": "same narrative focus, same table space, continuous double-up action",
        "continuityAxes": ["narrative_focus", "space", "action_chain"],
        "totalDurationSeconds": 7
      }
    ],
    "splitReasons": [
      {
        "between": ["shot_03_press_button", "shot_04_coin_burst"],
        "reason": "turning point to payoff; visible game state changes"
      }
    ]
  }
}
```

硬规则：

- 相邻镜头如果叙事焦点、空间、动作链都一致，且合计不超过 15 秒，优先合并为一个 segment。
- 空间变化、时间跳跃、新冲突关系、新玩法状态必须切分。
- 避免某个 clip 被合并后，让旁边只剩一个没有叙事功能的孤立短镜头。

### 10.9 Prompt Polishing Router

不要用同一个 prompt 风格处理所有 beat。参考 skill 的分工，增加一个按 beat 类型选择润色策略的路由。

```json
{
  "promptPolishingRoute": {
    "beat_01_hook": "high_impact_drama",
    "beat_02_conflict": "general_narrative",
    "beat_03_turning_point": "action_detail",
    "beat_04_payoff": "high_impact_drama",
    "beat_05_cta": "video_prompt_polishing"
  }
}
```

建议规则：

- `hook`：高能戏剧化，前 3 秒必须有强信息密度。
- `conflict`：通用叙事拆解，清楚交代压力和目标。
- `decision/turning_point`：动作详细描述，强调物理连续和关键证据。
- `payoff`：高能戏剧化，强调爆发、反应和奖励。
- `cta`：单视频提示词润色，强调品牌、按钮、Logo、行动理由。
- `slow_cinematic` 只用于情绪类广告或 payoff 后的短暂呼吸，不作为游戏广告默认策略。

### 10.10 具体落地任务拆分

| 任务 | 文件 | 说明 |
|---|---|---|
| 类型契约 | `src/services/video-orchestrator/types.ts` | 增加 `VideoNarrativeMicroRules`、扩展 `VideoStoryBeat`、增加 `VideoShotGroupingPass` |
| Planner Prompt | `src/services/video-orchestrator/three-stage-planner.ts` | 在创意策略后插入 micro-rule 要求，要求 beat 输出信息单位、局势变化、关键证据和反应 |
| Shot Decomposer | `src/services/video-orchestrator/three-stage-planner.ts` | 每个 shot 必须引用 beat、informationUnit、action phase、reaction/evidence |
| Grouping Pass | `src/services/video-orchestrator/project-service.ts` 或 planner 内 | 将微镜头按叙事焦点、空间、动作链、情绪流合并为 segment |
| Quality Gate | `src/services/video-orchestrator/quality-judge.ts` 或新增 `story-quality-gate.ts` | 实现信息密度、动作三段式、反应覆盖、关键证据、孤立 clip 检查 |
| Prompt Compiler | `src/services/video-orchestrator/project-service.ts` | 编译图片/视频 prompt 时注入 beat、action phase、key evidence、reaction |
| UI 调试 | `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx` | 在脚本/调试区展示 storyQualityReport、shotGroupingPass 和 failed rules |

## 11. UI 与审核建议

建议在脚本确认前增加可审核的“创意策略 / 剧情骨架”展示，但不一定要作为独立顶部阶段。可先在脚本页中折叠展示：

- 广告类型
- 创意模板
- Hook
- Conflict
- Turning Point
- Payoff
- CTA
- 每个镜头绑定的 story beat
- 质检报告和重写原因
- 信息密度、关键证据、反应覆盖、动作三段式检查结果
- Shot Grouping Pass 的合并/切分理由

用户可以在进入资产库之前修改这些文字。修改后应标记下游资产、边界帧、片段为 dirty。

## 12. 落地路线

### 阶段 1：只加结构，不改 UI

- 在 `planJson` 中新增 `creativeStrategy`、`storyBeats`、`storyQualityReport`。
- 在 `planJson` 中新增 `narrativeMicroRules`、`shotGroupingPass`。
- 修改 Planner prompt，要求先输出创意策略和 beat sheet，再输出分镜。
- 分镜必须包含 `linkedBeatIds`、`storyFunction`、`emotionalBeat`、`cause`、`effect`。
- 分镜必须包含 `informationUnit`、`keyEvidenceIds`，复杂动作必须包含 `actionContinuity`。
- 序列化时把这些字段放进 `planDebug`。

### 阶段 2：加质量门禁

- 实现 Story Quality Gate。
- 质量不合格时自动重写一次或多次。
- 仍失败则进入 `PLAN_REVIEW`，但 UI 明确显示“剧情质量风险”，不允许一键批准。
- 增加信息密度、非叙事镜头占比、反应覆盖、关键证据覆盖、复杂动作三段式覆盖和孤立 clip 检查。

### 阶段 3：加 Shot Grouping Pass

- 在 beat 到 segment 之间增加合并/切分步骤。
- 相邻微镜头按叙事焦点、空间、动作链、情绪/视线一致性合并。
- 对必须切分的位置记录 `splitReasons`。
- 将结果用于后续边界帧和 segment 生成，不再直接使用未经聚合的碎片镜头。

### 阶段 4：UI 可审核

- 在脚本确认页展示创意策略和 beat sheet。
- 每个镜头卡片显示其剧情功能。
- 显示关键证据、反应 beat、动作三段式阶段、grouping 合并/切分理由。
- 用户修改创意策略或 beat 后，下游资产和边界帧标记 dirty。

### 阶段 5：游戏广告模板库

- 增加游戏广告模板枚举与选择理由。
- 为棋牌、slot、消除、闯关、抽卡等类型提供默认 beat 结构。
- 固定回归样本加入“牛打牌逆风翻盘”用例。

### 阶段 6：Prompt Polishing Router

- 按 beat 类型选择通用叙事、高能戏剧化、动作详细描述、CTA 润色等不同策略。
- hook/payoff 默认使用高能策略。
- decision/turning_point 默认强调动作连续和关键证据。
- cta 默认强调 Logo、下载按钮和行动理由。

## 13. 验收标准

### 13.1 通用验收

- 同一广告计划必须能回答：观众前三秒为什么停留？
- 每个镜头必须能回答：它推动了什么剧情变化？
- payoff 必须能追溯到前面的 conflict 和 turning point。
- CTA 必须能追溯到前面的爽点或利益点。
- 参考图必须出现在资产或视觉约束中，而不是替代剧情字段。
- 每个镜头必须提供新信息，或被合并/删除。
- 每个关键玩法机制必须有可见证据特写。
- 每个重大反转必须有主角或对手的可见反应。
- 复杂动作必须有准备、执行、结果/反应三段中的对应记录。

### 13.2 游戏广告验收

游戏广告必须至少满足：

- 前 3 秒有压力、悬念或反差。
- 中段有选择、操作或机制触发。
- 后段有奖励、胜利、社交反馈或排名变化。
- 结尾 CTA 与前面的爽点直接相关。
- 胜利不能突然发生，必须有明确触发点。
- hook 和 payoff 必须是全片信息密度最高的两个区段之一。
- bonus、double up、jackpot、排行榜等机制必须在边界帧或子分镜中清楚可见。
- payoff 必须包含反应证据：对手震惊、朋友围观、主角释放、UI 爆发等至少一个。

### 13.3 失败样例改正

失败：

```text
牛坐在牌桌前 -> 牛打牌 -> 牛赢了 -> 下载按钮
```

合格：

```text
牛只剩最后一枚金币，被对手嘲笑
  -> 牛犹豫后选择 double up
  -> DOUBLE UP BONUS 被触发，桌面灯效爆发
  -> 金币喷发，排行榜反超，对手震惊
  -> 牛邀请观众下载加入下一局
```

## 14. 参考来源

- [YvonneMovingon/short-drama-skills](https://github.com/YvonneMovingon/short-drama-skills)：README 将该项目定义为面向 AI 短剧生成的 production-tested prompt rules，并强调多镜头故事工作的难点是镜头数量、展示内容、时长、对白、反应、情绪 beat、动作和转场的结构化处理。
- [01 通用叙事拆解](https://raw.githubusercontent.com/YvonneMovingon/short-drama-skills/main/skills/01-%E9%80%9A%E7%94%A8%E5%8F%99%E4%BA%8B%E6%8B%86%E8%A7%A3/prompt.zh-CN.md)：参考信息密度、复杂动作三段式、非叙事镜头占比、关键道具特写和时长估算。
- [02 深度情绪刻画](https://raw.githubusercontent.com/YvonneMovingon/short-drama-skills/main/skills/02-%E6%B7%B1%E5%BA%A6%E6%83%85%E7%BB%AA%E5%88%BB%E7%94%BB/prompt.zh-CN.md)：参考权力/局势变化、信息单位拆分、反应优先和景别递进。
- [04 按剧情连贯拆分副本](https://raw.githubusercontent.com/YvonneMovingon/short-drama-skills/main/skills/04-%E6%8C%89%E5%89%A7%E6%83%85%E8%BF%9E%E8%B4%AF%E6%8B%86%E5%88%86%E5%89%AF%E6%9C%AC/prompt.zh-CN.md)：参考叙事焦点、空间一致性、动作连贯性、情绪/视线一致性、主动合并和防孤立机制。

## 15. 实施边界

本文只定义解决方案和验收标准，不直接修改生成链路。

后续执行时应优先修改：

- `src/services/video-orchestrator/types.ts`
- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`
- `docs/one-prompt-video-script-decomposition-baseline.md`

执行时必须保证历史 `planJson` 兼容：缺失新字段时使用默认值，不得让旧项目无法读取、无法继续生成或无法回退。

## 16. 拆解完后的具体执行步骤

本节用于把上面的方案拆成可直接开发的执行步骤。执行原则是：先建立结构和回归样本，再接入 Planner，再做质量门禁，最后做 UI 和自动重写。不要一上来同时改 prompt、状态机、UI 和生成链路，否则很难定位问题。

### 16.1 第 0 步：冻结当前基线

目标：确保后续改剧情 Planner 时，不破坏现有资产库、边界帧、视频片段、音频和回退能力。

执行：

1. 固定当前可运行的一句话成片样本。
2. 至少准备以下 5 类输入：
   - 游戏广告：牛打牌逆风翻盘。
   - 产品广告：护肤品使用前后或卖点证明。
   - 电商广告：痛点、卖点、优惠、下单。
   - 餐饮广告：出餐、感官刺激、顾客反应、门店 CTA。
   - 剧情短片：人物关系、冲突、反转、悬念。
3. 保存每个样本的当前 `planJson` 快照，用作改造前对照。
4. 记录当前失败点，例如“突然赢了”“只让参考图动起来”“没有 CTA 因果”。

验收：

- 每个样本都有旧版输出快照。
- 后续改动可以明确比较“剧情连贯性是否变好”。
- 旧项目仍可打开、同步、回退和继续生成。

执行记录（2026-07-21）：

- 已冻结 Phase 0 合成基线快照目录：`src/services/video-orchestrator/__fixtures__/phase0/`。
- 已覆盖 5 类必需输入，并保留额外多场景多机位兼容样本：
  - 游戏广告：`single-character-game-ad.json`
  - 产品广告：`character-product-ad.json`
  - 电商广告：`ecommerce-offer-ad.json`
  - 餐饮广告：`food-sensory-ad.json`
  - 剧情短片：`short-drama-conflict-story.json`
  - 兼容样本：`multi-scene-camera-ad.json`
- 每个样本均保存当前旧版 `planJson`、资产库、人物正/侧/背三视图、边界关键帧、motion checkpoint、视频片段、最终成片 URL、调试产物、质量报告和媒体回退历史。
- 每个样本均增加 `storyBaseline`，记录：
  - `videoCategory`
  - `legacyPlannerBehavior: pre-story-gate`
  - `knownCurrentFailurePoints`
  - `comparisonGoal`
- 所有媒体地址使用 `fixture://`，没有调用真实上游生成，也没有引入生产项目、用户隐私、密钥或签名 URL。
- 已更新 `phase0-regression.test.ts`，确保后续改造必须继续满足：
  - 至少覆盖 game/product/ecommerce/food/short_drama 五类基线。
  - 每个快照都有剧情失败点记录。
  - 旧资产库、边界帧、视频片段、最终成片、调试产物和媒体回退结构仍可读取。
  - 人物资产仍保持 front/side/back 三视图契约。
- 验证结果：`npm run test:one-prompt-video` 通过，44 个测试全部通过。

### 16.2 第 1 步：扩展类型契约

目标：先让系统能承载新结构，但不改变生成行为。

修改文件：

- `src/services/video-orchestrator/types.ts`
- `src/services/video-orchestrator/project-service.ts`

执行：

1. 增加可选类型：
   - `VideoCreativeStrategy`
   - `VideoStoryBeat`
   - `VideoNarrativeMicroRules`
   - `VideoShotGroupingPass`
   - `VideoStoryQualityReport`
2. 扩展 `OnePromptVideoPlan`，新增可选字段：
   - `creativeStrategy`
   - `storyBeats`
   - `narrativeMicroRules`
   - `shotGroupingPass`
   - `storyQualityReport`
3. 在 `extractPlanDebug()` 中透出这些字段。
4. 所有读取逻辑必须兼容旧 `planJson`，缺失字段时返回空对象或空数组。

验收：

- TypeScript 通过。
- 老项目没有这些字段也能正常序列化。
- 前端调试数据能看到新字段，但旧项目为空。

执行记录（2026-07-21）：

- 已在 `src/services/video-orchestrator/types.ts` 增加可选类型：
  - `VideoCreativeStrategy`
  - `VideoStoryBeat`
  - `VideoNarrativeMicroRules`
  - `VideoShotGroupingPass`
  - `VideoStoryQualityReport`
- 已扩展 `OnePromptVideoPlan`，新增可选字段：
  - `creativeStrategy`
  - `storyBeats`
  - `narrativeMicroRules`
  - `shotGroupingPass`
  - `storyQualityReport`
- 已在 `extractPlanDebug()` 透出上述字段，并同时兼容 camelCase 与 snake_case：
  - `creativeStrategy` / `creative_strategy`
  - `storyBeats` / `story_beats`
  - `narrativeMicroRules` / `narrative_micro_rules`
  - `shotGroupingPass` / `shot_grouping_pass`
  - `storyQualityReport` / `story_quality_report`
- 缺失字段时保持旧项目兼容：
  - 对象字段返回 `{}`
  - 数组字段返回 `[]`
- 已补充 Phase 0 回归断言，锁定这些字段必须保持“类型可选 + 调试可见 + 旧数据兼容”。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，45 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.3 第 2 步：改 Planner 输出结构，但先不硬阻断

目标：让 Planner 先稳定输出创意策略、beat sheet 和微规则信息。

修改文件：

- `src/services/video-orchestrator/three-stage-planner.ts`
- 可能涉及 `src/services/video-orchestrator/planner.ts`

执行：

1. 在 Planning Architect 阶段要求先输出 `creativeStrategy`。
2. 在 Storyboard/Shot Decomposer 阶段要求输出 `storyBeats`。
3. 每个 shot/segment 必须引用：
   - `linkedBeatIds`
   - `storyFunction`
   - `emotionalBeat`
   - `cause`
   - `effect`
   - `informationUnit`
   - `keyEvidenceIds`
4. 对复杂动作增加 `actionContinuity`：
   - `motivation_or_preparation`
   - `execution`
   - `result_or_reaction`
5. 对 payoff、turning point 增加 `reactionBeat` 和 `powerShift`。
6. 先把缺字段记录为 warning，不要立即阻断。

验收：

- 新生成计划里能看到 `creativeStrategy`。
- 每个镜头能追溯到至少一个 story beat。
- 游戏广告中的胜利/payoff 前能找到触发动作。
- 非游戏广告也能生成对应类型的策略，而不是套游戏模板。

执行记录（2026-07-21）：

- 已更新 `src/services/video-orchestrator/three-stage-planner.ts` 的三阶段 Planner 合同：
  - Planning Architect 阶段要求先输出 `creative_strategy`，再拆 `narrative_events`。
  - Planning Architect 阶段要求输出 `narrative_micro_rules`，用于记录“禁止突然结果、禁止只让参考图动起来、CTA 必须在 payoff 后”等软规则。
  - Storyboard Artist 阶段要求输出 `story_beats` 和 `shot_grouping_pass`，先说明剧情功能和因果，再组织分镜。
  - Shot Decomposer 的 whole 模式与 per-segment 模式都要求每个 segment 输出剧情追踪字段。
- 已扩展 `src/services/video-orchestrator/types.ts`：
  - `VideoStoryFunction` 增加 `ending`。
  - 新增 `VideoStoryTraceFields`。
  - `VideoPlanSegment` 和兼容 `VideoPlanShot` 增加：
    - `linkedBeatIds`
    - `storyFunction`
    - `emotionalBeat`
    - `cause`
    - `effect`
    - `informationUnit`
    - `keyEvidenceIds`
    - `actionContinuity`
    - `reactionBeat`
    - `powerShift`
  - `StoryboardBrief` 增加 `linkedBeatIds` 和 `storyFunction`。
- 已在归一化层接入新结构：
  - `normalizeCreativeStrategy()`
  - `normalizeNarrativeMicroRules()`
  - `normalizeStoryBeats()`
  - `normalizeShotGroupingPass()`
  - `normalizeStoryQualityReport()`
  - `normalizeSegmentStoryTrace()`
- 当前阶段不硬阻断：
  - 模型漏 `creativeStrategy`、`storyBeats`、`narrativeMicroRules`、`shotGroupingPass` 时，只写入 `plannerWarnings` 和 `storyQualityReport.issues`。
  - 缺失 `storyBeats` 时，系统会从 `timelineBlueprint.sourceEventIds` 派生最低限度 beat trace，保证前端 debug 仍可见。
  - payoff / turning point 缺 `actionContinuity`、`reactionBeat` 或 `powerShift` 时，只记录 warning，后续 Story Quality Gate 再决定是否重写。
- 已补充回归断言，锁定 Planner 必须保留这些输出合同和非硬阻断行为。
- 顺带修复两个既有回归/类型契约问题：
  - 视频 retry prompt 保留 `MANDATORY RETRY CORRECTION FROM END-FRAME VISUAL CHECK` 标记。
  - 端帧连续性判断使用 `continuity.decision === "pass"`，不再读取不存在的 `continuity.passed`。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，46 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.4 第 3 步：新增视频类型路由

目标：避免方案变成“游戏广告专用”，让系统先判断视频类型，再选择对应模板和门禁。

修改文件：

- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/types.ts`

执行：

1. 在 `creativeStrategy` 中增加：
   - `videoCategory`
   - `templateId`
   - `templateReason`
   - `conversionGoal`
2. 支持初始模板：
   - `game_reversal`
   - `game_bonus_payoff`
   - `product_problem_solution`
   - `ecommerce_offer_conversion`
   - `food_sensory_reaction`
   - `auto_performance_hero`
   - `short_drama_conflict_twist`
   - `generic_brand_story`
3. 每个模板定义最小 beat 结构。
4. 如果分类不确定，使用 `generic_brand_story`，但必须记录 fallback 原因。

验收：

- 游戏广告走游戏模板。
- 护肤品广告不出现“bonus / jackpot / 对手震惊”等游戏语义。
- 餐饮广告能围绕食材、制作、感官和顾客反应设计 beat。
- 通用视频也有 hook/conflict/payoff/CTA 的抽象结构。

执行记录（2026-07-21）：

- 已在 `src/services/video-orchestrator/types.ts` 扩展 `VideoCreativeStrategy`：
  - `videoCategory`
  - `templateId`
  - `templateReason`
  - `templateReasonZh`
  - `conversionGoal`
  - `conversionGoalZh`
  - `fallbackReason`
  - `fallbackReasonZh`
- 已新增类型：
  - `VideoCreativeCategory`
  - `VideoCreativeTemplateId`
- 已在 `src/services/video-orchestrator/three-stage-planner.ts` 增加 `STORY_TEMPLATE_DEFINITIONS`，支持 8 个初始模板：
  - `game_reversal`
  - `game_bonus_payoff`
  - `product_problem_solution`
  - `ecommerce_offer_conversion`
  - `food_sensory_reaction`
  - `auto_performance_hero`
  - `short_drama_conflict_twist`
  - `generic_brand_story`
- 每个模板已定义最小 beat 骨架：
  - 游戏模板：hook / conflict 或 turning_point / payoff / cta，并要求可见触发动作、reactionBeat、powerShift。
  - 产品模板：真实痛点 / 产品介入 / 效果证明 / 品牌购买引导。
  - 电商模板：痛点 / 卖点证明 / 优惠出现 / 立即下单。
  - 餐饮模板：食材或出餐 / 感官证明 / 顾客第一口反应 / 门店或套餐 CTA。
  - 汽车模板：视觉登场 / 性能证明 / 驾驶向往 / 预约试驾。
  - 短剧模板：关系悬念 / 冲突升级 / 反转线索 / 悬念停顿。
  - 通用模板：hook / conflict / proof / payoff / cta。
- 已新增模板路由逻辑：
  - `routeCreativeTemplate()`
  - `classifyVideoCategoryFromText()`
  - `templateForCategory()`
  - `normalizeCreativeTemplateId()`
  - `normalizeCreativeCategory()`
- 如果模型未给 `templateId`，系统会按 `videoCategory`、`videoType`、策略字段和 `planningManifest` 文本保守分类。
- 如果分类不确定，使用 `generic_brand_story`，并记录 fallback reason，避免误套游戏、餐饮、电商等垂直模板。
- 已将兜底后的 `creative_strategy` 注入 Stage 2A / Stage 2B 的 `story_design_context`，确保后续分镜阶段也能看到模板选择。
- 缺失 `storyBeats` 时，fallback beat 不再只从 timeline 生硬派生，而是从选中的模板最小 beat 结构派生。
- 已补充回归断言，锁定：
  - 8 个模板 ID 都存在。
  - 产品模板不包含 `bonus / jackpot / opponent / leaderboard / 对手震惊 / 金币 / 排行榜` 等游戏语义。
  - 餐饮模板包含食材/出餐、感官证明、顾客反应、门店/套餐 CTA。
  - 通用模板包含 hook/conflict/proof/payoff/CTA。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，53 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.5 第 4 步：实现 Story Quality Gate 的软评分

目标：先给计划打分和指出问题，但暂时不阻断用户流程。

新增或修改文件：

- `src/services/video-orchestrator/story-quality-gate.ts`
- 或 `src/services/video-orchestrator/quality-judge.ts`
- `src/services/video-orchestrator/project-service.ts`

执行：

1. 实现以下检查：
   - 是否有 hook。
   - 是否有 conflict。
   - 是否有 turning point/payoff。
   - CTA 是否能追溯到前面的利益点。
   - 每个 shot 是否有新信息。
   - payoff 是否有 reactionBeat。
   - 复杂动作是否满足三段式。
   - 关键机制或产品卖点是否有 keyEvidence。
   - 是否过度依赖参考图。
2. 生成 `storyQualityReport`。
3. 把报告写入 `planJson`。
4. 在日志中记录失败项。

验收：

- “牛突然赢了”应被打出 `suddenOutcomeRisk`。
- “只展示参考图动起来”应被打出 `referenceOveruseRisk`。
- 产品广告如果没有痛点或效果证明，应被标记。
- 不阻断流程，但报告可见。

已执行记录：

- 已新增 `src/services/video-orchestrator/story-quality-gate.ts`，实现 Story Quality Gate 软评分器。
- 当前质量报告只打分和记录 warning，不阻断用户继续进入资产库、边界帧和视频生成流程。
- 已覆盖以下软检查：
  - `missingHook`：缺少开场吸引点。
  - `missingConflict`：缺少冲突、痛点、阻力或悬念。
  - `missingTurningPointOrPayoff`：缺少转折或 payoff。
  - `ctaTraceMissing`：CTA 无法追溯到前面的利益点或效果证明。
  - `noNewInformationRisk`：镜头没有提供新信息，容易变成重复展示。
  - `payoffReactionMissing`：payoff 缺少反应镜头或情绪反馈。
  - `complexActionContinuityMissing`：复杂动作缺少“动机/准备、执行、结果/反应”三段式。
  - `keyEvidenceMissing`：关键机制、产品卖点或效果证明缺少可见证据。
  - `referenceOveruseRisk`：过度依赖参考图，疑似只是让参考图动起来。
  - `suddenOutcomeRisk`：胜利、翻盘、奖励、下单等结果缺少前置触发或可见原因。
  - `productPainPointMissingRisk`：产品广告缺少痛点或使用前问题。
  - `productProofMissingRisk`：产品广告缺少效果证明或卖点证据。
- 已在 `src/services/video-orchestrator/project-service.ts` 的计划生成链路中调用 `withStoryQualityGate(plan)`，确保报告写入最终持久化的 `planJson.storyQualityReport`。
- 已通过 `story_quality_gate.report` 日志事件记录评分、是否通过、issueCodes 和失败项摘要；有问题时按 `warn` 级别记录，无问题时按 `info` 级别记录。
- 已新增 `src/services/video-orchestrator/story-quality-gate.test.ts`，固定验收用例：
  - “牛突然赢了”会打出 `suddenOutcomeRisk`。
  - “只展示参考图动起来”会打出 `referenceOveruseRisk`。
  - 产品广告没有痛点和效果证明时，会打出 `productPainPointMissingRisk` 与 `productProofMissingRisk`。
- 已把新测试加入 `npm run test:one-prompt-video`。
- 为避免旧回归测试被后续新增媒体类型误伤，已将媒体回退类型检查从“固定连续 union 文本”改成逐项检查核心媒体类型仍存在。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，56 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.6 第 5 步：实现自动重写

目标：质量不合格时自动回到最早失败层级重写，而不是直接生成烂分镜。

修改文件：

- `src/services/video-orchestrator/three-stage-planner.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/story-quality-gate.ts`

执行：

1. 设置重写阈值，例如：
   - `score < 75`
   - `suddenOutcomeRisk > 0.35`
   - `referenceOveruseRisk > 0.45`
   - 缺 hook/conflict/payoff/CTA 任一硬字段
2. 根据失败类型选择重写层级：
   - 广告目标不清：重写 `creativeStrategy`。
   - 无冲突/无转折：重写 `storyBeats`。
   - 镜头无因果：重写 shots/segments。
   - 只是参考图动起来：从 `creativeStrategy` 开始重写。
3. 最多自动重写 2 次。
4. 仍失败则进入 `PLAN_REVIEW`，但标记 `storyQualityReport.rewriteRequired = true`。

验收：

- 明显生硬的计划不会直接进入资产库。
- 重写后的计划能解释胜利、转化或 payoff 的原因。
- 自动重写失败时，UI 能提示用户具体哪里不合格。

已执行记录：

- 已在 `src/services/video-orchestrator/story-quality-gate.ts` 中把软评分升级为可决策的质量门：
  - 新增 `riskScores`，把 `suddenOutcomeRisk`、`referenceOveruseRisk` 等 issue 转成 0-1 风险分。
  - 新增 `decideStoryRewrite()`，统一判断是否需要自动重写。
  - 新增 `markStoryRewriteRequired()`，用于两次自动重写仍失败时标记 `storyQualityReport.rewriteRequired = true`。
  - 新增 `missingCta` 硬字段检查，确保缺 hook/conflict/payoff-or-turning/CTA 时都会触发重写判断。
- 当前重写阈值：
  - `score < 75`
  - `suddenOutcomeRisk > 0.35`
  - `referenceOveruseRisk > 0.45`
  - 缺 `missingHook` / `missingConflict` / `missingTurningPointOrPayoff` / `missingCta` 任一硬字段。
- 当前最早失败层级路由：
  - `referenceOveruseRisk` 或缺 hook：回到 `creative_strategy`。
  - 缺 conflict、turning point/payoff、CTA，或产品痛点/证明缺失：回到 `beat_sheet`。
  - `suddenOutcomeRisk`、CTA 无法追溯、镜头无新信息、payoff 缺反应、复杂动作三段式缺失、keyEvidence 缺失：回到 `storyboard`。
- 已在 `src/services/video-orchestrator/three-stage-planner.ts` 中新增 `STORY_QUALITY_REWRITE_SYSTEM_PROMPT` 和 `rewriteStoryPlanUntilQualityPass()`：
  - 三阶段 Planner 先生成初版 plan。
  - 立刻运行 Story Quality Gate。
  - 不合格时调用 `story_quality_rewrite_{attempt}_{stage}`。
  - 最多自动重写 2 次。
  - 重写时必须保留总时长、分段数量、segment 编号、segment 起止时间、边界关键帧编号、一致性锚点、风格和镜头连续性约束。
  - 按失败层级只允许修对应层及下游层，避免为了修剧情把工程结构改乱。
- 自动重写返回内容会合并回：
  - `creative_strategy`
  - `story_beats`
  - `shot_grouping_pass`
  - `storyboard_brief`
  - `segment_render_descriptions`
  - `keyframes`
  - `segments`
  - `prompt_detail_plan`
- 已在 `src/services/video-orchestrator/project-service.ts` 的日志中透出：
  - `rewriteRequired`
  - `rewriteFromStage`
  - `autoRewriteAttempts`
  - `rewriteReasons`
- 已在一句话成片工作台补充前端提示：
  - 当 `storyQualityReport.rewriteRequired = true` 时，在项目区域上方显示“剧情质量需要人工确认”提示。
  - 提示中展示自动重写次数、评分、建议检查层级和前 3 条原因。
  - “查看详情”会打开调试面板的 Audit 页。
  - Audit 页会展示完整 `storyQualityReport` JSON，便于用户看到具体 issue、rewriteReasons 和风险分。
- 如果两次重写后仍不合格：
  - 不抛错。
  - 仍进入 `PLAN_REVIEW`。
  - `planJson.storyQualityReport.rewriteRequired = true`。
  - UI 可以通过 `storyQualityReport.issues`、`rewriteReasons`、`rewriteFromStage` 展示具体不合格原因。
- 已补充回归测试：
  - `suddenOutcomeRisk` 会触发自动重写决策。
  - 镜头因果问题会回到 `storyboard`。
  - 参考图动起来会回到 `creative_strategy`。
  - 产品广告缺痛点/证明会触发重写决策。
  - 自动重写耗尽后会标记 `rewriteRequired = true`。
  - Planner 自动重写链路在源码层面被回归测试锁定。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，59 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.7 第 6 步：实现 Shot Grouping Pass

目标：把过碎的微镜头合并成适合 i2v 的 segment，同时保留剧情连贯性。

修改文件：

- `src/services/video-orchestrator/project-service.ts`
- 或 `src/services/video-orchestrator/three-stage-planner.ts`

执行：

1. 根据以下维度判断相邻微镜头是否合并：
   - 同一叙事焦点。
   - 同一物理空间。
   - 同一连续动作链。
   - 情绪方向一致。
   - 视线或主客观镜头匹配。
2. 合并后总时长不超过 15 秒。
3. 必须切分的情况：
   - 空间变化。
   - 时间跳跃。
   - 新冲突关系出现。
   - payoff 状态明显改变。
   - CTA 进入。
4. 写入 `shotGroupingPass.groups` 和 `shotGroupingPass.splitReasons`。

验收：

- 不会出现大量无意义 1-2 秒孤立片段。
- 关键动作不会被切断成无法理解的首尾帧。
- 每个 segment 都能说明“从什么状态变到什么状态”。

已执行记录：

- 已扩展 `src/services/video-orchestrator/types.ts`：
  - `VideoShotGroupingPass` 新增 `splitReasons`。
  - 每条 `splitReason` 包含：
    - `afterSegmentNo`
    - `beforeSegmentNo`
    - `reasonCode`
    - `reasonZh`
    - `mergeRejected`
- 已在 `src/services/video-orchestrator/three-stage-planner.ts` 中增强 `normalizeShotGroupingPass()`：
  - 如果模型没有输出 `shotGroupingPass.groups`，系统会自动派生确定性分组。
  - 如果模型没有输出 `shotGroupingPass.splitReasons`，系统会自动派生相邻段切分原因。
  - 会校验每个 group 是否覆盖真实 segment。
  - 会校验 group 总时长不超过 15 秒。
  - 会校验没有被合并的相邻 segment 是否都有 splitReason。
  - 会校验每个 group 是否有“从什么状态到什么状态”的 reason。
- 已新增 `deriveShotGroupingPass()`，用于根据相邻 timeline segment 自动判断是否合并：
  - 合并条件：
    - 同一叙事焦点或兼容的叙事递进，例如 hook → setup/proof、setup → proof、conflict → escalation、turning_point → proof。
    - 同一物理空间或一致性锚点有交集。
    - 连续动作链没有明显跳变。
    - 情绪方向不倒退。
    - 主客观镜头或视线关系兼容。
    - 合并后总时长不超过 15 秒。
  - 强制切分条件：
    - `space_change`
    - `time_jump`
    - `new_conflict_relation`
    - `payoff_state_change`
    - `cta_enter`
    - `duration_limit`
    - `camera_mismatch`
    - `narrative_focus_change`
    - `model_continuity_risk`
- 已更新 Storyboard Artist prompt：
  - 明确要求 `shot_grouping_pass.groups` 不能超过 15 秒。
  - 明确要求未合并的相邻 segment 必须写 `split_reasons`。
  - 明确空间变化、时间跳跃、新冲突关系、payoff 状态改变、CTA 进入必须切分。
- 已新增 `src/services/video-orchestrator/shot-grouping-pass.test.ts`：
  - 验证相邻兼容 beat 会被合并。
  - 验证 payoff 和 CTA 会产生切分原因。
  - 验证超过 15 秒会触发 `duration_limit`。
  - 验证空间变化会触发 `space_change`。
- 已把新测试加入 `npm run test:one-prompt-video`。
- 验证结果：
  - `npm run test:one-prompt-video` 通过，62 个测试全部通过。
  - `npx tsc --noEmit --allowImportingTsExtensions` 通过。

### 16.8 第 7 步：把剧情字段注入边界帧和视频 Prompt

目标：让图片和视频生成真正执行剧情，而不是只执行视觉资产。

修改文件：

- `src/services/video-orchestrator/project-service.ts`

执行：

1. `compileImagePromptForKeyframe()` 注入：
   - `linkedBeatId`
   - `storyMoment`
   - `requiredVisibleEvidence`
   - `forbiddenEvidence`
   - `narrativeStateBefore`
   - `narrativeStateAfter`
2. `compileVideoPromptForSegment()` 注入：
   - `storyFunction`
   - `cause`
   - `effect`
   - `actionContinuity`
   - `reactionBeat`
   - `keyEvidenceIds`
3. 明确视频模型只执行 start/end 之间的运动，不补写剧情。

验收：

- 边界帧能看出剧情节点，不只是漂亮图。
- segment prompt 明确说明从 start 到 end 的因果变化。
- 游戏广告中 double up、bonus、金币爆发、对手反应能在对应阶段出现。

已执行记录：

- 已在 `src/services/video-orchestrator/project-service.ts` 增加 `NarrativePromptContext` 与剧情上下文提取 helper，把 `storyBeats`、segment 因果字段、关键证据和前后叙事状态统一整理成可注入 prompt 的结构。
- `compileImagePromptForKeyframe()` 已注入边界帧剧情契约：
  - `linkedBeatId`
  - `storyMoment`
  - `requiredVisibleEvidence`
  - `forbiddenEvidence`
  - `narrativeStateBefore`
  - `narrativeStateAfter`
- 人物、场景、产品等一致性资产参考图保持纯资产用途，不注入剧情边界契约，避免资产库阶段混入镜头剧情。
- `compileVideoPromptForSegment()` 已注入视频片段剧情执行契约：
  - `storyFunction`
  - `cause`
  - `effect`
  - `actionContinuity`
  - `reactionBeat`
  - `keyEvidenceIds`
- segment 视频 prompt 已增加硬约束：视频模型只能执行已批准首帧到尾帧之间的可见运动，不允许补写缺失剧情，不允许提前生成未来 beat 的胜利、奖励、转化、CTA、额外 UI、额外角色或额外产品信息。
- prompt debug 输入中已透出 `narrativeContext`，debug rules 已增加：
  - `narrative_boundary_contract_injected`
  - `narrative_contract_injected`
  - `model_must_not_invent_story`
- 已补充回归测试，确认边界帧 prompt 和 segment video prompt 都包含剧情契约字段。
- 验证通过：
  - `npx tsc --noEmit --allowImportingTsExtensions`
  - `npm run test:one-prompt-video`（63 passed）

### 16.9 第 8 步：UI 增加可审核的剧情骨架

目标：让用户在资产库之前就能看到并修改剧情逻辑。

修改文件：

- `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx`

执行：

1. 在脚本审核页增加折叠区：
   - 视频类型。
   - 创意模板。
   - Hook / Conflict / Turning Point / Payoff / CTA。
   - 每个镜头绑定的 beat。
   - Story Quality Report。
   - Shot Grouping Pass。
2. 允许用户编辑策略和 beat 文案。
3. 用户修改后，标记下游：
   - 资产库 dirty。
   - 边界帧 dirty。
   - 子分镜 dirty。
   - 视频片段 dirty。
4. 质量报告失败时，不允许直接进入资产库确认，必须修改或触发重写。

验收：

- 用户能在生成资产前看懂剧情是否成立。
- 用户能直接发现“突然赢了”这种问题。
- 修改剧情后，下游产物不会继续复用旧图旧片段。

已执行记录：

- 已在 `src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx` 的 `PLAN_REVIEW` 阶段增加正式的 `NarrativeSkeletonReview` 折叠审核区，位置在项目头部之后、资产库/边界帧/片段视图之前。
- 审核区已展示：
  - 视频类型 `videoCategory`
  - 创意模板 `templateId`
  - 模板理由 `templateReason`
  - 转化目标 `conversionGoal`
  - Hook / Conflict / Turning Point / Payoff / CTA
  - Beat Sheet
  - 每个镜头绑定的 beat
  - Story Quality Report
  - Shot Grouping Pass
- 已允许用户编辑创意策略核心字段和 beat 文案字段，包括剧情节点、原因和结果。
- 已扩展 `planDebugPatch` 保存链路，支持保存：
  - `creativeStrategy`
  - `storyBeats`
  - `storyQualityReport`
  - `shotGroupingPass`
- 用户保存剧情骨架后，后端会通过 artifact dependency graph 标记下游 dirty，覆盖：
  - 资产库
  - 边界帧
  - 子分镜
  - 视频片段
  - 最终合成
- 质量报告失败时，`确认脚本` 会被阻断；用户必须先修改剧情骨架或触发重写，不能直接进入资产库确认。
- 已补充回归测试，确认脚本审核页包含剧情骨架审核、可编辑字段、质量门禁和下游 dirty 标记链路。
- 验证通过：
  - `npx tsc --noEmit --allowImportingTsExtensions`
  - `npm run test:one-prompt-video`（70 passed）

### 16.10 第 9 步：补回归测试和固定样本

目标：防止后续改 prompt 或模型后，剧情质量再次退化。

修改文件：

- `docs/one-prompt-video-script-decomposition-baseline.md`
- `src/services/video-orchestrator/__fixtures__/`
- 相关测试文件

执行：

1. 为每个视频类型增加验收样本。
2. 游戏广告样本必须覆盖：
   - 逆风。
   - 选择。
   - 机制触发。
   - payoff。
   - 反应。
   - CTA。
3. 产品广告样本必须覆盖：
   - 痛点。
   - 使用。
   - 效果证明。
   - 品牌记忆。
   - CTA。
4. 测试 `planJson` 是否包含：
   - `creativeStrategy`
   - `storyBeats`
   - `storyQualityReport`
   - `shotGroupingPass`
5. 测试质量报告中的硬指标是否通过。

验收：

- 固定样本能稳定通过。
- 如果 Planner 生成“参考图动起来”式分镜，测试失败。
- 如果 payoff 没有触发原因，测试失败。

已执行记录：

- 已新增改造后的剧情质量验收样本：`src/services/video-orchestrator/__fixtures__/story-quality/acceptance-samples.json`。
- 验收样本覆盖 7 类初始视频类型：
  - 游戏广告 `game_reversal`
  - 产品广告 `product_problem_solution`
  - 电商广告 `ecommerce_offer_conversion`
  - 餐饮广告 `food_sensory_reaction`
  - 汽车广告 `auto_performance_hero`
  - 剧情短片 `short_drama_conflict_twist`
  - 通用品牌故事 `generic_brand_story`
- 游戏广告样本 `game-reversal-bull-card` 已固定覆盖：
  - 逆风
  - 选择
  - 机制触发
  - payoff
  - 反应
  - CTA
- 产品广告样本 `product-skincare-proof` 已固定覆盖：
  - 痛点
  - 使用
  - 效果证明
  - 品牌记忆
  - CTA
- 已新增 `src/services/video-orchestrator/story-quality-fixtures.test.ts`，直接对 fixtures 跑真实 `evaluateStoryQualityGate()`，而不是只检查静态字段。
- 测试会检查每个 `planJson` 是否包含：
  - `creativeStrategy`
  - `storyBeats`
  - `storyQualityReport`
  - `shotGroupingPass`
- 测试会强制固定样本不出现以下关键退化：
  - `referenceOveruseRisk`
  - `suddenOutcomeRisk`
  - `payoffReactionMissing`
  - `complexActionContinuityMissing`
  - `keyEvidenceMissing`
  - `productPainPointMissingRisk`
  - `productProofMissingRisk`
  - `ctaTraceMissing`
- 已加入两个负向回归：
  - 如果计划退化为“只让参考图动起来”，必须触发 `referenceOveruseRisk`。
  - 如果游戏 payoff 缺少前置触发原因，必须触发 `suddenOutcomeRisk`。
- 已将 `story-quality-fixtures.test.ts` 接入 `npm run test:one-prompt-video`。
- 已重写 `docs/one-prompt-video-script-decomposition-baseline.md`，明确 Phase 0 旧快照与 Story Quality 验收 fixtures 的区别、样本覆盖、硬指标和更新规则。
- 验证通过：
  - `npx tsc --noEmit --allowImportingTsExtensions`
  - `npm run test:one-prompt-video`（93 passed）

### 16.11 第 10 步：灰度上线

目标：降低一次性大改对现有生成链路的风险。

执行：

1. 增加环境变量开关：
   - `ONE_PROMPT_VIDEO_STORY_GATE=off|warn|strict`
   - `ONE_PROMPT_VIDEO_STORY_REWRITE_MAX=0|1|2`
   - `ONE_PROMPT_VIDEO_SHOT_GROUPING=off|on`
2. 默认先使用 `warn`：
   - 生成报告。
   - 不阻断。
   - 不自动重写或只重写一次。
3. 确认稳定后切到 `strict`：
   - 硬阻断烂剧情。
   - 自动重写失败后要求用户确认。

验收：

- 可以随时回退到旧行为。
- 新旧项目都能继续执行。
- 质量报告和日志足够定位 Planner 失败原因。

已执行记录：

- 已新增 `src/services/video-orchestrator/story-rollout-config.ts`，集中解析灰度开关：
  - `ONE_PROMPT_VIDEO_STORY_GATE=off|warn|strict`
  - `ONE_PROMPT_VIDEO_STORY_REWRITE_MAX=0|1|2`
  - `ONE_PROMPT_VIDEO_SHOT_GROUPING=off|on`
- 默认策略已固定为 `warn / 0 / on`：
  - 默认生成 `storyQualityReport`。
  - 默认不阻断脚本确认。
  - 默认不自动重写，避免灰度初期把用户流程卡死。
- `ONE_PROMPT_VIDEO_STORY_GATE=off` 时：
  - Planner 和 `project-service` 不再额外执行 Story Quality Gate。
  - 不触发自动重写。
  - 写入 planner warning，方便日志定位是人为关闭。
- `ONE_PROMPT_VIDEO_STORY_GATE=strict` 时：
  - 质量不合格且自动重写仍失败后，会标记 `storyQualityReport.rewriteRequired = true`。
  - UI 只在 `rewriteRequired = true` 时阻断脚本确认，因此 warn 模式下失败报告可见但不阻断。
- `ONE_PROMPT_VIDEO_STORY_REWRITE_MAX` 已接入 Planner 自动重写链路，并保留最多 2 次的硬上限。
- `ONE_PROMPT_VIDEO_SHOT_GROUPING=off` 时，不再派生 `shotGroupingPass`，只记录 warning，可回退到更接近旧行为的分镜执行方式。
- 已在 `.env.example` 和 `.env.local.example` 中补充三个灰度变量。
- 已新增 `src/services/video-orchestrator/story-rollout-config.test.ts`，覆盖默认 warn、off 回退、strict 阻断和非法值回退。
- 已将灰度配置测试接入 `npm run test:one-prompt-video`。
- 验证通过：
  - `npx tsc --noEmit --allowImportingTsExtensions`
  - `npm run test:one-prompt-video`：102 passed

### 16.12 推荐执行顺序汇总

```text
0. 冻结当前基线和失败样本
  -> 1. 扩展 planJson 类型契约
  -> 2. Planner 输出 creativeStrategy/storyBeats
  -> 3. 视频类型路由
  -> 4. Story Quality Gate 软评分
  -> 5. 自动重写
  -> 6. Shot Grouping Pass
  -> 7. 剧情字段注入边界帧/视频 prompt
  -> 8. UI 剧情骨架审核
  -> 9. 回归测试和固定样本
  -> 10. 灰度上线 strict 模式
```

优先级最高的最小闭环：

```text
creativeStrategy
  -> storyBeats
  -> storyQualityReport
  -> 分镜引用 beat
  -> 失败自动重写一次
```

这个最小闭环完成后，即使暂时不做完整 UI 和 Shot Grouping，也能明显减少“参考图只是动起来”和“突然赢了”的问题。
