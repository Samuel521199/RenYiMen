# Shot Decomposer 并发压测

这个工具用于测试 `ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY` 的合理取值。

它先为每个固定样本生成一个 Stage 2B 前检查点，然后让所有并发档位从相同检查点开始。故事架构、故事板和故事合同不会在每个档位重复计费。

共享检查点已经包含语义剧情评审。正式计时阶段会关闭这项与并发无关的串行评审，只测量 `Shot Decomposer → Single-take Audit → Prompt Detailer` 分段流水线。

## 先检查调用规模

```powershell
npm run benchmark:shot-concurrency -- --concurrency 1,2,3,4,6,8,10 --repeats 2 --fixtures 1
```

不带 `--live` 时只输出预计运行数量，不调用模型。

## 执行真实压测

```powershell
$env:ONE_PROMPT_VIDEO_CONCURRENCY_BENCHMARK="1"
npm run benchmark:shot-concurrency -- --live --concurrency 1,2,3,4,6,8,10 --repeats 2 --fixtures 1
```

建议第一次使用一个样本、每档两次。确认费用和运行时间后，再使用三个样本、每档三次：

```powershell
npm run benchmark:shot-concurrency -- --live --concurrency 1,2,3,4,6,8,10 --repeats 3 --fixtures 3
```

可选参数：

- `--cooldown-ms 3000`：两次规划之间的冷却时间。
- `--output reports/one-prompt-video/shot-concurrency`：报告根目录。
- `--fixtures 1|2|3`：使用产品广告、游戏广告、短剧中的前 N 个固定样本。
- `--repeats 1..20`：每个并发档位、每个样本的重复次数。

## 输出

每次压测生成独立时间戳目录：

- `report.json`：完整机器可读结果。
- `runs.csv`：每次运行的原始数据。
- `report.md`：汇总表和推荐并发。
- `seed-<fixture>.json`：保证不同并发档位输入一致的共享检查点。

推荐算法先要求成功率、模型失败率和 429 率达标，再选择分段拆解流水线 P95 最低的并发。若没有档位达标，会给出成功率优先的降级建议，并明确要求复测。
