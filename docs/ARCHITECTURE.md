# 架构说明：动态参数表单与 RunningHub 解耦

本文描述前端如何落地「Schema 驱动表单」，以及如何通过分层与适配器与 **RunningHub / ComfyUI** 的原始数据结构解耦。

## 1. 问题边界

- **RunningHub / ComfyUI** 侧数据通常是「节点图」：大量嵌套 JSON、节点 ID、端口、内部字段名与业务语义不一致。
- **产品 UI** 需要的是「人类可读的输入项」：图、滑杆、文案、选项等，且随工作流版本演进。

直接在 React 组件里读写 RunningHub 原始 JSON 会导致：表单与某一 API 版本强耦合、难以测试、难以复用同一套 UI 到不同提供商。

## 2. 核心思路：三层数据模型

```text
┌─────────────────────────────────────────────────────────────┐
│  UI Schema（前端 / BFF 下发的 canonical 模型）               │
│  WorkflowInputSchema：字段 id、类型、约束、默认值、展示文案   │
└───────────────────────────┬─────────────────────────────────┘
                            │ 用户编辑 → 扁平或树形「逻辑参数」
┌───────────────────────────▼─────────────────────────────────┐
│  Domain Values（Zustand / 表单状态）                        │
│  Record<fieldId, unknown> 或强类型子结构                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ 提交前映射
┌───────────────────────────▼─────────────────────────────────┐
│  Provider Payload（RunningHub 请求体 / Comfy prompt 等）     │
│  仅存在于 services + adapters，UI 不 import 具体形状          │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 UI Schema（与供应商无关）

- 定义位置建议：`src/types/workflow-schema.ts`（已提供基础类型）及后续由后端或 BFF 下发的 JSON。
- 字段类型枚举（`text` / `slider` / `image` 等）描述 **如何渲染与校验**，不描述 **图里哪个 node.input**。

### 2.2 Domain Values

- 由 **Zustand**（如 `useWorkflowParameterStore`）或表单库维护，键为 Schema 的 `id`。
- 组件层只读写「逻辑 id」，不知道 RunningHub 的 node id。

### 2.3 Provider Payload（适配器出口）

- 在 `src/services/` 下增加 **适配模块**（例如 `runninghub/map-to-payload.ts`），输入为 `WorkflowInputSchema + values`，输出为官方 SDK / REST 所需的结构。
- **复杂映射**（多节点、常量注入、条件分支）必须写 JSDoc 与单元测试，避免「魔法字符串」散落在组件里。

## 3. 动态表单（Dynamic Form）渲染管线

1. **加载 Schema**：`services` 请求 `GET /workflows/:id/input-schema`（示例）；超时与错误统一在客户端封装（见 `api-client.ts`）。
2. **注册渲染器**：按 `WorkflowFieldType` 映射到具体展示组件（`src/components/forms/fields/` 后续补充），类似小型「表单引擎」。
3. **校验**：根据 `constraints`（min/max、正则、文件类型）在提交前校验；必要时与服务端二次校验对齐。
4. **提交**：`values` → `mapToRunningHubPayload()` → `POST` 创建任务；长任务配合 **轮询/WebSocket** 与较长 `timeoutMs` 策略（在 `apiRequest` 或专用 job client 中配置）。

**展示与逻辑分离**：

- **容器**（page 或 `workflow/*-container.tsx`）：拉取 Schema、连接 store、处理 loading/error。
- **纯展示**（`forms/fields/*`）：只接收 `value` / `onChange` / `schema` 片段。

## 4. 与 RunningHub API 的解耦要点

| 维度 | 做法 |
|------|------|
| 类型 | 供应商专用类型放在 `src/types/runninghub/`（后续新增），不要混进 Schema 类型文件。 |
| HTTP | 所有请求经 `services/api-client.ts` 或同类封装，统一 baseUrl、超时、错误模型。 |
| 配置 | `NEXT_PUBLIC_API_BASE_URL` 指向 **BFF 或网关**，由网关转发 RunningHub，便于换供应商或 mock。 |
| 版本 | Schema 带 `version`；适配器按版本分支，避免单函数无限 if-else。 |

## 5. 长耗时 AI 任务

- 创建任务与查询状态使用 **不同超时**：创建可较短，轮询单次可较短但总时长由 UI 控制。
- 对 `AbortController` 与用户取消操作在 store 中集中处理，避免泄漏请求。

## 6. 后续落地顺序（建议）

1. 与后端约定 **WorkflowInputSchema** JSON 与版本策略。  
2. 实现 `DynamicForm` 容器 + 各 `field` 展示组件。  
3. 实现 RunningHub `adapter` 与最小 E2E（mock 服务器）。  
4. 再接入 Shadcn 表单控件与无障碍细节。

以上与 `.cursorrules` 中的 Schema 驱动 UI、分层、服务层与整洁代码原则一致。
