# RunningHub OpenAPI 参考文档

> 本文档为集成 RunningHub 工作流或 AI App 时的权威参考。  
> 每次新增 RunningHub 相关功能，均以此文档为准。

---

## 1. 认证

所有接口使用 Bearer Token 认证：

```
Authorization: Bearer ${RUNNINGHUB_API_KEY}
```

API Key 为 32 位字符串，存储在环境变量 `RUNNINGHUB_API_KEY`。

---

## 2. 接口类型对比

| 类型 | URL 路径 | 适用场景 |
|------|---------|---------|
| **ComfyUI 工作流** | `POST /openapi/v2/run/workflow/{workflowId}` | 自定义 ComfyUI 工作流，可发送完整 `workflow` JSON |
| **AI App** | `POST /openapi/v2/run/ai-app/{appId}` | RunningHub 平台封装的 AI 应用，仅传 `nodeInfoList` |

> **重要**：两种接口的请求体格式完全相同（均使用 `nodeInfoList`），区别仅在 URL 路径。  
> AI App 不需要也不接受 `workflow` JSON 字段。

---

## 3. 提交任务

### 3.1 运行 ComfyUI 工作流

```
POST /openapi/v2/run/workflow/{workflowId}
```

### 3.2 运行 AI App

```
POST /openapi/v2/run/ai-app/{appId}
```

### 请求体（两种接口通用）

```json
{
  "nodeInfoList": [
    {
      "nodeId": "36",
      "fieldName": "image",
      "fieldValue": "api/95e5a50cc6a527af109740520aa8e8b4b5185d4b6e2c4b0959fe72af5edad9cd.jpg",
      "description": "可选的字段描述"
    },
    {
      "nodeId": "82",
      "fieldName": "index",
      "fieldValue": "2",
      "description": "像素选择（1=1k, 2=2k, 3=3k, 4=4k, 5=6k, 6=8k）"
    }
  ],
  "instanceType": "default",
  "usePersonalQueue": "false"
}
```

仅 ComfyUI 工作流支持额外字段：

```json
{
  "workflow": "<完整 ComfyUI JSON 字符串>",
  "nodeInfoList": [],
  "addMetadata": true
}
```

### 请求参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `nodeInfoList` | List | 必填 | 节点参数覆盖列表，每项含 `nodeId` / `fieldName` / `fieldValue` |
| `workflow` | String | 可选（仅 workflow） | 完整 ComfyUI JSON 字符串；发送后 `nodeInfoList` 通常清空为 `[]` |
| `instanceType` | String | 可选 | `default`（24G 显存）/ `plus`（48G 显存） |
| `usePersonalQueue` | Boolean | 可选 | 个人独占队列，串行执行，避免 OOM |
| `addMetadata` | Boolean | 可选 | 是否在输出图片中写入工作流元数据 |
| `retainSeconds` | Integer | 可选 | 企业 Key 生效，实例保留时长（10~180 秒），减少冷启动 |
| `webhookUrl` | String | 可选 | 任务完成时回调的 URL |

### 提交响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "RUNNING",
  "errorCode": "",
  "errorMessage": "",
  "results": null,
  "clientId": "f828b9af25161bc066ef152db7b29ccc",
  "promptTips": "{\"result\": true, \"error\": null, \"outputs_to_execute\": [\"4\"], \"node_errors\": {}}"
}
```

> `errorCode` 和 `errorMessage` 均为**字符串类型**（非数字），空字符串表示无错误。  
> 提交成功时 `status` 为 `RUNNING` 或 `QUEUED`，`results` 为 `null`。

---

## 4. 查询任务结果

```
POST /openapi/v2/query
```

```json
{ "taskId": "2013508786110730241" }
```

### 查询响应示例

```json
{
  "taskId": "2013508786110730241",
  "status": "SUCCESS",
  "errorCode": "",
  "errorMessage": "",
  "failedReason": {},
  "usage": {
    "consumeMoney": null,
    "consumeCoins": null,
    "taskCostTime": "0",
    "thirdPartyConsumeMoney": null
  },
  "results": [
    {
      "url": "https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/.../output.png",
      "nodeId": "2",
      "outputType": "png",
      "text": null
    }
  ],
  "clientId": "",
  "promptTips": ""
}
```

### 任务状态枚举

| status | 含义 |
|--------|------|
| `QUEUED` | 排队中 |
| `RUNNING` | 运行中 |
| `SUCCESS` | 成功 |
| `FAILED` | 失败 |

### results 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | String | 输出文件 URL，**有效期 24 小时**，请及时下载或转存 |
| `nodeId` | String | 生成该结果的节点 ID |
| `outputType` | String | 文件扩展名，如 `png` / `mp4` / `txt` |
| `text` | String | 纯文本输出时有值（如提示词反推结果） |

---

## 5. 图片上传

图片上传接口用于将本地/OSS 图片转换为 RunningHub 内部 `api/...` 路径，  
`LoadImage` / `ImageLoader` 等节点必须使用此路径，**不能直接传公网 URL**。

```
POST /openapi/v2/media/upload/binary
Authorization: Bearer ${RUNNINGHUB_API_KEY}
Content-Type: multipart/form-data

file=@/path/to/image.png
```

### 上传响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "type": "image",
    "download_url": "xxxx.png",
    "fileName": "openapi/xxxx.png",
    "size": "3490"
  }
}
```

> 本项目中图片上传已在 `RunningHubAdapter.generate` 内自动处理：  
> `nodeInfo` 中的公网 URL 会被自动拉取并调用上传接口替换为 `api/...` 路径（见 `runninghub-remote-image-upload.ts`）。

---

## 6. 图片输入的三种方式

| 方式 | 格式 | 说明 |
|------|------|------|
| 公网 URL | `"https://example.com/image.png"` | 网关自动上传并替换 |
| Base64 Data URI | `"data:image/png;base64,iVBOR..."` | 直接嵌入 |
| RH 内部路径 | `"api/95e5a50c...cd.jpg"` | 上传接口返回值，直接使用 |

---

## 7. 错误处理规范

| 字段 | 类型 | 说明 |
|------|------|------|
| `errorCode` | **String** | 错误码（非数字！），空字符串表示无错误 |
| `errorMessage` | String | 错误具体描述 |
| `failedReason` | Object | ComfyUI 内部失败原因（节点名、堆栈等） |

常见错误码：

| errorCode | 含义 |
|-----------|------|
| `"1101"` | Node info error，nodeInfoList 中节点 ID 或字段名不正确 |
| `"805"` | 任务状态异常，工作流运行失败 |
| `"404"` / NOT_FOUND | workflowId / appId 不存在或无权访问 |

> 集成时务必检查 **字符串** `errorCode` 是否非空，不能用数字比较。

---

## 8. 本项目集成规范

### 新增 ComfyUI 工作流

1. 将工作流导出 JSON 放入 `config/runninghub/lu-<name>-workflow.json`
2. 在 `.env` / `.env.example` 添加 `RUNNINGHUB_<NAME>_WORKFLOW_ID` 和 `RUNNINGHUB_<NAME>_WORKFLOW_FILE`
3. 在 `src/mocks/<name>-workflow.ts` 创建前端 Schema，`mapping.nodeId` 填真实节点 ID
4. 在 `src/app/api/skus/route.ts` 注册 SKU
5. 在 `src/services/providers/ProviderFactory.ts` 注册 `providerCode`
6. 在 `RunningHubAdapter.ts` 添加识别函数（`isRunningHub<Name>Payload`）和 `generate()` 分支
7. 在 `src/lib/task-status-view.ts` 设置预计耗时

### 新增 AI App

步骤同上，差异点：
- URL 路径使用 `V2_RUN_AI_APP_PREFIX`（`/openapi/v2/run/ai-app`）
- 请求体只含 `nodeInfoList`，**不发送** `workflow` JSON
- 环境变量命名为 `RUNNINGHUB_<NAME>_APP_ID`（区别于 workflow 的 `_WORKFLOW_ID`）
- `generate()` 分支在主 workflow 逻辑之前提前拦截处理

### Anything Everywhere 节点注意事项

当工作流使用 `Anything Everywhere3`（全局广播 VAE/CLIP）时，API 提交不执行广播机制，  
必须在 JSON 中给需要 VAE/CLIP 的节点（如 `VAEDecode`）添加**显式连线**。
