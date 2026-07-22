# One Prompt Video 阶段 3 执行报告

执行日期：2026-07-21

## 1. 执行结论

阶段 3 的代码实现和自动化验证已经完成。

系统现在只有一个 Single-take Audit 真源。规划 Split Repair、统一 Plan Validator、批量视频生成、单段重新生成和失败恢复都使用同一套审计语义。结构性切镜问题不再通过字符串替换伪装成“连续运动”。

HappyHorse 被明确声明为只支持一个 `first_frame` 硬图片输入。用户批准的尾帧继续保留，但用途统一为结束状态合同、Prompt 软目标和生成后视觉连续性检查依据，不再通过 FFmpeg 贴入单个视频片段。

## 2. Single-take Audit 真源

新增 `single-take-audit.ts`，统一输出：

```ts
interface SingleTakeAuditResult {
  passed: boolean;
  action: "allow" | "split_repair" | "block_stage_2b";
  issues: SingleTakeAuditIssue[];
  auditedSegmentNos: number[];
  auditVersion: "single-take-audit-v1";
}
```

执行语义：

- 审计通过：允许生成。
- `requiresCut=true`：不可通过重复生成解决，直接阻断并建议回到 Stage 2B。
- `riskLevel=high`：规划阶段进入 Split Repair；修复后仍失败则阻断。
- `physicallyReachable=false`：规划阶段进入 Split Repair；修复后仍失败则阻断。
- 缺少 start/end/motion/single-take contract、checkpoint 含内部切镜、结构字段含正向切镜语义：阻断。
- `alternate_view` 缺少 180 度轴线或左右关系锁：阻断并建议回到 Stage 2A。

明确的禁止语句，例如 “Do not cut or dissolve” 不会被误判为要求切镜。

## 3. 已统一的入口

- 三阶段规划结束前的 Split Repair 循环。
- 统一 Plan Validator。
- 批量视频任务提交。
- 单段视频重新生成。
- 失败项目恢复。

失败恢复会先重新执行结构审计。如果已有片段缺少通过的端帧连续性报告、被视觉模型判断不可达，或连续性评估本身失败，不会直接恢复到审核状态，也不会盲目重新生成。

## 4. HappyHorse 尾帧语义

Provider capability 现在明确为：

```ts
{
  acceptsFirstFrameImage: true,
  acceptsLastFrameImage: false,
  endFrameSemanticMode: "soft_prompt_target"
}
```

实际提交给 HappyHorse 的 `media` 只有：

```ts
[{ type: "first_frame", url: firstFrameUrl }]
```

尾帧 URL 仅用于：

1. 确认用户已经审核结束状态。
2. 把结束状态合同编译进视频 Prompt。
3. 生成完成后与真实末帧进行视觉比较。

Prompt Debug 只把首帧列为模型选中图片，尾帧放在 `endFrameReviewReferenceUrl`，并明确标记不是硬输入。

## 5. 移除片段内机械贴帧

已删除 `enforceSegmentEndFrameLocally` 以及以下片段内处理：

- 下载批准尾帧。
- 把尾帧制作成静帧视频。
- 在片段尾部执行 `xfade=transition=fade`。
- 强制停留尾帧若干毫秒。

HappyHorse 原始生成结果只做持久化，不再改变片段视觉内容。

最终成片阶段仍可读取 `finalTransitionPlan` 执行明确规划的 dissolve/fade。没有对应 transition plan 时默认使用 hard cut，不再默认 dissolve。

## 6. 真实末帧视觉连续性检查

生成完成后执行以下流程：

```text
持久化原始视频
  -> FFmpeg 提取最后采样帧
  -> 视觉模型比较最后采样帧、批准尾帧、endFrameContract 和 motionContract
  -> pass / retry_generation / return_stage_2b / evaluation_failed
```

判断结果：

- `pass`：片段进入 ready。
- `retry_generation`：把视觉模型的 `retryInstruction` 编译进下一次 Prompt，最多按 `ONE_PROMPT_END_FRAME_MAX_RETRIES` 重试，默认两次。
- `return_stage_2b`：保留生成结果及质量报告，阻断恢复并要求回到 Stage 2B。
- `evaluation_failed`：不盲目重新生成，要求先恢复 FFmpeg、媒体访问或视觉服务后重新评估。

每个生成结果在重试前都会进入媒体 revision 历史，仍然可以回退查看。

相关环境变量：

```text
ALIYUN_END_FRAME_VISION_MODEL=qwen-vl-max
ONE_PROMPT_END_FRAME_VISION_EVAL=true
ONE_PROMPT_END_FRAME_VISION_TIMEOUT_MS=45000
ONE_PROMPT_END_FRAME_MAX_RETRIES=2
```

## 7. 验证结果

`npm run test:one-prompt-video` 共 44 个测试通过，0 个失败。阶段 3 新增覆盖：

- 连续可达计划通过统一审计。
- 明确禁止切镜的文字不会误报。
- `requiresCut` 直接回退 Stage 2B。
- high risk 和 physically unreachable 请求 Split Repair。
- 正向 dissolve/cut 语义不会被 Prompt Compiler 替换隐藏。
- 端帧视觉结果映射为通过、重新生成或 Stage 2B。
- HappyHorse 只提交一个首帧硬输入。
- 片段内不存在尾帧贴图和 boundary xfade。
- 无 transition plan 时最终合成默认 hard cut。
- 规划、运行 Validator 和失败恢复共用同一个审计服务。

TypeScript 独立类型检查已经通过。

## 8. 仍需真实项目抽查

自动测试不能代替真实视频内容判断。下一次有可用模型额度的测试项目需要抽查：

1. Prompt Debug 中只有首帧是硬图片输入。
2. HappyHorse 原始片段末尾没有机械叠化或静帧停留。
3. 末帧视觉报告能正确区分小差距、可修复差距和不可达动作。
4. 可修复差距的第二次 Prompt 包含视觉模型生成的 retry instruction。
5. 不可达动作恢复时明确显示 Stage 2B，而不是再次扣费生成。
