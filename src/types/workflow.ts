/**
 * 前端工作流表单 Schema：与 ComfyUI / RunningHub 原始 JSON 解耦，
 * 通过 `mapping` 在拼装 Payload 时绑定到具体节点输入。
 */

/** 指向节点上的某个输入（相对该节点的 inputs 对象的一层或多层 key） */
export interface NodeInputMapping {
  /** 工作流图中的节点 ID（字符串，与后端图定义一致） */
  nodeId: string;
  /**
   * 从节点 `inputs` 根开始的 key 路径。
   * @example ["image"] → node.inputs.image
   * @example ["clip", "text"] → node.inputs.clip.text（若后端为嵌套结构）
   */
  inputPath: string[];
}

/** 图片控件在各阶段的状态 */
export type ImageFieldStatus = "empty" | "uploading" | "ready" | "error";

/** 图片字段运行时值：预览、上传中、远端 URL 等 */
export interface ImageFieldValue {
  status: ImageFieldStatus;
  /** 本地 `URL.createObjectURL` 预览，需在替换/卸载时 revoke */
  previewUrl?: string;
  /** 上传完成后后端返回的可用于推理的地址 */
  remoteUrl?: string;
  fileName?: string;
  errorMessage?: string;
}

export interface ImageValidation {
  required?: boolean;
  /** 最大文件体积（MB） */
  maxSizeMB?: number;
  /** MIME 或扩展名提示，如 image/png */
  accept?: string[];
}

export interface TextValidation {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface SliderValidation {
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
}

export interface SelectValidation {
  required?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

interface WorkflowFieldBase {
  id: string;
  label: string;
  description?: string;
  mapping: NodeInputMapping;
}

/** 双图首尾帧等场景 */
export interface ImageUploadField extends WorkflowFieldBase {
  kind: "imageUpload";
  defaultValue?: Partial<ImageFieldValue>;
  validation?: ImageValidation;
}

/** 多图槽位：每张独立上传状态，成功后写入 `remoteUrl` */
export interface MultiImageItemValue {
  id: string;
  status: ImageFieldStatus;
  previewUrl?: string;
  remoteUrl?: string;
  fileName?: string;
  errorMessage?: string;
}

/** 多角色参考等：最多 9 张（可由 `maxItems` 下调） */
export interface MultiImageFieldValue {
  items: MultiImageItemValue[];
}

export interface MultiImageUploadField extends WorkflowFieldBase {
  kind: "multiImageUpload";
  /** 默认可传 9 张 */
  maxItems?: number;
  validation?: ImageValidation;
}

export interface TextInputField extends WorkflowFieldBase {
  kind: "textInput";
  defaultValue?: string;
  /** true 时使用多行文本框 */
  multiline?: boolean;
  placeholder?: string;
  validation?: TextValidation;
}

export interface NumberSliderField extends WorkflowFieldBase {
  kind: "numberSlider";
  defaultValue?: number;
  validation: SliderValidation;
}

export interface SelectField extends WorkflowFieldBase {
  kind: "select";
  defaultValue?: string;
  options: SelectOption[];
  validation?: SelectValidation;
}

/**
 * 分组：用于 UI 分区与在 `parameters` 中形成嵌套对象（深度更新）。
 * 分组本身不产生 API 映射。
 */
export interface GroupField {
  kind: "group";
  id: string;
  label: string;
  description?: string;
  children: WorkflowField[];
}

export type WorkflowField =
  | ImageUploadField
  | MultiImageUploadField
  | TextInputField
  | NumberSliderField
  | SelectField
  | GroupField;

export function isGroupField(f: WorkflowField): f is GroupField {
  return f.kind === "group";
}

export interface WorkflowFormSchema {
  workflowId: string;
  version: string;
  title?: string;
  description?: string;
  fields: WorkflowField[];
  /**
   * 可选：JSON Schema 草案（如 `properties.modelName`），与 `fields` 对齐供文档/导出；
   * 运行时渲染与提单仍以 `fields` + `mapping` 为准。
   */
  schema?: {
    type?: string;
    title?: string;
    properties?: Record<string, unknown>;
  };
  /** 可选：UI 挂载（如 RJSF `ui:widget`）；本仓库 `DynamicForm` 以 `fields[].kind` 映射控件。 */
  uiSchema?: Record<string, unknown>;
}

/**
 * 提交给后端 / BFF 的规范化负载（与具体 RunningHub REST 再适配一层亦可）。
 * `nodeInputs[nodeId]` 为合并后的 inputs 对象。
 */
export interface WorkflowApiPayload {
  workflowId: string;
  version: string;
  nodeInputs: Record<string, Record<string, unknown>>;
  /** 大厅 SKU，供网关解析线路与计费 */
  skuId?: string;
  /** 上游适配器代码（与 `skuId` 一并提交，工厂优先使用本字段） */
  providerCode?: string;
}
