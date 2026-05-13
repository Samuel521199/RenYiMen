import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 文生图：提示词 + 画幅比例。
 * `resolution` 先写入节点 58 的 `resolution` 键，在 `flattenNodeInputsToRunningHubOverrides` 中按 WxH 拆为 `width` / `height`。
 */
export const textToImageWorkflowMock: WorkflowFormSchema = {
  workflowId: "rh-txt2img-shortdrama",
  version: "1.0.0",
  title: "文生图",
  description: "输入画面提示词并选择画幅；提示词映射至节点 82，尺寸解析后写入节点 58 的宽高。",
  fields: [
    {
      kind: "group",
      id: "txt2img",
      label: "文生图",
      children: [
        {
          kind: "textInput",
          id: "prompt",
          label: "画面提示词",
          multiline: true,
          placeholder: "例如：室内暖光，人物侧脸特写，电影感…",
          mapping: { nodeId: "82", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 1, maxLength: 4000 },
        },
        {
          kind: "select",
          id: "resolution",
          label: "画幅比例",
          description: "形如 宽x高 的选项会在提交时解析为节点 58 的 width 与 height。",
          mapping: { nodeId: "58", inputPath: ["resolution"] },
          defaultValue: "720x1440",
          options: [
            { value: "720x1440", label: "720×1440（竖屏短剧）" },
            { value: "1024x1024", label: "1024×1024（方图）" },
            { value: "1024x1536", label: "1024×1536（竖图）" },
            { value: "1536x1024", label: "1536×1024（横图）" },
          ],
        },
      ],
    },
  ],
};
