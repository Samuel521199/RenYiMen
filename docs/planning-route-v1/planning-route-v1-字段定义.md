# `planning-route-v1` 字段定义

> 本文是 Planning 第①步的输出合同规范。  
> 可执行 Schema：[planning-route-v1.schema.json](planning-route-v1.schema.json)  
> 输入白名单 Schema：[planning-route-v1-input.schema.json](planning-route-v1-input.schema.json)

## 1. 合同总规则

- 顶层 20 个字段全部必填，不通过“省略字段”表达默认值；
- 没有业务值时，只能按本规范使用 `null` 或空数组；
- 顶层及 `evidence` 项均禁止额外字段；
- 字符串枚举区分大小写；
- reason 只解释选择依据，不创作具体剧情；
- 输出不得包含事件、资产、Segment、时长分配、声音、字幕或生成 Prompt。

## 2. 字段定义、必填与默认值

### 2.1 分类结果

| 字段 | 必填 | 类型/合法值 | 默认值与规则 |
|---|---|---|---|
| `videoCategory` | 是 | `game`、`product`、`ecommerce`、`food`、`auto`、`short_drama`、`brand`、`tutorial`、`custom` | 无静默默认；品类和模板都缺失时显式回退为 `custom` |
| `templateId` | 是 | `game_reversal`、`game_bonus_payoff`、`product_problem_solution`、`ecommerce_offer_conversion`、`food_sensory_reaction`、`auto_performance_hero`、`short_drama_conflict_twist`、`generic_brand_story` | 无静默默认；无法判断时显式回退为 `generic_brand_story` |
| `chronologyMode` | 是 | `chronological`、`flashforward_hook`、`result_first`、`problem_solution`、`demonstration` | 无充分证据时使用 `chronological`，并视情况标记 fallback |

合法品类—模板组合：

| videoCategory | 允许的 templateId |
|---|---|
| `game` | `game_reversal`、`game_bonus_payoff` |
| `product` | `product_problem_solution` |
| `ecommerce` | `ecommerce_offer_conversion` |
| `food` | `food_sensory_reaction` |
| `auto` | `auto_performance_hero` |
| `short_drama` | `short_drama_conflict_twist` |
| `brand` | `generic_brand_story` |
| `tutorial` | `generic_brand_story` |
| `custom` | `generic_brand_story` |

`tutorial` 和 `custom` 当前没有专用模板，但允许使用通用的 `generic_brand_story`，并保留原始品类值。程序映射详见 [Category / Template 映射与回退规则](category-template-映射与回退规则.md)。

### 2.2 Hook 路线

| 字段 | 必填 | 类型/合法值 | 默认值与规则 |
|---|---|---|---|
| `hookMode` | 是 | `pain_point`、`curiosity`、`tease`、`payoff_preview` | 无充分证据时为 `curiosity` |
| `hookRevealLevel` | 是 | `none`、`partial`、`full` | 无充分证据时为 `partial` |
| `requiresReturnPoint` | 是 | boolean | 由时间模式确定，不允许独立猜测 |

时间模式的跨字段规则：

| chronologyMode | requiresReturnPoint | Hook 限制 |
|---|---:|---|
| `chronological` | `false` | `hookRevealLevel` 只能是 `none` 或 `partial` |
| `flashforward_hook` | `true` | `hookMode=payoff_preview`；透露程度为 `partial` 或 `full` |
| `result_first` | `true` | `hookMode=payoff_preview` 且 `hookRevealLevel=full` |
| `problem_solution` | `false` | `hookMode=pain_point`；透露程度为 `none` 或 `partial` |
| `demonstration` | `false` | `hookMode` 为 `curiosity` 或 `tease`；透露程度为 `none` 或 `partial` |

`requiresReturnPoint=true` 只表达后续规划必须创建“回到较早时间点”的结构义务。本合同不提供 `returnToEventId`。

完整决策优先级、合法组合与错误码见 [Chronology 决策与 Hook Policy](chronology-决策与-Hook-policy.md)。

### 2.3 判断依据

| 字段 | 必填 | 类型 | 默认值与规则 |
|---|---|---|---|
| `categoryReason` | 是 | 非空 string | 说明哪些输入证据支持品类判断 |
| `templateReason` | 是 | 非空 string | 说明为什么该模板比同品类其他模板更合适 |
| `chronologyReason` | 是 | 非空 string | 说明时间模式和 Hook 透露策略的关系 |
| `evidence` | 是 | array，至少 1 项 | 不允许空数组；必须能追溯到白名单输入 |

每个 `evidence` 项：

| 字段 | 必填 | 类型 | 规则 |
|---|---|---|---|
| `sourceType` | 是 | `user_prompt`、`explicit_metadata`、`reference_fact`、`program_policy` | 证据来源类型 |
| `sourceField` | 是 | `userCreative`、`durationSeconds`、`aspectRatio`、`stylePreset`、`hasReferenceImage`、`referenceFacts`、`userConstraints`、`allowedValues`、`categoryTemplateMap` | 必须是精简输入白名单字段 |
| `summary` | 是 | 非空 string | 简短概括证据，不复制大段用户文本，不写新剧情 |
| `referenceFactField` | 是 | 六个参考事实字段名之一或 null | 仅当 `sourceType=reference_fact` 时必须指向一个压缩事实字段；其他来源必须为 `null` |

### 2.4 可靠性信息

| 字段 | 必填 | 类型/合法值 | 默认值与规则 |
|---|---|---|---|
| `categoryConfidence` | 是 | number，`0..1` | 不得用百分数字符串 |
| `templateConfidence` | 是 | number，`0..1` | 必须独立于品类置信度评分 |
| `chronologyConfidence` | 是 | number，`0..1` | 必须独立于模板置信度评分 |
| `ambiguityCodes` | 是 | 唯一字符串数组 | 无歧义时默认 `[]` |
| `fallbackUsed` | 是 | boolean | 正常判断默认 `false` |
| `fallbackReason` | 是 | string/null | `fallbackUsed=false` 时必须为 `null`；为 `true` 时必须是非空字符串 |

合法 `ambiguityCodes`：

| 值 | 含义 |
|---|---|
| `INPUT_TOO_SHORT` | 输入过短，缺少稳定判断线索 |
| `INSUFFICIENT_EVIDENCE` | 证据不足以支持具体路线 |
| `CATEGORY_CONFLICT` | 不同输入证据指向不同品类 |
| `TEMPLATE_CONFLICT` | 同品类内存在相互竞争的模板 |
| `CHRONOLOGY_CONFLICT` | 用户描述的时间顺序互相冲突 |
| `HOOK_ROUTE_CONFLICT` | Hook 类型或透露程度与时间模式冲突 |
| `REFERENCE_FACT_CONFLICT` | 参考事实与用户文字冲突 |
| `UNSUPPORTED_CATEGORY` | 输入品类没有 `planning-route-v1` 可执行模板 |
| `UNSUPPORTED_TEMPLATE` | 指定模板不在 v1 合法枚举中 |

### 2.5 合同元数据

| 字段 | 必填 | 类型 | 默认值与规则 |
|---|---|---|---|
| `version` | 是 | string | 固定为 `planning-route-v1` |
| `modelName` | 是 | 非空 string | 记录实际执行分类的模型名；确定性回退写执行回退的组件名 |
| `inputFingerprint` | 是 | string | `sha256:` 加 64 位小写十六进制 |
| `referenceFactFingerprint` | 是 | string | `sha256:` 加 64 位小写十六进制；无参考事实时也计算规范化空数组 `[]` |

Fingerprint 计算口径：

1. 使用通过输入白名单 Schema 后的规范化对象；
2. 对象键按字典序排序，数组保留业务顺序；
3. UTF-8 编码；
4. SHA-256；
5. `inputFingerprint` 对完整规范化输入计算；
6. `referenceFactFingerprint` 只对规范化后的 `referenceFacts` 数组计算。

这两个字段由应用侧计算并校验。模型可以回传占位值供结构完整性检查，但最终落库值必须由应用覆盖，不能信任模型自行计算的 hash。

## 3. 安全回退规则

### 3.1 全局回退

无法可靠判断品类时输出：

```json
{
  "videoCategory": "custom",
  "templateId": "generic_brand_story",
  "chronologyMode": "chronological",
  "hookMode": "curiosity",
  "hookRevealLevel": "none",
  "requiresReturnPoint": false,
  "fallbackUsed": true
}
```

同时：

- `ambiguityCodes` 至少包含 `INSUFFICIENT_EVIDENCE`，并按实际情况追加其他代码；
- `fallbackReason` 必须非空；
- reason 必须说明“为何不能可靠判断”，不得为回退路线编造具体剧情。

### 3.2 品类已知、模板不确定

- `game` 在没有明确奖励机制证据时默认使用更通用的 `game_reversal`；
- 其他可执行品类当前各只有一个模板，使用该模板；
- `fallbackUsed=true`；
- `ambiguityCodes` 包含 `TEMPLATE_CONFLICT` 或 `INSUFFICIENT_EVIDENCE`；
- 不允许用随机选择解决模板歧义。

### 3.3 时间与 Hook 不确定

使用：

```text
chronological + curiosity + none + requiresReturnPoint=false
```

只要这是由于证据不足而启用的默认路线，就必须设置 `fallbackUsed=true` 并解释原因。

## 4. 合法 JSON 示例

完整文件：[examples/合法-游戏广告.json](examples/合法-游戏广告.json)

```json
{
  "videoCategory": "game",
  "templateId": "game_bonus_payoff",
  "chronologyMode": "chronological",
  "hookMode": "tease",
  "hookRevealLevel": "partial",
  "requiresReturnPoint": false,
  "categoryReason": "用户明确要求制作游戏广告，参考事实包含可见的 Bonus 机制。",
  "templateReason": "核心卖点是奖励机制触发与兑现，适合 game_bonus_payoff。",
  "chronologyReason": "需求没有要求先展示最终奖励，按触发到兑现的顺序更清晰。",
  "evidence": [
    {
      "sourceType": "user_prompt",
      "sourceField": "userCreative",
      "summary": "用户明确说明这是游戏广告。",
      "referenceFactField": null
    },
    {
      "sourceType": "reference_fact",
      "sourceField": "referenceFacts",
      "summary": "参考画面存在 Bonus 按钮和奖励界面。",
      "referenceFactField": "categorySignals"
    }
  ],
  "categoryConfidence": 0.99,
  "templateConfidence": 0.94,
  "chronologyConfidence": 0.87,
  "ambiguityCodes": [],
  "fallbackUsed": false,
  "fallbackReason": null,
  "version": "planning-route-v1",
  "modelName": "qwen3.7-plus",
  "inputFingerprint": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "referenceFactFingerprint": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

示例 hash 是格式占位值，不代表示例输入的真实计算结果。

另见安全回退合法示例：[examples/合法-安全回退.json](examples/合法-安全回退.json)。

## 5. 非法 JSON 示例

完整文件：[examples/非法-引用不存在事件.json](examples/非法-引用不存在事件.json)

```json
{
  "videoCategory": "game",
  "templateId": "game_bonus_payoff",
  "chronologyMode": "flashforward_hook",
  "hookMode": "payoff_preview",
  "hookRevealLevel": "full",
  "requiresReturnPoint": true,
  "hookEventIds": ["event_3"],
  "returnToEventId": "event_1"
}
```

该对象非法，原因包括：

1. 包含禁止字段 `hookEventIds`；
2. 包含禁止字段 `returnToEventId`；
3. 分类阶段尚未生成 `event_3` 和 `event_1`；
4. 缺少判断依据、可靠性和合同元数据等必填字段；
5. 不能通过 `additionalProperties: false`。

另见跨字段非法示例：[examples/非法-时间与回返点冲突.json](examples/非法-时间与回返点冲突.json)。

## 6. 验证顺序

应用侧按以下顺序验证：

1. JSON 可解析；
2. Schema 与 `additionalProperties: false`；
3. 品类—模板组合；
4. 时间模式—Hook—回返点组合；
5. fallback 一致性；
6. evidence 来源与 reference fact 引用；
7. fingerprint 由应用侧复算；
8. 通过后才允许进入剧情事件生成阶段。

任何一步失败，都不得把不完整对象合并进旧的 `creativeStrategy`。
