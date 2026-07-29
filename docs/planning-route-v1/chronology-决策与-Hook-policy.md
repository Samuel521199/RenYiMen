# Chronology 决策与 Hook Policy

> 适用合同：`planning-route-v1`  
> 程序唯一事实源：`src/services/video-orchestrator/planning-chronology-policy.ts`  
> 原则：先判断时间结构，再从该时间结构允许的 Hook policy 中选择；不能分别自由生成四个字段。

## 1. Chronology 决策表

决策优先级从上到下执行。命中更高优先级后不再使用低优先级推断。

| 优先级 | chronologyMode | 使用条件 | 不应使用的情况 |
|---:|---|---|---|
| 1 | `explicitMode` 对应模式 | 用户明确、无歧义地指定顺叙、高潮前置、结果先行、痛点解决或演示结构 | 显式要求与素材事实互相冲突时，不能盲从，需记录 ambiguity |
| 2 | `result_first` | 用户明确要求先展示最终结果；产品演示明确要求效果先行；叙事不要求隐藏结果 | 仍需保持结果悬念时 |
| 3 | `flashforward_hook` | 用户明确要求高潮前置；部分或完整 payoff 预览能显著增强吸引力；后续会返回较早时间点 | 没有可回归的早期时间点，或高潮预览没有明确价值时 |
| 4 | `demonstration` | 教程、操作演示、食品制作、产品功能演示 | 重点是问题—解决关系而非操作过程时 |
| 5 | `problem_solution` | 产品广告、电商广告或需求明确要求痛点—解决结构 | 只是一般产品展示、没有明确痛点时 |
| 6 | `chronological` | 默认模式；用户没有明确要求倒叙；需要从原因自然发展到结果；产品广告需要先问题再解决且不需要专用结构标签 | 用户明确要求高潮或最终结果前置时 |

说明：

- “产品广告”既可能使用 `chronological`，也可能使用 `problem_solution`、`result_first` 或 `demonstration`；
- 不能仅凭 `videoCategory=product` 自动决定时间模式；
- 必须结合用户是否要求痛点结构、效果先行或功能演示；
- 无充分证据时固定回退到 `chronological`。

## 2. 每种模式的具体规则

### 2.1 `chronological`

默认模式。

适用：

- 用户没有明确要求倒叙；
- 需要从原因自然发展到结果；
- 产品广告需要先展示问题再展示解决方案。

限制：

- Hook 不得完整泄露最终 payoff；
- `hookRevealLevel` 只能是 `none` 或 `partial`；
- `requiresReturnPoint=false`。

### 2.2 `flashforward_hook`

适用：

- 用户明确要求高潮前置；
- 提前展示部分或完整结果能显著增强吸引力；
- 后续剧情会返回较早时间点。

必须同时满足：

```text
hookMode=payoff_preview
hookRevealLevel=partial 或 full
requiresReturnPoint=true
```

只满足“开场要吸引人”不足以使用该模式。没有回归结构时，应使用 `chronological`、`result_first` 或其他适合模式。

### 2.3 `result_first`

适用：

- 用户明确要求先展示最终结果；
- 产品演示需要效果先行；
- 叙事不要求隐藏结果。

合法 policy：

```text
hookMode=payoff_preview
hookRevealLevel=full
requiresReturnPoint=true
```

这里的 return point 表示展示最终结果后，后续规划需要回到形成该结果之前。分类阶段仍不得输出 `returnToEventId`。

### 2.4 `problem_solution`

适用：

- 产品广告；
- 电商广告；
- 明确的痛点解决结构。

合法 policy：

```text
hookMode=pain_point
hookRevealLevel=none 或 partial
requiresReturnPoint=false
```

该模式表达问题到解决的叙事结构，不等于直接生成问题、解决方案或产品文案。

### 2.5 `demonstration`

适用：

- 教程；
- 操作演示；
- 食品制作；
- 产品功能演示。

合法 policy：

```text
hookMode=curiosity 或 tease
hookRevealLevel=none 或 partial
requiresReturnPoint=false
```

如果开场完整展示最终效果，应改用 `result_first`，不能在 `demonstration` 下使用 `full`。

## 3. Chronology 与 Hook policy 合法组合表

| chronologyMode | 合法 hookMode | 合法 hookRevealLevel | requiresReturnPoint |
|---|---|---|---:|
| `chronological` | `pain_point`、`curiosity`、`tease`、`payoff_preview` | `none`、`partial` | `false` |
| `flashforward_hook` | `payoff_preview` | `partial`、`full` | `true` |
| `result_first` | `payoff_preview` | `full` | `true` |
| `problem_solution` | `pain_point` | `none`、`partial` | `false` |
| `demonstration` | `curiosity`、`tease` | `none`、`partial` | `false` |

`chronological + payoff_preview + partial` 合法，表示只预告少量结果线索；`chronological + payoff_preview + full` 非法。

## 4. 确定性默认组合

模型缺少 Hook policy 字段，或输出非法组合时，程序按所选时间模式使用：

| chronologyMode | 默认 hookMode | 默认 hookRevealLevel | requiresReturnPoint |
|---|---|---|---:|
| `chronological` | `curiosity` | `partial` | `false` |
| `flashforward_hook` | `payoff_preview` | `partial` | `true` |
| `result_first` | `payoff_preview` | `full` | `true` |
| `problem_solution` | `pain_point` | `partial` | `false` |
| `demonstration` | `curiosity` | `partial` | `false` |

非法组合修正后必须记录原错误码，不能把程序修正伪装成模型首次输出正确。

## 5. 非法组合错误码

| 错误码 | 触发条件 | 示例 |
|---|---|---|
| `PLANNING_ROUTE_CHRONOLOGY_HOOK_MODE_MISMATCH` | Hook 类型不属于该时间模式 | `flashforward_hook + tease` |
| `PLANNING_ROUTE_CHRONOLOGY_REVEAL_LEVEL_MISMATCH` | 透露程度不属于该时间模式 | `demonstration + full` |
| `PLANNING_ROUTE_CHRONOLOGICAL_PAYOFF_REVEAL_FORBIDDEN` | 顺叙完整泄露最终 payoff | `chronological + full` |
| `PLANNING_ROUTE_CHRONOLOGY_RETURN_POINT_REQUIRED` | 前置结果模式没有声明必须回归 | `flashforward_hook + requiresReturnPoint=false` |
| `PLANNING_ROUTE_CHRONOLOGY_RETURN_POINT_FORBIDDEN` | 非回归模式错误要求 return point | `problem_solution + requiresReturnPoint=true` |

## 6. 程序接口

| 接口 | 作用 |
|---|---|
| `PLANNING_CHRONOLOGY_HOOK_POLICY` | 五种模式的唯一合法组合及默认值 |
| `selectChronologyMode` | 按用户信号优先级选择时间模式 |
| `validateChronologyHookPolicy` | 返回稳定的非法组合错误码 |
| `resolveChronologyHookPolicy` | 将缺失或非法组合修正为该模式的确定性默认值 |

修改时间模式规则时必须同时更新程序表、Route JSON Schema 和专项测试，不能只修改模型 Prompt。
