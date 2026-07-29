# Route Contract 局部失效规则

## 1. 比较原则

Route Contract 更新后，程序使用 `comparePlanningRouteContracts(previous, next)` 做字段级深比较。比较对象是两份已经通过 Route Gate 的规范化 `planning-route-v1`，不比较 checkpoint 的模型耗时、Token、Gate 修复记录等外层审计信息。

比较结果包含：

- `changedFields`：所有发生变化的 Route 字段；
- `productionChangedFields`：影响生产内容的字段；
- `displayOnlyChangedFields`：只影响展示或审计的字段；
- `unknownChangedFields`：当前版本不认识的新增字段；
- `semanticScopes`：字段对应的语义失效范围；
- `checkpointBoundary`：现有 checkpoint 实际清除边界。

未知字段采用保守策略：按可能影响生产处理，从 `story_architect` 开始失效。

## 2. 生产字段与语义失效范围

| 变化字段 | 语义失效范围 | 当前实际 checkpoint 边界 |
|---|---|---|
| `videoCategory` | 当前 Route Contract 之后的全部 Planning 结果 | `story_architect` 及其下游 |
| `templateId` | 剧情及其下游 | `story_architect` 及其下游 |
| `chronologyMode` | 剧情事件顺序及其下游 | `story_architect` 及其下游 |
| `hookMode` | 剧情事件及其下游 | `story_architect` 及其下游 |
| `hookRevealLevel` | 剧情事件及其下游 | `story_architect` 及其下游 |
| `requiresReturnPoint` | 剧情事件及其下游 | `story_architect` 及其下游 |

本步骤不拆分或重构下游 checkpoint。现有系统没有比 `story_architect` 更细的“仅事件顺序”或“仅 Hook 事件”持久化边界，因此上述生产变化统一从 `story_architect` 清除，但审计结果会保留准确的语义失效范围，为以后细化 checkpoint 留出依据。

实际清除内容：

- `planningCoreRaw`；
- `planningRaw`；
- Planning Contract 修复状态；
- 资产合同与资产视觉规格；
- Storyboard Artist 输出；
- Story Contract / Semantic Review；
- Shot Decomposer 与时间线重排结果；
- Prompt Detailer 输出。

保留内容：

- 参考图事实提取结果；
- 新的 `route_classification` checkpoint；
- Route 之前的输入与审计信息。

## 3. 不需要失效的展示与审计字段

以下字段单独变化时，不清除任何生产内容：

- `categoryReason`
- `templateReason`
- `chronologyReason`
- `evidence`
- `categoryConfidence`
- `templateConfidence`
- `chronologyConfidence`
- `ambiguityCodes`
- `fallbackUsed`
- `fallbackReason`
- `modelName`
- `inputFingerprint`
- `referenceFactFingerprint`

这些字段可以更新审核页面、警告和可观测性信息，但不会改变剧情、资产、时间线、声音、Storyboard、镜头或生成 Prompt。

合同 `version` 不属于展示字段。版本发生变化时按未知或不兼容生产规则保守失效。

## 4. 执行时机

该比较同时用于：

1. 模型重新生成 Route Contract 后、写入新 checkpoint 前；
2. 用户手动修改并锁定 Route Contract 时。

若只有展示字段变化，新的 Route Contract 和审计信息正常保存，旧生产 checkpoint 继续复用。若任一生产字段变化，则从 `story_architect` 清除现有结果并重新生成。
