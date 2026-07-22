# One Prompt Video 阶段 9：端到端验收与灰度执行报告

## 1. 执行结论

阶段 9 的代码、自动验收执行器、七项独立灰度开关和兼容回退已经完成。

- 阶段 9 专项验收：15/15 通过。
- One Prompt Video 全量回归：117/117 通过。
- `npm run build`：通过。
- 本阶段涉及文件 ESLint：通过。

自动验收使用匿名化、确定性的项目证据快照，不调用收费图片/视频上游。因此本报告确认的是流程合同、阻断规则、版本保护、恢复幂等和可观测性覆盖；正式灰度时仍需用真实生成媒体进行人工视觉抽检。

## 2. 已覆盖的八类场景

1. 单人物从 front 转 side 再转 back，验证三个独立 revision 不被升级覆盖。
2. 人物拿起唯一产品，验证人物和产品 hard anchor 同时选中、产品实例数保持为 1。
3. 同场景两个机位，验证 Camera Graph、轴线与 transition reference 证据齐全。
4. 大状态变化动作，验证 `requiresCut=true`、`riskLevel=high` 在提交前阻断并进入 Split Repair。
5. 30 秒旁白、BGM、SFX、字幕广告，验证音频后期模式去除随机片段原声。
6. 修改人物 front，只允许重跑依赖图计算出的 side/back、相关关键帧、片段和最终成片。
7. 失败、刷新、重启后 resume，验证 running/completed 节点不会重复提交。
8. 历史项目打开、重新生成、批准和媒体回退，验证旧 planJson 可读取且批准 revision 不被覆盖。

## 3. 量化指标

验收执行器位于 `src/services/video-orchestrator/phase9-acceptance.ts`，可接收测试、灰度日志或人工抽检形成的 evidence snapshot。

| 指标 | 自动验收结果 |
| --- | ---: |
| hard anchor 漏选率 | 0 |
| 未批准 hard anchor 时误生成普通关键帧 | 0 |
| 不安全 single-take 误提交视频 | 0 |
| 三视图被非主动覆盖 | 0 |
| 已批准 revision 被后台覆盖 | 0 |
| 重复轮询导致重复提交 | 0 |
| 生成媒体调试信息覆盖率 | 100% |
| 音频后期模式残留随机片段原声 | 0 |

调试信息覆盖同时要求：reference selection、prompt debug、quality report、artifact metadata，缺任意一项都判失败。

## 4. 灰度开关

以下开关已加入 `.env.example` 和 `.env.local.example`，默认开启以保持当前阶段能力；设置为 `false` 时只关闭对应新链路。

| 开关 | 关闭后的兼容回退 |
| --- | --- |
| `ONE_PROMPT_REFERENCE_SELECTOR_V2` | 使用旧的批准参考图顺序，hard anchor 优先，最多四张 |
| `ONE_PROMPT_THREE_VIEW_DERIVATION` | side/back 恢复独立生成，不等待 front；现有三视图不删除 |
| `ONE_PROMPT_STRICT_VALIDATION` | 跳过新统一 Validator，保留旧流程约束 |
| `ONE_PROMPT_VISUAL_QUALITY_EVAL` | 使用旧启发式媒体 URL/prompt 预检，不调用视觉模型 |
| `ONE_PROMPT_TRANSITION_REFERENCE` | 不创建、不阻断、不选择 transition reference；已有产物保留 |
| `ONE_PROMPT_UNIFIED_AUDIO_MIX` | 恢复 audioBible 原有 `stripSourceAudio` 配置 |
| `ONE_PROMPT_ARTIFACT_GRAPH_V2` | dirty 只落在修改根节点，不做依赖传播；已有 metadata 保留 |

新计划会在 `planJson.rolloutFlags` 中记录 `phase9-v1` 快照、cohort、时间和七项开关值，仅用于审计，不覆盖媒体资产。

## 5. 推荐灰度操作

### 5.1 内部项目

- `ONE_PROMPT_ROLLOUT_COHORT=internal`
- 七项开关逐项开启，每次至少完成八类验收中的相关场景。
- 观察 hard-anchor 阻断、候选质量耗时、上游失败率、resume 重复提交和音频轨道。

### 5.2 少量新项目

- 使用独立部署环境或实例，将 cohort 设置为 `new-projects-small`。
- 优先开启 Reference Selector、三视图、严格校验和 Artifact Graph。
- 视觉质量评估与完整 transition reference 应关注延迟和调用成本。

### 5.3 全量新项目

- cohort 设置为 `new-projects-all`。
- 八项量化指标连续保持目标值后再扩大流量。
- 任一零容忍指标非零，立即关闭对应开关并保留问题项目的 planJson、revision 和调试记录。

### 5.4 历史项目按需启用

- 先打开并完成读取、重新生成、批准、回退检查。
- 不批量重写历史 planJson，不清空三视图，不重新指定 active revision。
- 仅在用户主动重新生成或修改上游 artifact 后进入新链路。

## 6. 回滚原则

- 修改环境变量后重启服务即可关闭单项新能力。
- 关闭开关不会删除新字段、旧 URL、候选、质量报告或 revision。
- 已批准媒体始终保持 active，后台生成只能创建新候选，必须经用户批准才切换。
- resume 先同步运行中任务，再处理 dirty/failed 节点，不能重复提交 running/completed 节点。

## 7. 主要文件

- `src/services/video-orchestrator/rollout-flags.ts`
- `src/services/video-orchestrator/phase9-acceptance.ts`
- `src/services/video-orchestrator/phase9-acceptance.test.ts`
- `src/services/video-orchestrator/project-service.ts`
- `src/services/video-orchestrator/generation-quality-evaluator.ts`
- `src/services/video-orchestrator/reference-vision-evaluator.ts`
- `.env.example`
- `.env.local.example`
