# Shot Decomposer 并发压测

这个工具用于测试 `ONE_PROMPT_VIDEO_SHOT_DECOMPOSER_CONCURRENCY` 的合理取值。

它先为每个固定样本生成一个 Stage 2B 前检查点，然后让所有并发档位从相同检查点开始。故事架构、故事板和故事合同不会在每个档位重复计费。

共享检查点已经包含语义剧情评审。正式计时阶段会关闭这项与并发无关的串行评审，只测量 `Shot Decomposer → Single-take Audit → Prompt Detailer` 分段流水线。

## 一行命令执行首轮真实压测

```powershell
npm run benchmark:shot-concurrency:live
```

这个命令会先让并发 `1、4、8、10` 各跑一次，排除失败、429 和明显拥塞档位，再自动选择最快的两个并发各补跑两次。它使用一个产品广告样本，调用真实文本模型并生成完整报告。

共享检查点生成阶段会把故事合同修复上限提高到三次。如果仍因模型随机输出产生非法故事引用，工具会保留已经完成的 Planning Architect 结果，只重新生成 Storyboard Artist，最多尝试三轮。并发计时在共享检查点成功后才开始。

## 只查看预计调用规模

```powershell
npm run benchmark:shot-concurrency
```

这个命令不会调用模型。

## 可选：扩大样本

如需扩大到三个样本，仍然使用同一个自适应流程：

```powershell
npm run benchmark:shot-concurrency:live -- --fixtures 3
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
