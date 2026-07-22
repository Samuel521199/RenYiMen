# 一句话成片：剧本拆解与剧情质量固定样本基线

本文档用于防止一句话成片 Planner 在后续 prompt、模型或工程改造中退化成两类坏结果：

1. 只让参考图动起来，没有广告/剧情因果。
2. payoff、胜利、转化、下单、反转突然出现，没有前置触发和可见证据。

## 1. 样本分层

当前保留两组样本，它们用途不同，不应混淆。

### Phase 0 旧版快照

位置：`src/services/video-orchestrator/__fixtures__/phase0/`

用途：

- 冻结改造前的可运行输出。
- 用来确认旧项目仍可打开、同步、回退和继续生成。
- 不要求它们已经具备新剧情结构。

### Story Quality 验收样本

位置：`src/services/video-orchestrator/__fixtures__/story-quality/acceptance-samples.json`

用途：

- 固定改造后的合格剧情结构。
- 每个样本必须包含 `creativeStrategy`、`storyBeats`、`storyQualityReport`、`shotGroupingPass`。
- 每个样本必须通过真实 `evaluateStoryQualityGate()`。
- 一旦 Planner 退化为“参考图动起来”或“突然赢了”，回归测试必须失败。

## 2. 当前 Story Quality 样本覆盖

| 样本 ID | 类型 | 模板 | 必须覆盖 |
|---|---|---|---|
| `game-reversal-bull-card` | 游戏广告 | `game_reversal` | 逆风、选择、机制触发、payoff、反应、CTA |
| `product-skincare-proof` | 产品广告 | `product_problem_solution` | 痛点、使用、效果证明、品牌记忆、CTA |
| `ecommerce-offer-conversion` | 电商广告 | `ecommerce_offer_conversion` | 痛点、卖点证明、优惠价值、payoff、下单 CTA |
| `food-sensory-noodle` | 餐饮广告 | `food_sensory_reaction` | 食材/出餐、感官证明、顾客反应、门店 CTA |
| `auto-performance-hero` | 汽车广告 | `auto_performance_hero` | 开场吸引、性能证明、英雄镜头 payoff、预约 CTA |
| `short-drama-conflict-twist` | 剧情短片 | `short_drama_conflict_twist` | 人物关系、冲突、反转、情绪 payoff、继续观看 CTA |
| `generic-brand-story` | 通用品牌故事 | `generic_brand_story` | hook、conflict、proof、payoff、CTA |

## 3. 每个合格样本的硬要求

每个 `planJson` 必须具备：

- `creativeStrategy`
  - `videoCategory`
  - `templateId`
  - `templateReason`
  - `conversionGoal`
  - `hook`
  - `conflict`
  - `turningPoint`
  - `payoff`
  - `cta`
- `storyBeats`
  - 至少包含 hook / conflict / payoff / CTA。
  - 游戏、产品、电商、餐饮等证据敏感类型必须包含 proof 或 turning point。
  - payoff 必须有 `cause`、`effect`、`reactionBeat`、`keyEvidenceIds`。
  - 复杂动作必须有三段式 `actionContinuity`：
    - `motivationOrPreparation`
    - `execution`
    - `resultOrReaction`
- `segments`
  - 每个 segment 必须有 `linkedBeatIds`。
  - 每个 segment 必须有 `storyFunction`。
  - 每个 segment 必须有 `cause`、`effect`、`informationUnit`。
  - 每个 segment 必须有 `keyEvidenceIds`。
  - CTA segment 如果包含 download / order / visit / book 等动作，也必须有 `actionContinuity`。
- `storyQualityReport`
  - 固定样本自身要持久化报告字段。
  - 测试会重新执行 `evaluateStoryQualityGate()`，不只相信 fixture 里的旧报告。
- `shotGroupingPass`
  - 必须有 `groups`。
  - 必须有 `splitReasons`。
  - payoff 状态变化和 CTA 进入必须能说明切分原因。

## 4. 禁止出现的质量问题

固定样本不能出现以下 issue：

- `missingHook`
- `missingConflict`
- `missingTurningPointOrPayoff`
- `missingCta`
- `suddenOutcomeRisk`
- `referenceOveruseRisk`
- `ctaTraceMissing`
- `payoffReactionMissing`
- `complexActionContinuityMissing`
- `keyEvidenceMissing`
- `productPainPointMissingRisk`
- `productProofMissingRisk`

其中最关键的是：

- 游戏广告 payoff 前必须有“选择 / 机制触发 / 证据 / 反应”。
- 产品广告 CTA 前必须有“痛点 / 使用 / 效果证明 / 品牌记忆”。
- 所有 CTA 必须能追溯到前面的 benefit、proof 或 payoff。

## 5. 自动化测试

主要测试文件：

- `src/services/video-orchestrator/story-quality-fixtures.test.ts`
- `src/services/video-orchestrator/story-quality-gate.test.ts`
- `src/services/video-orchestrator/phase0-regression.test.ts`

运行：

```bash
npm run test:one-prompt-video
```

当前测试会检查：

1. Story Quality fixtures 覆盖所有初始视频类型。
2. 每个固定样本包含完整剧情结构字段。
3. 每个固定样本重新跑 `evaluateStoryQualityGate()` 后必须通过。
4. 游戏样本必须覆盖逆风、选择、机制触发、payoff、反应、CTA。
5. 产品样本必须覆盖痛点、使用、证明、品牌记忆、CTA。
6. 如果计划退化为“只让参考图动起来”，测试必须打出 `referenceOveruseRisk`。
7. 如果 payoff 缺少前置触发原因，测试必须打出 `suddenOutcomeRisk`。

## 6. 更新规则

只有以下情况允许更新 fixtures：

- 视频生成器支持了新的明确视频类型或新模板。
- Story Quality Gate 的产品契约升级，且旧样本确实不再代表合格输出。
- 业务侧明确改变验收标准。

不允许因为某次模型输出过不了测试，就把 fixture 降级成更宽松的标准。
