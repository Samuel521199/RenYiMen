# 步骤18：固定分类样本与验收指标

## 1. 数据集

固定数据集：

```text
src/services/video-orchestrator/__fixtures__/planning-route/fixed-classification-samples.json
```

数据集包含：

| 分组 | 明确样本数 |
|---|---:|
| game | 5 |
| product | 5 |
| ecommerce | 5 |
| food | 5 |
| auto | 5 |
| short_drama | 5 |
| brand | 5 |
| tutorial/custom | 5（tutorial 3，custom 2） |
| 合计 | 40 |

每条明确样本保存：

- 稳定样本 ID；
- 用户创意和风格预设；
- 人工批准的 expected Route；
- 冻结的 baseline Route；
- 用于游戏语义污染检查的 Route 语义文本。

样本不包含真实用户数据、凭据、外部 URL 或付费模型返回。

## 2. 模糊边界样本

边界样本不计入明确样本分类正确率，单独用于定向修复和人工审核测试：

1. 产品广告与品牌片；
2. 产品广告与电商广告；
3. 游戏广告与普通动画；
4. 食品包装广告与餐饮广告；
5. 汽车品牌片与性能广告；
6. 短剧广告与品牌故事。

每条边界样本保存允许进入进一步判定的 category 和 template 集合，不能用单一标签伪装成无歧义样本。

## 3. 自动验收器

实现：

```text
src/services/video-orchestrator/planning-route-fixed-sample-evaluator.ts
```

验收指标：

| 指标 | 门槛 |
|---|---:|
| 明确样本 category 正确率 | ≥ 98% |
| category/template 合法率 | 100% |
| chronology/Hook policy 合法率 | 100% |
| 非游戏样本游戏语义污染率 | 0% |

缺少预测或出现未知样本 ID 时，整体验收直接失败。

40条样本下，错1条等于 `39/40 = 97.5%`，低于门槛，因此最多允许的 category 错误数实际为0。

## 4. 当前冻结基线

| 指标 | 当前结果 |
|---|---:|
| category 正确率 | 100%（40/40） |
| category/template 合法率 | 100%（40/40） |
| chronology 合法率 | 100%（40/40） |
| 非游戏语义污染率 | 0%（0/35） |

这里的“当前结果”是经过人工批准并冻结的非付费 baseline，用来保护合同、映射和评估逻辑。它不是一次实时模型抽样结果。以后进行真实模型回归时，应将40条输入交给 Route 模型，把返回结果转换成 `PlanningRouteFixturePrediction[]` 后交给同一个验收器，不能改写 expected 标签来适配模型结果。

## 5. 测试入口

```text
npm run test:planning-route
```

专项文件：

```text
src/services/video-orchestrator/planning-route-fixed-samples.test.ts
```

测试同时验证：

- 数量、分组和 ID 唯一性；
- 所有输入能通过精简 Route Input Contract；
- 六类边界样本完整；
- 当前冻结基线通过全部门槛；
- 39/40 正确率会失败；
- 非法映射、非法 chronology 和游戏语义污染能被验收器发现；
- 数据集中没有凭据、外部 URL 或个人标识。
