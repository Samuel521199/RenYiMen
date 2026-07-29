# Category / Template 映射与回退规则

> 适用合同：`planning-route-v1`  
> 程序唯一事实源：`src/services/video-orchestrator/planning-route-mapping.ts`  
> 原则：模型只能提出候选值，最终组合必须由程序映射表校验，模型不能自由组合。

## 1. 合法映射表

| videoCategory | 允许使用的 templateId | 确定性默认模板 |
|---|---|---|
| `game` | `game_reversal`、`game_bonus_payoff` | 无奖励机制证据时 `game_reversal`；存在 Bonus/Jackpot/奖励倍率证据时 `game_bonus_payoff` |
| `product` | `product_problem_solution` | `product_problem_solution` |
| `ecommerce` | `ecommerce_offer_conversion` | `ecommerce_offer_conversion` |
| `food` | `food_sensory_reaction` | `food_sensory_reaction` |
| `auto` | `auto_performance_hero` | `auto_performance_hero` |
| `short_drama` | `short_drama_conflict_twist` | `short_drama_conflict_twist` |
| `brand` | `generic_brand_story` | `generic_brand_story` |
| `tutorial` | `generic_brand_story` | `generic_brand_story` |
| `custom` | `generic_brand_story` | `generic_brand_story` |

`generic_brand_story` 在本合同中是通用叙事模板，不会把 `tutorial` 或 `custom` 的品类值强制改写成 `brand`。

## 2. 明确禁止的组合

所有不在映射表中的组合都非法，包括但不限于：

| 非法组合 | 处理 |
|---|---|
| `product + game_bonus_payoff` | 拒绝该组合，按 `product` 回退为 `product_problem_solution` |
| `food + game_reversal` | 拒绝该组合，按 `food` 回退为 `food_sensory_reaction` |
| `short_drama + ecommerce_offer_conversion` | 拒绝该组合，按 `short_drama` 回退为 `short_drama_conflict_twist` |
| `tutorial + product_problem_solution` | 拒绝该组合，按 `tutorial` 回退为 `generic_brand_story` |
| `custom + game_reversal` | 拒绝该组合，按 `custom` 回退为 `generic_brand_story` |

非法组合不能通过“把品类偷偷改成模板所属品类”修复。例如 `product + game_bonus_payoff` 不得被静默改成 `game + game_bonus_payoff`。当品类已经明确时，品类是回退依据。

## 3. 非游戏类别的游戏专属语义

当 `videoCategory != game` 时，Route Contract 的模型生成文本中禁止出现游戏专属叙事语义，包括：

- `jackpot`
- `bonus`
- `leaderboard`
- 爆奖
- 奖池
- 排行榜
- 连胜
- 金币倍率

检查范围是模型生成的 `categoryReason`、`templateReason`、`chronologyReason` 和其他 Route 输出说明，不对用户原始 Prompt 做硬拒绝。这样可以识别“模型把产品广告写成游戏路线”，同时避免用户在否定句中提到游戏词时被误判。

发现此问题时，当前 Route Contract 不得通过。不能仅删除单词后继续使用，因为其他语义可能仍被游戏模板污染。

## 4. 非法组合错误码

| 错误码 | 触发条件 | 是否使用确定性回退 |
|---|---|---:|
| `PLANNING_ROUTE_CATEGORY_MISSING` | 模型没有给出合法 `videoCategory` | 是 |
| `PLANNING_ROUTE_TEMPLATE_MISSING` | 模型没有给出合法 `templateId` | 是 |
| `PLANNING_ROUTE_CATEGORY_TEMPLATE_MISMATCH` | 品类和模板不在合法映射表中 | 是 |
| `PLANNING_ROUTE_GAME_SEMANTICS_FORBIDDEN` | 非游戏路线的模型生成文本含游戏专属语义 | 先拒绝；重试仍失败时使用应用侧安全说明 |

错误码是稳定的程序常量，不使用模型生成的自然语言作为错误判定条件。

## 5. 确定性回退规则

按以下顺序执行：

### 5.1 品类和模板都合法

原样接受：

```text
fallbackUsed=false
fallbackReason=null
```

### 5.2 品类合法，模板缺失

从映射表选择该品类的确定性默认模板：

- 游戏类只有在输入事实明确包含 Bonus、Jackpot、奖励或倍率机制时选择 `game_bonus_payoff`；
- 否则游戏类选择 `game_reversal`；
- 其他品类使用表中唯一默认模板。

同时：

```text
fallbackUsed=true
errorCode=PLANNING_ROUTE_TEMPLATE_MISSING
```

### 5.3 品类合法，模板非法或组合冲突

保留品类，丢弃模型给出的模板，按该品类默认模板回退：

```text
product + game_bonus_payoff
→ product + product_problem_solution
```

同时：

```text
fallbackUsed=true
errorCode=PLANNING_ROUTE_CATEGORY_TEMPLATE_MISMATCH
```

### 5.4 品类缺失，模板合法

根据模板反推默认品类：

| templateId | 反推品类 |
|---|---|
| `game_reversal`、`game_bonus_payoff` | `game` |
| `product_problem_solution` | `product` |
| `ecommerce_offer_conversion` | `ecommerce` |
| `food_sensory_reaction` | `food` |
| `auto_performance_hero` | `auto` |
| `short_drama_conflict_twist` | `short_drama` |
| `generic_brand_story` | `brand` |

由于 `generic_brand_story` 同时允许 brand/tutorial/custom，缺少品类时不能猜成 tutorial 或 custom，固定反推为 `brand`。

### 5.5 品类和模板都缺失

使用最中性的安全组合：

```text
custom + generic_brand_story
```

同时记录：

```text
PLANNING_ROUTE_CATEGORY_MISSING
PLANNING_ROUTE_TEMPLATE_MISSING
fallbackUsed=true
```

### 5.6 非游戏路线出现游戏专属语义

1. 以 `PLANNING_ROUTE_GAME_SEMANTICS_FORBIDDEN` 拒绝本次 Route Contract；
2. 只允许重新执行一次轻量路由判断，不启动剧情返修；
3. 若仍失败，保留已确定品类，使用该品类默认模板；
4. reason 由应用生成中性说明，不复用受污染的模型文案；
5. 不得因为出现 `bonus` 一词就把非游戏品类改成 `game`。

## 6. 程序接口

程序模块提供：

| 接口 | 作用 |
|---|---|
| `PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP` | 唯一合法映射表 |
| `isAllowedCategoryTemplateCombination` | 判断组合是否允许 |
| `validateCategoryTemplateCombination` | 返回稳定的组合错误码 |
| `validateNonGameRouteSemantics` | 检测非游戏路线中的游戏专属语义 |
| `deterministicTemplateForCategory` | 根据品类选择确定性模板 |
| `resolveCategoryTemplateMapping` | 执行缺失、冲突和安全回退 |

新增或修改品类、模板时，必须同时更新此程序映射及其测试，不能只修改 Prompt。
