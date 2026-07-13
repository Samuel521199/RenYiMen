# Agent 协作说明

如果用户希望你协助他开发、调试或扩展**多模型中转站 / 上游适配器**相关功能，请遵循以下约定：

- **各类 provider（厂商适配器）**统一放置在 `src/services/providers/` 目录下。
- 新增厂商时：实现 `IProviderAdapter`（见 `src/services/providers/types.ts`），在 `ProviderFactory.ts` 中注册 `providerCode` / `skuId` 映射，并视需要补充单元或集成测试。
- 网关路由应通过 **`getProviderAdapter`** 获取适配器，避免在 `src/app/api/gateway/` 中直接调用某一厂商的 HTTP 客户端。
- **阿里云百炼 DashScope**（图生视频异步）：`BailianAdapter.ts`；网关 `providerCode`：`ALIYUN_BAILIAN`；大厅 SKU 示例：`BAILIAN_WANX_I2V`。请在本地 `.env.local` 配置 **`BAILIAN_API_KEY`** 或 **`DASHSCOPE_API_KEY`**。
- **RunningHub 视频类工作流**（图生视频、首尾帧及后续同类 SKU）：在 `src/services/providers/runninghub-video-workflow.ts` 中通过 **`registerRunningHubVideoWorkflowBinding`** 或扩展默认 `DEFAULT_VIDEO_BINDINGS`，统一走「本地完整 Comfy JSON + `applyNodeInfoListToComfyWorkflow` + 清空 `nodeInfoList`」；避免仅提交 `nodeInfoList` 导致上游 Custom validation / 秒失败。可选 `preferredOutputNodeIds` 参与出视频 URL 解析。
- **RunningHub 图片字段**：`LoadImage` / `ImageLoader` 等节点需使用上传接口返回的 `api/...` 路径；网关已在 `RunningHubAdapter.generate` 内对 `nodeInfo` 中的 **公网图片 URL** 先拉取再调 `/task/openapi/upload` 替换（见 `runninghub-remote-image-upload.ts`），勿把裸 OSS 链直接交给上游。

---

## RunningHub API 集成规范

> **所有 RunningHub 工作流或 AI App 集成，必须以 `docs/runninghub-api.md` 为权威参考。**

### 接口类型区分

| 类型 | URL 路径常量 | 环境变量命名 |
|------|------------|------------|
| ComfyUI 工作流 | `V2_RUN_WORKFLOW_PREFIX`（`/openapi/v2/run/workflow`） | `RUNNINGHUB_<NAME>_WORKFLOW_ID` |
| AI App | `V2_RUN_AI_APP_PREFIX`（`/openapi/v2/run/ai-app`） | `RUNNINGHUB_<NAME>_APP_ID` |

两种接口请求体格式完全相同（均用 `nodeInfoList`）。AI App 不发送 `workflow` JSON 字段。

### 错误码处理

RunningHub 返回的 `errorCode` 是**字符串类型**（不是数字），判断时必须用字符串比较：

```typescript
// ✅ 正确
if (typeof errorCode === "string" && errorCode !== "" && errorCode !== "0") { /* 失败 */ }

// ❌ 错误：AI App 不返回数字 code 字段
if (code !== 0) { /* 会漏判 */ }
```

### 新增工作流或 AI App 的完整步骤

1. **工作流 JSON**（仅 workflow 类型）：放入 `config/runninghub/lu-<name>-workflow.json`
2. **环境变量**：`.env` + `.env.example` 添加对应 ID 和文件路径变量
3. **前端 Schema**：`src/mocks/<name>-workflow.ts`，`mapping.nodeId` 填真实节点 ID
4. **SKU 注册**：`src/app/api/skus/route.ts`，包含中英双语 `displayName` / `description`
5. **ProviderFactory**：`SKU_TO_PROVIDER` 映射 + `getProviderAdapter` switch 分支
6. **Adapter 分支**：`RunningHubAdapter.ts` 中添加识别函数和 `generate()` 处理分支
7. **预计耗时**：`src/lib/task-status-view.ts` 的 `SKU_EXPECTED_DURATION_MS`

### Anything Everywhere 节点陷阱

工作流使用 `Anything Everywhere3` 广播 VAE/CLIP 时，**API 提交不执行广播**。  
必须给 `VAEDecode` 等节点手动补充显式连线，否则报 `Required input is missing`：

```json
// ✅ VAEDecode 节点必须有显式 vae 连线
"60": {
  "inputs": {
    "samples": ["59", 0],
    "vae": ["57", 0]   // ← 必须加，不能依赖广播
  },
  "class_type": "VAEDecode"
}
```
