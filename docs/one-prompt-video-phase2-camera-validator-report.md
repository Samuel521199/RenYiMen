# One Prompt Video 阶段 2 执行报告

执行日期：2026-07-21

## 1. 执行结论

阶段 2 已完成。Camera Graph 不再只是规划日志中的静态数据，而是实际参与参考图选择、关键帧和子分镜图片提示词、视频提示词、Single-take 审计及生成前硬校验。

统一 Validator 返回结构化 `PlanValidationIssue`，所有 error 都会阻止对应上游任务提交。错误信息包含 artifact、中文原因和建议回退阶段；旧的“Single-take 审计失败但清理文字后继续生成”路径已经删除。

## 2. Camera Graph 扩展

在保留 `cameraId`、`segmentNos`、`locationId` 和 relation edge 的基础上，Camera Graph node 已增加以下可选字段：

```ts
parentCameraId?: string;
parentSegmentNo?: number;
axisDescription?: string;
framingRange?: string;
movementStyle?: string;
spatialLayoutLock?: string;
relationToParent?: CameraRelation;
missingInfo?: string[];
inheritanceReasonZh?: string;
```

归一化同时兼容 camelCase 和 snake_case。历史计划缺少这些新字段时仍能读取，不会因可选字段不存在而损坏；一旦进入重新生成，仍必须通过生产安全校验。

Storyboard Artist 的输出 schema 和 Shot Decomposer、Prompt Detailer 指令也已同步补充，不再只依靠后端猜测继承关系。

## 3. Camera Graph 运行语义

新增统一 Camera Graph 解析器，对七种 relation 输出明确的继承范围：

- `same_camera_setup`：构图、轴线、空间布局和光线。
- `same_axis`：轴线和空间方向，允许景别变化。
- `derived_reframe`：主体关系和布局，重新计算构图边界。
- `same_spatial_context`：地点、固定物体和光线，不把父帧当身份来源。
- `same_subject_group`：只继承主体组合，父帧不作为 identity/layout 替代品。
- `alternate_view`：强制检查 180 度轴线和左右关系。
- `new_camera_setup`：要求 transition reference 或明确说明无需继承。

运行接入情况：

1. Reference Selector 会把符合继承范围的父机位批准关键帧加入 `space_layout` 候选，并明确禁止替代 hard person/product identity。
2. `new_camera_setup` 不会偷偷选择上一机位构图，而是读取 transition reference。
3. 关键帧、micro-shot 和视频 Prompt Compiler 都会写入 Camera Graph inheritance contract。
4. 视频 Prompt 额外写入 axis、左右关系和新机位来源的 audit constraints。
5. Single-take 规划审计和运行时 Validator 都会读取 Camera Graph。

## 4. 统一 Validator

新增统一结构：

```ts
interface PlanValidationIssue {
  code: string;
  severity: "warning" | "error";
  artifactId?: string;
  messageZh: string;
  retryFromStage?: string;
}
```

当前硬校验覆盖：

- segment 时长必须为 3 至 15 秒，总时长必须等于项目时长。
- keyframe 数量、连续编号、segment 编号和首尾引用必须连续。
- 每个 segment 必须有 start/end frame、motion 和 single-take contract。
- event、anchor、camera、keyframe 引用必须存在。
- start/end frame contract 不能描述运动过程。
- motion checkpoint 不能包含 cut、dissolve、montage、switch angle 等内部切镜语言。
- `requiresCut=true`、`riskLevel=high`、`physicallyReachable=false` 均为 error。
- hard anchor 必须有批准图片并进入最终 reference selection。
- `alternate_view` 必须提供轴线与左右空间锁。
- `new_camera_setup` 必须有 transition reference 或明确无需继承，且 `missingInfo` 必须解决。

`PlanValidationError` 保留完整 issues，面向界面的错误字符串也会显示 artifact、中文原因和建议回退阶段。

## 5. 阻断位置

硬校验已接入：

- 三阶段规划最终输出。
- 普通边界关键帧选择和生成。
- 人物/产品一致性资产生成的结构安全检查。
- micro-shot 单张重生成与批量生成。
- 单段视频重新生成。
- 批量视频任务提交。

因此不存在通过单帧重新生成、单段重新生成或后台续提交流程绕过 Validator 的入口。

## 6. 自动化验证

`npm run test:one-prompt-video` 共 30 个测试通过，0 个失败。阶段 2 新增测试覆盖：

- 历史 Camera Graph 缺少新可选字段仍可兼容读取。
- 时长、总时长、关键帧数量和首尾引用错误。
- render contract 缺失与 event/anchor/camera 引用错误。
- 帧合同运动过程、checkpoint 切镜词和三类 single-take 硬风险。
- 新机位空间来源门禁。
- alternate view 的 180 度轴线与左右关系门禁。
- hard anchor 批准及最终入选门禁。
- 七类 Camera Graph 继承指令的结构化解析。
- 所有提示词、Reference Selector、规划和重新生成入口的接线检查，并确认旧软化提交路径已移除。

TypeScript 独立类型检查和 `git diff --check` 均通过。生产构建结果以本次任务最终交付说明为准。
