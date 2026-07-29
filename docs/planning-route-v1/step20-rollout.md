# 步骤20：Planning Route 灰度上线

## 固定阶段顺序

```text
local_fixed_samples
→ test_live_model
→ shadow_compare
→ nonbillable_canary
→ internal_new_projects
→ percent_10
→ percent_50
→ percent_100
```

灰度决策实现：

```text
src/services/video-orchestrator/planning-route-rollout.ts
```

## 各阶段行为

| 阶段 | Route 调用 | 是否影响正式 Planning | 分类权威 |
|---|---|---|---|
| local_fixed_samples | 否 | 否 | 旧 Planning |
| test_live_model | 是 | 否 | 旧 Planning |
| shadow_compare | 是 | 否 | 旧 Planning |
| nonbillable_canary | 仅 canary | 仅 canary | 单项目唯一权威 |
| internal_new_projects | 仅内部新项目 | 仅内部新项目 | 单项目唯一权威 |
| percent_10 | 稳定哈希选中10% | 选中项目 | 单项目唯一权威 |
| percent_50 | 稳定哈希选中50% | 选中项目 | 单项目唯一权威 |
| percent_100 | 全部 | 全部 | Route Contract |

10%、50%按项目 ID 的稳定 SHA-256 bucket 选择，同一项目不会在多次请求间漂移。

## 影子比较

影子比较只读取三个字段：

```text
videoCategory
templateId
chronologyMode
```

它不比较剧情、资产、声音、时间线或事件 ID，也不能把 Route 结果写回正式 Planning。比较结果只包含匹配状态和字段差异。

## 正式切换

当前代码已经处于 `percent_100` 正式切换状态：

- Route Contract 是唯一分类权威；
- Planning Architect 必须接收 approved Route；
- Planning Architect 禁止重新分类；
- 最终计划分类字段只能镜像 Route Contract；
- 进入 Planning Architect 前执行 `assertRouteContractIsSoleAuthority`；
- approved Route 缺失或旧分类职责仍启用时，抛出 `PLANNING_ROUTE_DUAL_AUTHORITY_FORBIDDEN`。

灰度阶段允许不同项目属于不同 cohort，但单个项目内部始终只能有一个正式分类权威。100%切换后不保留长期双权威。

## 上线检查

每一级扩大比例前必须检查：

1. 固定样本门槛全部通过；
2. Tongits 20次稳定性和耗时门槛通过；
3. 影子不一致案例已经归因；
4. fallback、repair、P50/P95 没有恶化；
5. checkpoint 恢复模型调用为0；
6. 没有 `PLANNING_ROUTE_DUAL_AUTHORITY_FORBIDDEN`；
7. 扩大比例由部署操作显式完成，不由模型自行决定。

