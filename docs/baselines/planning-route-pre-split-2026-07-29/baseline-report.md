# Planning 路由拆分改造前基线报告

> 冻结日期：2026-07-29  
> 目标范围：仅冻结 `① 任务分类与叙事路线（video category / template / chronology mode）` 的改造前表现，不把整个 Planning Architect 的后续能力纳入本轮改造范围。  
> 主要观察窗口：2026-07-27 14:35 至 2026-07-28 18:20（Asia/Shanghai）。

## 1. 基线结论

当前游戏广告与产品广告的三元路由结果稳定，观察窗口内没有发现 `videoCategory`、`templateId` 或 `chronologyMode` 本身分错的记录：

| 固定场景 | videoCategory | templateId | chronologyMode |
|---|---|---|---|
| 游戏广告 | `game` | `game_bonus_payoff` | `chronological` |
| 产品广告 | `product` | `product_problem_solution` | `chronological` |

现有主要问题不是“分类答案错误”，而是：

1. 路由分类和完整叙事规划被放在同一次重型 Planning Architect 调用中，无法单独统计分类耗时、token 和准确率。
2. 路由结果虽然稳定，但下游事件数量和 Segment 拆分仍会变化；“分类稳定”不等于“整份规划完全一致”。
3. 日志没有记录 Planning Architect 的完整模型输入字符数，模型 token 用量又被脱敏，当前无法建立精确的输入大小和 token 基线。
4. 曾出现叙事事件功能顺序合同错误；它不是三元路由分错，但与所选叙事模板的下游约束衔接直接相关。

## 2. Planning Architect 耗时基线

### 2.1 项目耗时台账口径

按现有项目耗时台账的 5 条记录冻结，作为与历史汇报一致的改造前基线：

| 指标 | 耗时 |
|---|---:|
| 最短 | 2分09.3秒 |
| 中位数 | 2分39.5秒 |
| 平均 | 2分52.3秒 |
| 最长 | 4分12.3秒 |

纳入统计的台账值为：`129.3s`、`159.5s`、`164.2s`、`252.3s`、`156.3s`。

### 2.2 真实模型网络调用口径

结构化日志只识别到 4 次对应的 `planning_architect_lite.response`：

| projectId | 完整响应 | 首个网络响应 | 首个答案内容 |
|---|---:|---:|---:|
| `cms2zysqx0005tvto5sa0cbf1` | 129.277s | 1.229s | 48.254s |
| `cms30whhb0001tv803pawxrde` | 159.464s | 0.909s | 56.996s |
| `cms45bepz0001tv8okj4l1o9w` | 164.222s | 1.105s | 49.906s |
| `cms4hwin700kltvvww69mtj5c` | 156.305s | 1.046s | 43.948s |

4 次真实网络调用的统计值：

| 指标 | 完整响应耗时 |
|---|---:|
| 最短 | 2分09.3秒 |
| 中位数 | 2分37.9秒 |
| 平均 | 2分32.3秒 |
| 最长 | 2分44.2秒 |

`4分12.3秒` 所在记录对应 `planning_architect.checkpoint_reused`，未发现同一时段新增的 Planning Architect request/response。因此：

- `2分52.3秒` 继续作为“项目阶段台账平均值”冻结；
- `2分32.3秒` 作为“真实模型调用平均值”冻结；
- 后续改造效果必须按同一口径比较，不能把 checkpoint 复用阶段耗时当成一次模型返回时长。

## 3. 路由结果与一致率

### 3.1 游戏广告

固定预期：

```text
game
game_bonus_payoff
chronological
```

日志内相同游戏广告需求相关的解析快照为 `18/18` 完全一致，路由一致率为 `100%`。

注意：18 条是解析/复用事件，不代表 18 次彼此独立的模型采样，其中包含 checkpoint 复用和同一项目的重复解析。因此它证明“当前流水线没有观察到路由漂移”，但不能替代未来独立重复调用的稳定性测试。

不同游戏项目的事件/Segment 数量出现过 `4` 与 `5` 的差异。三元路由稳定，但下游拆分结果不是完全确定的。

### 3.2 产品广告

固定预期：

```text
product
product_problem_solution
chronological
```

日志内识别到的两条产品广告解析结果为 `2/2` 完全一致，路由一致率为 `100%`。

两条结果的事件/Segment 数量分别为 `5/5` 和 `4/4`。这再次说明当前分类路线稳定，但后续规划粒度会发生变化。

产品样本在旧日志中没有保存可直接复用的原始用户 Prompt。交付的产品固定样本根据日志中的分类理由和项目已有的 `product-skincare-proof` 验收样本重建，并明确标记为“规范化回归输入”，不冒充原始 Prompt。

## 4. 当前分类错误与返修记录

### 4.1 三元路由分类错误

在本基线窗口内：

- 未发现游戏广告被分到非 `game`；
- 未发现产品广告被分到非 `product`；
- 未发现上述两类模板选择错误；
- 未发现 `chronologyMode` 漂移或错误。

因此当前可确认的三元路由误分类数为 `0`。样本量较小，不能据此推断所有输入上的真实准确率为 100%。

### 4.2 与分类路线衔接有关的返修错误

项目 `cms2zysqx0005tvto5sa0cbf1` 出现：

```text
STRATEGY_FUNCTION_ORDER_INVALID
```

错误过程：

1. 初始结果中 `creative_strategy.conflict_event_ids` 不满足事件功能顺序合同；
2. 第一次返修后，剩余问题转为 `turning_point_event_ids`；
3. 第二次返修又重新引入 conflict 顺序问题；
4. 达到两次合同返修上限后失败。

耗时拆分：

| 返修类型 | 耗时 |
|---|---:|
| Planning 时长修复 | 52.9s |
| 叙事合同返修 1 | 25.1s |
| 叙事合同返修 2 | 24.6s |
| 叙事合同返修合计 | 49.7s |

原因判断：模型选择的游戏分类、模板和时间模式没有错；错误发生在模板所要求的 `conflict → turning_point → payoff` 语义顺序与事件 ID 绑定之间。返修 Prompt 每轮局部修一个字段，但没有锁住已经正确的字段，形成“修复 turning point 又破坏 conflict”的回摆。

解决状态：

- 对三元路由而言：不需要修正，日志中路由始终正确；
- 对合同返修而言：当前流程具有返修和失败保护，没有无限循环；
- 根因并未通过本次基线冻结解决。本轮仅留档，不修改 Planning 代码；
- 后续拆分分类步骤时，应让分类步骤只输出受枚举约束的三元路由，并把事件 ID 顺序校验留给后续叙事规划步骤，避免两类职责互相污染。

## 5. Prompt、返回大小与 token 基线

对应 4 次真实 Planning Architect 网络调用，模型为 `qwen3.7-plus`，thinking 开启。

### 5.1 模型返回大小

日志中的长度单位为字符数：

| projectId | 正文字符 | reasoning 字符 | 合计字符 |
|---|---:|---:|---:|
| `cms2zysqx0005tvto5sa0cbf1` | 14,426 | 5,781 | 20,207 |
| `cms30whhb0001tv803pawxrde` | 18,071 | 7,196 | 25,267 |
| `cms45bepz0001tv8okj4l1o9w` | 19,381 | 6,586 | 25,967 |
| `cms4hwin700kltvvww69mtj5c` | 20,752 | 5,460 | 26,212 |

统计值：

| 指标 | 正文字符 | reasoning 字符 | 合计字符 |
|---|---:|---:|---:|
| 最短/最小 | 14,426 | 5,460 | 20,207 |
| 中位数 | 18,726 | 6,184 | 25,617 |
| 平均 | 18,158 | 6,256 | 24,413 |
| 最长/最大 | 20,752 | 7,196 | 26,212 |

### 5.2 当前无法取得的指标

| 指标 | 状态 | 原因 |
|---|---|---|
| 完整模型 Prompt 输入大小 | 不可取得 | request 日志未记录完整消息字符数；`three_stage.start.promptLength` 仅是用户原始输入长度，不等于发送给模型的完整 Prompt |
| prompt tokens | 不可取得 | 日志字段已显示为 `[REDACTED]` |
| completion tokens | 不可取得 | 日志字段已显示为 `[REDACTED]` |
| total tokens | 不可取得 | 日志字段已显示为 `[REDACTED]` |

这些值不能用字符数臆算后写入正式基线。当前基线将其冻结为“遥测缺口”；后续实现分类拆分时，应新增完整 Prompt 字符数、分类输出字符数、prompt/completion/total token 和分类子调用耗时的独立结构化指标。

## 6. 后续改造验收时的对比规则

为保证前后对比有效，应遵循：

1. 使用本目录中的两个固定输入样本；
2. 三元路由必须与快照完全一致；
3. 每个样本至少独立运行 10 次，不能把 checkpoint 重放计为独立调用；
4. 路由一致率单独计算，不与事件/Segment 一致率混合；
5. 分类步骤耗时从请求发出到三元路由完整返回为止；
6. 分别记录首次响应、完整响应、完整 Prompt 字符数、输出字符数和 token；
7. checkpoint 命中、自动返修和真实模型调用必须使用不同事件名统计。

## 7. 证据来源

- 主结构化日志：`D:\zzz\v debug\one-prompt-video.log`
- 游戏项目耗时台账：
  - `D:\zzz\v debug\projects\cms2zysqx0005tvto5sa0cbf1\耗时日志.log`
  - `D:\zzz\v debug\projects\cms30whhb0001tv803pawxrde\耗时日志.log`
  - `D:\zzz\v debug\projects\cms45bepz0001tv8okj4l1o9w\耗时日志.log`
  - `D:\zzz\v debug\projects\cms4hwin700kltvvww69mtj5c\耗时日志.log`
- 游戏原始需求：上述项目目录中的 `00-project.md`
- 产品规范样本参考：`src/services/video-orchestrator/__fixtures__/story-quality/acceptance-samples.json` 中的 `product-skincare-proof`

机器可读的原始冻结值见同目录下的 `route-results-snapshot.json`。
