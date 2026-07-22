# One Prompt Video 阶段 5 执行报告

执行日期：2026-07-21

## 结论

阶段 5 已完成代码落地。项目现在将“只服务生成一致性的 Transition Reference”和“会进入最终成片的 Generated Bridge”建模为两类独立产物，分别维护生成状态、质量报告、审核锁定状态和媒体版本，不再复用同一状态概念。

## Transition Reference 触发与继承

Camera Graph 会为以下目标机位建立 Transition Reference 需求：

- `new_camera_setup`，除非计划明确声明不需要从旧机位继承。
- `alternate_view`。
- 父关键帧无法直接提供目标构图的 `derived_reframe`。
- 计划明确请求继承旧场景布局、光线、固定物体或人物位置的新机位。

每个产物记录父子 camera、父子 segment、camera relation、继承范围、触发理由和父关键帧。历史计划没有这些字段时，会在读取项目时兼容性补齐，不覆盖已有三视图、关键帧或媒体 revision。

## 短期模式

默认配置为：

```text
ONE_PROMPT_TRANSITION_REFERENCE_MODE=short
```

短期模式直接使用父机位已批准并锁定的关键帧。它以 `space_layout` 身份进入 Reference Selector，并且带有强制用途说明：只继承空间布局、构图、光线、固定物体和主体位置；不得继承人物或产品身份、Logo、文字及冲突物体。人物和产品仍必须由 hard anchor 参考图提供。

父关键帧未批准时，目标机位生成会等待；所需空间参考未进入最终 selection 时，生成会被硬阻断。

## 完整模式

配置为 `full` 后，生产链为：

```text
已批准父机位关键帧
  -> Transition Reference 视频
  -> FFmpeg 抽取 20% / 40% / 60% / 80% 候选帧
  -> 逐帧实际媒体质量评估
  -> 自动选择通过项中的最高分
  -> 用户审核并锁定
  -> 作为目标机位 space_layout/composition 强制参考
```

完整模式未审核锁定前，目标机位关键帧和子分镜图不能绕过阻断。Transition Reference 视频和候选帧只用于生成一致性，不会进入最终合成。

## Generated Bridge

当 `finalTransitionPlan.visualMode=generated_bridge` 时，系统建立独立 bridge artifact：

- 使用相邻正式片段和边界关键帧生成多候选桥接视频。
- 对实际候选视频执行质量评估，在通过项中择优。
- 用户可以查看、改选、批准、锁定和回退历史版本。
- bridge 未质量通过、审核和锁定时，最终合成硬阻断。
- 合成时 bridge 作为独立媒体插入正式片段之间；Transition Reference 不会被插入。

## 依赖失效与版本保留

- 父机位关键帧被解锁、重新生成、改选或媒体回退后，依赖它的 Transition Reference 自动变为待重新确认并解除锁定。
- 相邻正式视频被重新生成、改选或媒体回退后，相关 Generated Bridge 自动变为待重新生成/审核并解除锁定。
- 旧媒体仍保留在 revision 历史中，可以独立回退；失效不会静默删除旧版本。
- 人物 front/side/back 三视图及 front-first 派生规则未被修改或覆盖。

## 界面与接口

工作台新增“机位过渡参考与成片桥接”面板，可查看继承来源、relation、继承范围、触发理由、状态、候选媒体和质量结果，并执行生成、审核、锁定及回退。边界关键帧也可明确锁定为父机位空间参考。

新增接口分别处理 Transition Reference 与 Generated Bridge 的生成和批准，现有媒体回退接口支持两种新媒体类别。

## 验证

- `npm run test:one-prompt-video`：69 项通过，0 项失败。
- `npm run build`：通过；仅保留项目已有的 React Hook lint warnings。
- `git diff --check`：无空白错误；仅有工作区既有的 LF/CRLF 提示。

本次未调用付费上游实际生成 Transition Reference 或 Generated Bridge，因此生产环境还需各跑一条真实媒体链，确认模型额度、FFmpeg/FFprobe、OSS 持久化和视觉评估服务可用。
