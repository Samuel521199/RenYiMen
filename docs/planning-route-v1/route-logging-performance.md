# Route 独立日志与性能统计

## 1. 日志事件表

所有事件使用同一个 `routeTaskId` 串联，并写入现有一句话成片 JSONL 日志。生产项目从 Planning 调度上下文取得真实 `projectId`；脱离项目直接运行的开发脚本使用 `unscoped`。

| 事件 | 触发时机 | 是否条件触发 |
|---|---|---|
| `planning.route.prepare` | 路由输入压缩、指纹和 checkpoint 复用判断完成 | 否 |
| `planning.route.model.start` | 第一次模型 API 请求前 | 仅需要调用模型 |
| `planning.route.model.complete` | 完整模型调用结束或失败，包括最多一次模型修复 | 仅调用模型 |
| `planning.route.parse` | 模型返回解析结束 | 仅调用模型成功返回 |
| `planning.route.gate` | Route Gate 完成 | 仅调用模型成功返回 |
| `planning.route.deterministic_repair` | Gate 执行了程序确定性修复 | 条件触发 |
| `planning.route.model_repair` | 执行了允许的第二次定向模型修复 | 条件触发 |
| `planning.route.fallback` | 最终使用安全回退 | 条件触发 |
| `planning.route.checkpoint.reused` | 命中 `route_classification` checkpoint | 条件触发 |
| `planning.route.complete` | 路由阶段完成、阻断或失败 | 否 |

## 2. 每条日志的固定字段

每条事件通过 `createPlanningRouteLogRecord` 生成相同字段集合：

| 字段 | 含义 |
|---|---|
| `projectId` | 项目 ID |
| `routeTaskId` | 本次 Route 阶段唯一 UUID |
| `model` | 路由模型名称 |
| `apiWaitDurationMs` | 本次 Route 中所有模型 HTTP 等待时间之和 |
| `routeDurationMs` | 从 Route prepare 开始到当前事件的墙钟时间 |
| `inputTokens` / `outputTokens` | 所有模型调用累计 Token；上游不返回时为 `null` |
| `inputCharacterCount` | 所有实际模型请求 JSON 字符数之和 |
| `responseCharacterCount` | 所有模型返回文本字符数之和 |
| `videoCategory` / `templateId` / `chronologyMode` | 最终路由结果；尚未产生时为 `null` |
| `categoryConfidence` / `templateConfidence` / `chronologyConfidence` | 三项置信度；尚未产生时为 `null` |
| `gateResult` | Gate 最终状态 |
| `repairCount` | 模型定向修复调用次数 |
| `fallback` | 是否使用 fallback |
| `checkpointReused` | 本次是否复用 checkpoint |

开始事件无法预知的结果字段仍会显式写为 `null` 或 `0`，不会缺字段。checkpoint 命中时当前调用的 API 等待、Token、模型输入和模型返回均记为 `0`。

## 3. 耗时统计口径

### 完整 API 等待时间

`apiWaitDurationMs` 只统计：

```text
发出模型 HTTP 请求
→ 收到并解析上游 HTTP 响应体
```

如果触发一次模型定向修复，则两次 API 等待时间相加。它不包括 Route 输入准备、JSON/Gate 校验、程序修复、checkpoint 写入和日志写入。

### Route 端到端时间

`routeDurationMs` 统计：

```text
Route 输入准备完成
→ checkpoint 判断
→ 模型调用（如需要）
→ parse
→ Gate / 修复 / fallback
→ checkpoint 保存
→ planning.route.complete
```

checkpoint 命中也记录端到端时间，但其 `apiWaitDurationMs = 0`。

### 字符与 Token

- 字符数使用 JavaScript 字符串 `length`，用于监控 Prompt/返回规模，不等同于 UTF-8 字节数。
- Token 使用上游 `usage.prompt_tokens` / `usage.completion_tokens`，同时兼容 `input_tokens` / `output_tokens`。
- 上游没有 usage 时记 `null`，不得估算或伪造。

## 4. P50 / P95 分析方式

只使用 `planning.route.complete` 事件，每个 `routeTaskId` 保留一条最终记录。

采用 nearest-rank：

```text
升序排列 N 个样本
P50 = 第 ceil(0.50 × N) 个
P95 = 第 ceil(0.95 × N) 个
```

统计必须分成两个口径：

1. `apiWaitDurationMs`：排除 `checkpointReused = true` 的样本，只分析真实模型调用；
2. `routeDurationMs`：包含 checkpoint 命中，反映用户实际经历的 Route 阶段时间。

同时输出：

- 样本总数；
- 实际模型调用样本数；
- checkpoint 命中率；
- 模型修复率（分母为实际模型调用样本）；
- fallback 率（分母为实际模型调用样本）。

分析时至少按日期窗口和模型分组；排障时继续按 `videoCategory`、`templateId`、`chronologyMode`、Gate 结果、是否修复及是否 fallback 切分。代码中的 `summarizePlanningRoutePerformance` 已实现统一 nearest-rank 口径。
