# PLAN_REVIEW：任务分类与叙事路线

## 1. 独立审核区域

`PLAN_REVIEW` 页面新增独立“任务分类与叙事路线”区域，位于剧情、资产、分镜等下游内容之前。第一版已经同时提供展示和编辑能力，不需要推迟到第二小版本。

展示内容：

- 视频品类 `videoCategory`；
- 叙事模板 `templateId`；
- 时间顺序 `chronologyMode`；
- Hook 模式 `hookMode`；
- 揭示程度 `hookRevealLevel`；
- 是否需要返回较早时间点 `requiresReturnPoint`；
- 品类、模板、时间顺序的选择理由；
- 三项置信度；
- fallback 和用户 warning；
- 当前 authority 与 locked 状态；
- 模型、耗时、输入/输出 Token、Gate 和修复次数。

## 2. 可编辑字段

用户可以修改：

- `videoCategory`
- `templateId`
- `chronologyMode`
- `hookMode`
- `hookRevealLevel`
- `requiresReturnPoint`

前端根据 Category / Template 映射和 Chronology / Hook policy 动态收窄选项。服务端再次执行同一套合法组合校验，不能依赖前端选项保证安全。

## 3. 保存协议

专用接口：

```text
PATCH /api/video-projects/:projectId/route-classification
```

只允许项目处于 `PLAN_REVIEW` 时调用。保存后：

```text
routeClassification.authority = "user"
routeClassification.source = "manual"
routeClassification.status = "manual_locked"
routeClassification.locked = true
```

后续 Planning 必须复用该合同，分类模型和 Planning Architect 均不能覆盖。

## 4. 下游处理

保存前使用 Step 14 的字段级比较器：

- 如果生产字段发生变化，按失效矩阵清理 `story_architect` 及下游 checkpoint，标记计划产物 dirty，并自动重新进入 Planning；
- 重新 Planning 时复用人工锁定 Route，不调用分类模型；
- 如果用户保存的生产字段与原合同相同，只取得用户 authority 并锁定，不重跑下游；
- 理由、置信度等展示字段不会造成生产内容失效。

## 5. 可见状态

页面明确显示：

- “模型建议”或“用户权威”；
- “已锁定”状态；
- fallback/warning 警告；
- 修改生产字段将重新运行 Planning 的提示；
- 保存后的重新规划状态。

人工保存还会写入 `planning.route.user_override` 日志，记录项目、最终 Route 字段、`authority=user`、锁定状态、变化字段和失效边界。随后重新规划产生的 Route 日志会显示 `planning.route.checkpoint.reused`，证明模型没有覆盖人工选择。
