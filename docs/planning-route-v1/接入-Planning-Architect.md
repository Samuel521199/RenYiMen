# Approved Route Contract 接入 Planning Architect

> 接线版本：`story-architect-v3-approved-route`  
> 入口实现：`src/services/video-orchestrator/three-stage-planner.ts`  
> 边界实现：`src/services/video-orchestrator/planning-route-planning-architect.ts`

## 1. 新的生产顺序

```text
用户输入
→ 参考图客观事实提取
→ 精简 Route Input
→ 独立 Route 模型
→ 程序修复
→ Route Gate
→ approvedRouteContract
→ Planning Architect
→ 后续剧情、资产、时间线和声音策略
```

Planning Architect 不再拥有分类权。只有通过 Route Gate 的合同才能成为 `approvedRouteContract`。

旧 checkpoint 中如果已经存在 Planning 输出但没有 `approvedRouteContract`，程序会失效旧 Planning 输出并从新路由边界重新开始，避免继续使用旧模型自行分类的结果。

## 2. Route Contract 到 Planning Architect 的输入映射

Planning Architect 请求新增：

```json
{
  "approved_route_contract": {
    "videoCategory": "product",
    "templateId": "product_problem_solution",
    "chronologyMode": "problem_solution",
    "hookMode": "pain_point",
    "hookRevealLevel": "partial",
    "requiresReturnPoint": false,
    "categoryReason": "...",
    "templateReason": "...",
    "chronologyReason": "...",
    "evidence": [],
    "categoryConfidence": 0.9,
    "templateConfidence": 0.9,
    "chronologyConfidence": 0.9,
    "ambiguityCodes": [],
    "fallbackUsed": false,
    "fallbackReason": null,
    "version": "planning-route-v1",
    "modelName": "qwen3.7-plus",
    "inputFingerprint": "sha256:...",
    "referenceFactFingerprint": "sha256:..."
  }
}
```

映射规则：

| Route 字段 | Planning Architect 用途 | 权限 |
|---|---|---|
| `videoCategory` | 限制行业语义和故事类型 | 只读 |
| `templateId` | 选择已经批准的模板最低节拍职责 | 只读 |
| `chronologyMode` | 决定事件呈现顺序 | 只读 |
| `hookMode` | 决定 Hook 的基本职责 | 只读 |
| `hookRevealLevel` | 限制 Hook 可透露的结果 | 只读 |
| `requiresReturnPoint` | 决定是否必须返回较早时间点 | 只读 |
| 三项 reason | 解释为什么采用该路线 | 只读 |
| `evidence` | 路由判断依据，不得重写输入事实 | 只读 |
| confidence / ambiguity | 风险提示和审核依据 | 只读 |
| fallback 字段 | 通用路线及审核 warning | 只读 |
| metadata / fingerprint | 合同身份与输入绑定 | 只读 |

传入 Planning Architect 的对象使用深拷贝，避免后续代码持有同一可变引用。

## 3. Planning Architect 禁止重分类规则

System Prompt 增加不可协商规则：

```text
approved_route_contract is immutable.
Do not classify the video again.
Do not choose another videoCategory.
Do not choose another templateId.
Do not choose another chronologyMode.
Do not change Hook policy.
Do not modify approved_route_contract.
Do not silently fall back to another template.
Generate only downstream content from the approved route.
```

Planning Architect 仍负责：

- `narrativeEvents`
- creativeStrategy 中的事件绑定及具体 Hook、冲突、转折、payoff、CTA 内容
- 一致性资产候选和状态变化
- Segment 时间线及时间预算
- `audioBible`
- 字幕策略

它不再负责决定这些内容应基于哪一种分类、模板或时间路线。

## 4. 输出镜像规则

Planning Architect 返回后执行两次保护：

### 4.1 原始输出边界

程序检查 `classification` 与 `creative_strategy` 中出现的路由字段。

如果字段缺失，程序从 `approvedRouteContract` 补入；如果模型返回了不同值，不接受该值并返回结构化 mutation 错误。

镜像关系：

```text
classification.video_category  ← approvedRouteContract.videoCategory
classification.template_id     ← approvedRouteContract.templateId
classification.chronology_mode ← approvedRouteContract.chronologyMode

creative_strategy.video_category    ← approvedRouteContract.videoCategory
creative_strategy.template_id       ← approvedRouteContract.templateId
creative_strategy.chronology_mode   ← approvedRouteContract.chronologyMode
creative_strategy.hook_mode         ← approvedRouteContract.hookMode
creative_strategy.hook_reveal_level ← approvedRouteContract.hookRevealLevel
```

### 4.2 最终 Plan 边界

故事质量处理完成后再次镜像：

```text
plan.creativeStrategy.videoCategory
plan.creativeStrategy.templateId
plan.creativeStrategy.chronologyMode
plan.creativeStrategy.hookMode
plan.creativeStrategy.hookRevealLevel
```

最终 Plan 同时保存只读副本：

```text
plan.approvedRouteContract
```

任何中间故事修复导致分类字段漂移，都会在进入最终验证前被检测，不接受模型新值。

## 5. 冲突错误处理

如果 Planning Architect 判断已批准 Route Contract 与不可变输入事实冲突，只允许返回：

```json
{
  "route_contract_error": {
    "code": "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT",
    "message": "Reference says game while approved route says product.",
    "conflicting_input_fields": ["reference_facts.categorySignals"],
    "conflicting_route_fields": ["videoCategory"]
  }
}
```

程序转换为 `PlanningArchitectRouteConflictError`：

| 错误码 | 触发条件 | 行为 |
|---|---|---|
| `PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT` | 模型明确报告 Route 与输入事实冲突 | 停止当前 Planning，保留结构化字段，不更换模板 |
| `PLANNING_ARCHITECT_ROUTE_MUTATION` | 模型或后续阶段试图修改已批准分类字段 | 拒绝输出，失效 Planning 输出，不接受新值 |

禁止行为：

- 自动切换 category；
- 自动换成另一个 template；
- 自动修改 chronology；
- 以 `generic_brand_story` 掩盖冲突；
- 重新调用完整 Planning Architect 让它再分类。

冲突由路由边界处理或交给用户，不由 Planning Architect 私自决策。

## 6. 本步骤明确不改变的模块

本次改动只增加 Route Contract 输入和镜像边界，没有改变：

- `narrativeEvents` 的生成合同与因果规则；
- 一致性资产候选、锚点准入和资产视觉规格生成；
- timelineBlueprint、Segment 时长及时间预算；
- `audioBible` 和字幕策略；
- Storyboard Artist；
- Story Contract / Semantic Gate；
- Shot Decomposer；
- Single-Take Audit；
- Prompt Detailer。

测试会保留并比较 Planning 输出中的 `narrative_events`、`consistency_manifest`、`planning_manifest.timeline_blueprint` 和 `audio_bible`，确保镜像函数只接触路由字段。

## 7. Checkpoint

checkpoint 新增独立阶段：

```text
routeClassification
```

行为：

- 首次通过 Route Gate 后立即保存；
- Planning 失败重试时继续复用同一个已批准合同；
- 不允许 Planning 失败触发重新分类；
- 用户创意变化时重新分类；
- 参考图改变时先重新提取事实，只有精简分类事实变化才重新分类；
- 只修改声音、资产外观、字幕、时长或画幅时不重新分类；
- 用户手动修改分类后保存并锁定，不再调用分类模型；
- story architect 合同版本升级为 `story-architect-v3-approved-route`。

该阶段同时保存合同版本、用户输入指纹、参考事实指纹、模型、耗时、输入/输出 Token、Gate 结果、修复次数和 fallback 信息。`approvedRouteContract` 仅作为兼容镜像保留。

完整结构、指纹算法与复用/失效矩阵见 [`route_classification` 独立 Checkpoint](route-classification-checkpoint.md)。

Route Contract 更新后的字段级失效边界见 [Route Contract 局部失效规则](route-contract-local-invalidation.md)。
