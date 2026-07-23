# One Prompt Video 阶段 1 执行报告

执行日期：2026-07-21

## 1. 执行结论

阶段 1 的代码实现和自动化回归已经完成，且没有覆盖现有三视图、重新生成、回退和用户提示词权威性能力。

本阶段完成了四项核心改造：

1. Reference Selector 使用统一的正向视角、正向时效和负向冲突评分语义。
2. hard person/product 先于普通配额入选，高冲突候选先淘汰，最终最多九张。
3. 人物 front 成为主资产，side/back 明确派生自已批准的 front，并通过 Artifact 依赖图传播 dirty 状态。
4. 增加可选的轻量视觉冲突评估；视觉模型只补充分数和原因，不能绕过后端确定性选择器直接选图。

真实图片模型生成出的新人物三视图仍需在实际项目中做一次人工身份一致性验收。该项涉及真实上游调用、模型额度和具体测试项目，因此本报告只标记为“待真实项目验收”，不以合成测试冒充人工结论。

## 2. 评分公式说明

最终实现为：

```text
finalScore =
  relevanceScore * 0.45
  + viewMatchScore * 0.25
  + recencyScore * 0.20
  - conflictScore * 0.35
```

阶段 1 执行请求中展示的 `viewMatchScore`、`recencyScore` 前曾出现减号，但同一要求又明确规定“越匹配越大”“越近越大”。若继续相减，会让更匹配、更新的图片得分更低。因此本次按执行方案原文和字段语义使用加号，只对 `conflictScore` 使用减号。

## 3. 已落地内容

### 3.1 三视图派生与生成门禁

- 资产和一致性参考都支持 `sourceView`、`sourceArtifactId`、`orientation`、`viewGenerationMode`。
- front 标记为 `primary`；side/back 标记为 `derived_from_front`。
- side/back 在同人物 front 未批准前不会提交上游任务。
- 界面的卡片入口和详情入口都会禁用重新生成，并显示等待 front 批准的中英文原因。
- side/back 生成时只允许使用同一人物已批准的 front 作为身份参考。
- front 内容发生变化后，依赖的 side/back 进入 dirty 状态，但旧 revision 仍由原有媒体历史机制保留。
- 重新规划会按 `assetId` 或 `anchorId + assetView` 恢复已批准的历史三视图，不会无条件清空或重生成。

### 3.2 Reference Selector v2

- 新增独立的确定性选择器，评分、配额、硬选和淘汰不再散落在项目服务中。
- 自动推断目标人物朝向，front、side、back 优先选择对应 view。
- 目标 side/back 缺少对应批准视图时允许回退 front，并记录明确原因。
- 当前帧可见的 hard person/product 必须全部选入；缺少批准候选会直接阻断生成。
- hard identity 不参与普通风格图配额竞争。
- 高冲突候选会在补配额前淘汰，并保留错误人物、错误产品/logo、错误文字或场景冲突等原因。
- 输出保存策略版本、目标朝向、最终 view、回退原因、必选项和拒绝原因，便于调试解释。

### 3.3 轻量视觉冲突评估

- 对有可访问图片 URL 的候选调用视觉理解模型，评估人物一致性、产品/logo、错误文字、场景布局和朝向。
- 视觉结果只能更新 `conflictScore`、`viewMatchScore`、检测朝向和原因。
- 最终选择始终重新交给确定性选择器完成。
- 未配置密钥、显式关闭或视觉调用失败时采用 fail-open：保留确定性结果、记录 warning，不让辅助服务造成整条生产链不可用。
- 新增环境变量：`ALIYUN_REFERENCE_VISION_MODEL`、`ONE_PROMPT_REFERENCE_VISION_EVAL`、`ONE_PROMPT_REFERENCE_VISION_TIMEOUT_MS`。

## 4. 自动化验证

`npm run test:one-prompt-video` 共 21 个测试通过，0 个失败，其中阶段 1 覆盖：

- 正面选择 front。
- 背面选择 back。
- side 缺失回退 front 并记录原因。
- hard person 与 hard product 同时入选。
- style 不能替代 hard identity。
- 高冲突候选明确淘汰。
- front-first 生成门禁与历史批准三视图保留。
- 视觉评估只补充分数，最终选择权仍属于确定性算法。

TypeScript 独立类型检查通过。生产构建结果以本次任务最终交付说明为准。

## 5. 真实项目验收清单

在下一次可用测试项目中执行以下一次性验收，即可关闭阶段 1 的人工检查项：

1. 新建单人物项目，先确认 side/back 按钮处于等待状态。
2. 生成并批准 front，确认 side/back 自动恢复可生成状态。
3. 生成 side/back，人工确认脸型、服装、配色、年龄和关键识别特征一致。
4. 创建正面、侧面和背面关键帧，检查 prompt debug 中选中的人物 view 与画面朝向一致。
5. 修改 front 并重新生成，确认 side/back 变 dirty，且媒体历史仍可回退到旧 revision。
6. 注入一张含错误 logo 或错误人物的候选图，确认 selector 显示淘汰原因且不提交该图。

人工验收应保存项目 ID、三张图片 revision、selector debug 和操作人结论，不应把临时签名 URL 或密钥提交到仓库。
