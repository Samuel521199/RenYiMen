# 步骤17：Planning Route 单元测试

专项入口：

```text
npm run test:planning-route
```

步骤17的集中验收文件为：

```text
src/services/video-orchestrator/planning-route-step17.test.ts
```

## 覆盖矩阵

| 要求 | 行为断言 |
|---|---|
| 所有 category / template 枚举 | 比较模型输入白名单、程序映射键和值的完整集合 |
| 合法映射 | 穷举映射表中的所有合法组合 |
| 非法映射 | 对 category × template 的未声明组合做笛卡尔积拒绝测试 |
| chronology 默认值 | 无强信号时固定为 `chronological`，并补齐默认 Hook policy |
| flashforward | 仅允许 payoff preview、partial/full，并要求 return point |
| result-first | 固定为 payoff preview、full，并要求 return point |
| 低置信度修复 | 任一置信度低于 `0.55` 时触发唯一一次定向修复 |
| 修复上限 | `maxRepairCalls=1`，总调用数最多为 2 |
| fallback | 验证完整安全路由且支持内容不阻断 Planning |
| checkpoint | 验证未变化复用、创意或参考品类事实变化失效 |
| Planning 锁定 | Planning Architect 重分类抛出结构化冲突 |
| 用户锁定 | `authority=user`、`locked=true` 后输入变化仍复用人工合同 |
| 禁止事件 ID | 六个事件引用字段全部被 Route Gate 清除 |
| 非游戏隔离 | 所有非游戏类别拒绝游戏模板及游戏专属语义 |

## 低置信度规则

Route Gate 仍将合法但低置信度合同标记为 `allow_with_warning`。模型调用编排层会识别三项置信度中任一项低于 `0.55`，触发 `PLANNING_ROUTE_REPAIR_LOW_CONFIDENCE`。该修复与其他定向修复共享同一个单次上限；第二次结果即使仍然低置信度，也不会产生第三次调用。

## 验收标准

- 步骤17集中测试全部通过；
- 完整 `test:planning-route` 套件全部通过；
- TypeScript 类型检查通过；
- 不调用真实付费模型，测试使用可控 transport stub。
