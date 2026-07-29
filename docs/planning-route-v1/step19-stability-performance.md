# 步骤19：Tongits King 稳定性与耗时测试

## 测试方法

固定输入连续执行20次独立 Route 模型调用，不复用模型结果；随后再执行一次 checkpoint 恢复验证。

预期结果：

```text
game
→ game_bonus_payoff
→ chronological
```

执行入口：

```text
# 只显示调用预算，不请求模型
npm run test:planning-route:stability

# 20次真实调用，明确产生模型费用
npm run test:planning-route:stability:live
```

实现：

- `scripts/run-planning-route-stability.ts`
- `src/services/video-orchestrator/planning-route-stability.ts`
- `src/services/video-orchestrator/planning-route-stability.test.ts`

## 实测发现与修复

第一轮真实运行的20次结果全部把 chronology 判成 `flashforward_hook`。原因是模型错误地把游戏奖励画面当成了“高潮前置”的充分条件。

第二轮限制无明确要求的 flashforward 后，chronology 为85%，仍有3次被判为 `demonstration`，同时 P50 为8.247秒。说明普通游戏广告在没有时间结构指令时仍缺少程序级默认约束。

最终修复：

1. `flashforward_hook` 必须有用户明确的高潮/结果前置表达；
2. 游戏类别在没有明确时间结构或玩法演示意图时，程序固定使用 `chronological`；
3. 修复只经过 Route Gate，不产生额外模型调用；
4. `max_tokens` 从600降至450，仍保留2KB字节硬上限。

两份失败报告保留用于回归追踪：

- `docs/baselines/planning-route-stability-2026-07-28T18-12-00-307Z/report.json`
- `docs/baselines/planning-route-stability-2026-07-28T18-16-11-433Z/report.json`

## 最终20次真实复验

最终报告：

```text
docs/baselines/planning-route-stability-2026-07-28T18-19-48-766Z/report.json
```

| 指标 | 门槛 | 结果 | 状态 |
|---|---:|---:|---|
| category 一致率 | ≥95% | 100%（20/20） | 通过 |
| template 一致率 | ≥90% | 100%（20/20） | 通过 |
| chronology 一致率 | ≥95% | 100%（20/20） | 通过 |
| P50 API 等待 | ≤8秒 | 6.177秒 | 通过 |
| P95 API 等待 | ≤15秒 | 8.001秒 | 通过 |
| 最大正常输出 | ≤2KB | 1,177 bytes | 通过 |
| 正常修复调用 | 0 | 0 | 通过 |
| checkpoint 恢复模型调用 | 0 | 0 | 通过 |

最终 `passed=true`。

