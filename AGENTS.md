# Agent 协作说明

如果用户希望你协助他开发、调试或扩展**多模型中转站 / 上游适配器**相关功能，请遵循以下约定：

- **各类 provider（厂商适配器）**统一放置在 `src/services/providers/` 目录下。
- 新增厂商时：实现 `IProviderAdapter`（见 `src/services/providers/types.ts`），在 `ProviderFactory.ts` 中注册 `providerCode` / `skuId` 映射，并视需要补充单元或集成测试。
- 网关路由应通过 **`getProviderAdapter`** 获取适配器，避免在 `src/app/api/gateway/` 中直接调用某一厂商的 HTTP 客户端。
- **阿里云百炼 DashScope**（图生视频异步）：`BailianAdapter.ts`；网关 `providerCode`：`ALIYUN_BAILIAN`；大厅 SKU 示例：`BAILIAN_WANX_I2V`。请在本地 `.env.local` 配置 **`BAILIAN_API_KEY`** 或 **`DASHSCOPE_API_KEY`**。
- **RunningHub 视频类工作流**（图生视频、首尾帧及后续同类 SKU）：在 `src/services/providers/runninghub-video-workflow.ts` 中通过 **`registerRunningHubVideoWorkflowBinding`** 或扩展默认 `DEFAULT_VIDEO_BINDINGS`，统一走「本地完整 Comfy JSON + `applyNodeInfoListToComfyWorkflow` + 清空 `nodeInfoList`」；避免仅提交 `nodeInfoList` 导致上游 Custom validation / 秒失败。可选 `preferredOutputNodeIds` 参与出视频 URL 解析。
- **RunningHub 图片字段**：`LoadImage` / `ImageLoader` 等节点需使用上传接口返回的 `api/...` 路径；网关已在 `RunningHubAdapter.generate` 内对 `nodeInfo` 中的 **公网图片 URL** 先拉取再调 `/task/openapi/upload` 替换（见 `runninghub-remote-image-upload.ts`），勿把裸 OSS 链直接交给上游。
