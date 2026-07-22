# RunningHub 集成规范

本文以当前适配器实现为准，是本项目新增 RunningHub 工作流或 AI App 的权威参考。

## 1. 认证与基础地址

- API Key：`RUNNINGHUB_API_KEY`
- 基础地址：`RUNNINGHUB_API_BASE_URL`，默认 `https://www.runninghub.cn`
- 请求使用 `Authorization: Bearer <API Key>`；上传接口同时在表单中传 `apiKey`。

密钥只配置在本地环境文件或部署 Secret 中。

## 2. 接口类型

| 类型 | 创建任务路径 | ID 变量后缀 | 请求约束 |
|---|---|---|---|
| ComfyUI 工作流 | `POST /openapi/v2/run/workflow/{workflowId}` | `_WORKFLOW_ID` | 可发送完整 `workflow` JSON |
| AI App | `POST /openapi/v2/run/ai-app/{appId}` | `_APP_ID` | 只发送 `nodeInfoList`，不发送 `workflow` |

两类接口都使用扁平的节点覆盖项：

```json
{
  "nodeInfoList": [
    {
      "nodeId": "36",
      "fieldName": "image",
      "fieldValue": "api/example.png"
    }
  ]
}
```

工作流也可以发送完整图：

```json
{
  "workflow": "<完整 Comfy JSON 字符串>",
  "nodeInfoList": []
}
```

## 3. 查询任务

当前适配器按用途调用：

- `POST /task/openapi/status`：查询状态。
- `POST /task/openapi/outputs`：获取输出。
- `POST /openapi/v2/query`：读取包含 `usage.consumeCoins` 等信息的详情。

适配器负责把上游状态归一化，业务页面不应直接解析这些响应。

## 4. 错误码

AI App 和部分 v2 响应的 `errorCode` 是字符串。必须按字符串判断，空字符串或 `"0"` 才表示没有业务错误：

```ts
if (typeof errorCode === "string" && errorCode !== "" && errorCode !== "0") {
  // 失败
}
```

工作流响应还可能使用数字 `code`，适配器保留兼容判断。不要只检查 HTTP 状态，也不要只检查数字 `code`。

## 5. 图片和视频输入

`LoadImage`、`ImageLoader` 等节点不能直接使用公网 OSS/CDN URL。`RunningHubAdapter.generate()` 会扫描 `nodeInfoList` 的 `image`、`*.image`、`video` 和 `*.video` 字段：

1. 下载公网 URL；
2. 调用 `POST /task/openapi/upload`；
3. 使用响应的 `data.fileName` 替换为 RunningHub 内部路径。

实现位于 `src/services/providers/runninghub-remote-image-upload.ts`。当前网关限制图片 30 MB、视频 200 MB；同一请求内相同 URL 只上传一次。

## 6. 视频工作流必须提交完整 JSON

图生视频、首尾帧视频和后续同类 SKU 统一在 `src/services/providers/runninghub-video-workflow.ts` 注册：

- 扩展 `DEFAULT_VIDEO_BINDINGS`，或调用 `registerRunningHubVideoWorkflowBinding()`。
- 保存完整工作流到 `config/runninghub/lu-<name>-workflow.json`。
- 使用 `applyNodeInfoListToComfyWorkflow()` 把业务参数写入副本。
- 提交时发送 `workflow`，并清空 `nodeInfoList`。
- 如输出节点不稳定，配置 `preferredOutputNodeIds`。

仅提交 `nodeInfoList` 可能触发 RunningHub Custom validation 并立即失败。环境中找不到 JSON 时虽然存在兼容回退，但不应把它当作正式配置。

## 7. Anything Everywhere 陷阱

API 执行不会替 `Anything Everywhere3` 完成 VAE/CLIP 广播。所有必需输入必须在保存的工作流 JSON 中显式连线，例如：

```json
{
  "60": {
    "inputs": {
      "samples": ["59", 0],
      "vae": ["57", 0]
    },
    "class_type": "VAEDecode"
  }
}
```

## 8. 新增集成检查表

### ComfyUI 工作流

1. 添加 `config/runninghub/lu-<name>-workflow.json`。
2. 在 `.env.example` 添加 `RUNNINGHUB_<NAME>_WORKFLOW_ID` 和文件变量。
3. 在 `src/mocks/<name>-workflow.ts` 添加 Schema，使用真实节点 ID。
4. 在 `src/app/api/skus/route.ts` 添加中英文名称和说明。
5. 在 `ProviderFactory.ts` 注册 SKU/provider。
6. 在 `RunningHubAdapter.ts` 增加识别和处理分支；视频类同时注册 binding。
7. 在 `src/lib/task-status-view.ts` 配置预计耗时。
8. 验证创建、轮询、错误码、上传替换和输出 URL 解析。

### AI App

步骤相同，但使用 `_APP_ID`，调用 `/run/ai-app/`，且绝不发送 `workflow` JSON。
