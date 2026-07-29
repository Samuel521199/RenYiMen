# `route_classification` 独立 Checkpoint

## 1. 目的

`route_classification` 是参考事实提取之后、Planning Architect 之前的独立持久化阶段。它只缓存已经通过 Route Gate 的 `planning-route-v1`，避免声音、字幕、资产外观等无关改动重复调用分类模型。

运行顺序：

```text
reference_analysis
→ route_classification
→ story_architect
→ asset_contract
→ storyboard_artist
→ story_validation
→ shot_decomposition
→ prompt_compilation
```

## 2. Checkpoint 数据结构

```ts
interface RouteClassificationCheckpoint {
  stage: "route_classification";
  checkpointVersion: 1;
  stageContractVersion: "route-classification-v1";
  status: "approved" | "manual_locked";
  source: "model" | "manual";
  authority: "model" | "user";
  locked: boolean;
  routeContract: ApprovedPlanningRouteContract;
  routeContractVersion: "planning-route-v1";
  userInputFingerprint: string;
  referenceFactFingerprint: string;
  modelName: string;
  modelDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  gateResult: {
    status: "allow" | "allow_with_warning" | "deterministic_repair" | "fallback";
    issues: PlanningRouteGateIssue[];
    repairs: PlanningRouteGateRepair[];
  };
  repairCount: number;
  fallbackInfo: PlanningRouteSafeFallbackInfo | null;
  createdAt: string;
  updatedAt: string;
}
```

`approvedRouteContract` 暂时保留为兼容镜像；复用和失效判断只认 `routeClassification`。

## 3. 指纹规则

### 3.1 用户输入指纹

`userInputFingerprint` 使用 SHA-256，对以下规范化 JSON 计算：

```json
{
  "userCreative": "去除首尾空白后的用户创意",
  "explicitRouteConstraints": ["去重并按字典序排序的显式路线限制"]
}
```

时长、画幅、风格、声音、字幕和资产外观不进入此指纹。模型原始请求中的 `inputFingerprint` 仍保留在 Route Contract 内用于单次调用审计；它与 checkpoint 的专项复用指纹职责不同。

### 3.2 参考事实指纹

`referenceFactFingerprint` 只对送入路由阶段的精简客观事实计算 SHA-256：

- `subjectTypes`
- `categorySignals`
- `containsUi`
- `containsBrandElements`
- `containsPeople`
- `hasExplicitAdCategorySignals`

原图 URL、颜色、材质、服装、构图和资产外观描述不进入该指纹。因此替换参考图会先重做参考事实提取，但只有上述分类事实发生变化时才重跑 `route_classification`。

## 4. 复用与失效矩阵

| 变化 | Route checkpoint | 后续 Planning | 原因 |
|---|---|---|---|
| 所有专项指纹均未变化 | 直接复用 | 按各阶段 checkpoint 决定 | 路由事实未变化 |
| 只修改声音策略 | 复用 | 从受影响阶段继续 | 与品类、模板、时间顺序无关 |
| 只修改资产外观 | 复用 | 资产及下游按需失效 | 不改变分类事实 |
| 只修改字幕 | 复用 | 从受影响阶段继续 | 与路由无关 |
| 只修改时长或画幅 | 复用 | Story Architect 及下游重算 | 路由不重算，时间线需要重算 |
| 修改用户创意 | 失效并重跑 | Story Architect 及下游失效 | 用户创意指纹变化 |
| 替换参考图，但精简分类事实相同 | 复用 | Story Architect 及下游重算 | 图片变化但品类判断依据未变 |
| 替换参考图，精简分类事实变化 | 失效并重跑 | Story Architect 及下游失效 | 参考分类事实指纹变化 |
| Route 合同或 checkpoint 版本升级 | 失效并重跑 | 下游失效 | 旧缓存不满足当前合同 |
| 用户手动修改分类并保存 | 保存并锁定 | 生产字段变化才重算下游 | `manual_locked` 禁止模型覆盖 |

## 5. 手动锁定

生产 Planning 手动分类保存入口为 `applyManualPlanningRouteClassification`，内部使用 `createManualLockedRouteClassificationCheckpoint`：

- `status = "manual_locked"`；
- `source = "manual"`；
- `locked = true`；
- 模型耗时和 Token 为 `0`；
- 后续即使用户创意或参考事实指纹变化，也不调用分类模型；
- 保存新 Route 后先执行字段级变化比较；生产字段变化才清除旧 Route 派生内容，只有理由、置信度等展示字段变化时保留生产缓存；
- 解除锁定必须是单独、明确的用户操作，不能由 Planning Architect 或恢复流程自动完成。

## 6. 审计要求

每次模型分类保存真实的模型名称、总耗时、输入/输出 Token、Gate 状态与问题、程序修复记录、模型修复次数及 fallback 信息。上游未返回 Token 时保存 `null`，不能伪造为 `0`；只有明确未调用模型的路径保存 `0`。

Route 字段变化的局部失效规则见 [Route Contract 局部失效规则](route-contract-local-invalidation.md)。

Route 生命周期日志与 P50/P95 统计口径见 [Route 独立日志与性能统计](route-logging-performance.md)。

PLAN_REVIEW 展示、人工修改、锁定和重新规划行为见 [PLAN_REVIEW：任务分类与叙事路线](plan-review-route-ui.md)。
