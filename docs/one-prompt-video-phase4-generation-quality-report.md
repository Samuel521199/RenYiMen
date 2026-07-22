# One Prompt Video 阶段 4 执行报告

执行日期：2026-07-21

## 结论

阶段 4 已完成代码落地。启发式 URL、Prompt 长度和切镜词检查只保留为提交前快速检查或上游失败诊断；生成成功后的最终质量结论改为读取实际图片或实际视频采样帧，不再用 Prompt 长度制造 identity/layout/continuity 分数。

## 实际媒体质量评估

- 图片评估同时提交：实际候选图、目标合同、选中的参考图、参考用途和最终 Prompt。
- 覆盖资产图片、边界关键帧和 motion checkpoint 图片。
- 输出 identity、layout、prompt alignment、continuity、人物/产品实例数、错误文字、可见瑕疵、通过结论、重试指令和建议回退阶段。
- 视频先下载并用 FFprobe 读取元数据，再用 FFmpeg 提取首帧、25%、50%、75%和末帧。
- 视频评估同时检查首帧一致性、身份连续性、实例数量、空间漂移、跳切/瞬移/融化/换景、checkpoint 顺序、结束状态和 single-take。
- 视觉服务不可用或 FFmpeg 失败时，报告明确标记为未通过并要求恢复评估；系统不会回退到启发式伪评分。

## 多候选与择优

新增 `VideoGenerationCandidate` 持久化模型和迁移。图片、子分镜图片与视频默认每批生成 2 个候选，可用环境变量调整到 1–4 个：

```text
ONE_PROMPT_IMAGE_CANDIDATE_COUNT=2
ONE_PROMPT_VIDEO_CANDIDATE_COUNT=2
ONE_PROMPT_GENERATION_MAX_RETRIES=2
```

同批候选全部成为终态后才执行择优，避免使用第一个完成的结果。每个成功候选都有独立质量报告和综合分；系统只在通过项中选择最高分。所有候选未通过时：

- `generation`：把视觉模型给出的 retryInstruction 编译进下一次 Prompt，并按上限重试。
- `stage3`：停止生成，要求回到 Prompt/合同编译阶段。
- `stage2b`：停止生成，要求修复结构或不可达动作。
- `manual`：评估基础设施不可用，停止并要求人工处理。

## 用户改选和人工接受

关键帧、资产图、子分镜图和视频详情中可预览候选、查看综合分及问题并切换候选。未通过项需要二次确认才能人工接受。人工接受后：

```text
userAccepted = true
passed = false
originalPassed = false
```

系统不会把人工接受改写成自动质检通过，审计记录和原始质量结论均保留。切换前的当前媒体继续进入 revision 历史，可使用既有回退功能。

## 兼容性

- 保留 `imageTaskId`、`clipTaskId`、`imageUrl` 和 `clipUrl` 作为历史项目与现有界面的当前选中结果字段。
- 新候选通过独立表保存，历史单任务仍可同步；历史成功任务也改用实际媒体质量评估。
- 三视图 front/side/back 数据、front-first 派生规则、重新生成和媒体回退未被覆盖。

## 验证

- `npx prisma validate`：通过。
- `npx prisma migrate deploy`：新增候选表迁移已应用到当前本机 PostgreSQL。
- `npm run test:one-prompt-video`：53 项通过，0 项失败。
- `npm run build`：通过；只有项目中既有的 React Hook lint warnings。
- 当前运行环境已检测到 FFmpeg、FFprobe 和质量视觉模型所需的 API Key。

部署到其他环境时仍需在对应数据库执行迁移，并确认 FFmpeg/FFprobe、DashScope API Key 和质量视觉模型配额。
