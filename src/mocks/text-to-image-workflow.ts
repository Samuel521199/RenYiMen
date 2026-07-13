import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 文生图：提示词 + 画幅比例。
 * `resolution` 先写入节点 58 的 `resolution` 键，在 `flattenNodeInputsToRunningHubOverrides` 中按 WxH 拆为 `width` / `height`。
 */
export const textToImageWorkflowMock: WorkflowFormSchema = {
  workflowId: "rh-txt2img-shortdrama",
  version: "1.0.0",
  title: "文生图",
  titleEn: "Text-to-Image",
  description: "输入画面提示词并选择画幅；提示词映射至节点 82，尺寸解析后写入节点 58 的宽高。",
  descriptionEn: "Enter an image prompt and choose an aspect ratio. The prompt maps to node 82; the resolution is parsed and written as width/height to node 58.",
  fields: [
    {
      kind: "group",
      id: "txt2img",
      label: "文生图",
      labelEn: "Text-to-Image",
      children: [
        {
          kind: "textInput",
          id: "prompt",
          label: "画面提示词",
          labelEn: "Image Prompt",
          multiline: true,
          placeholder: "例如：室内暖光，人物侧脸特写，电影感…",
          placeholderEn: "e.g. Indoor warm light, close-up side profile of a person, cinematic mood…",
          mapping: { nodeId: "82", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 1, maxLength: 4000 },
        },
        {
          kind: "select",
          id: "resolution",
          label: "画幅比例",
          labelEn: "Aspect Ratio",
          description: "形如 宽x高 的选项会在提交时解析为节点 58 的 width 与 height。",
          descriptionEn: "Options in the form WxH are parsed into the width and height of node 58 at submission.",
          mapping: { nodeId: "58", inputPath: ["resolution"] },
          defaultValue: "720x1440",
          options: [
            { value: "720x1440", label: "720×1440（竖屏短剧）", labelEn: "720×1440 (portrait / short drama)" },
            { value: "1024x1024", label: "1024×1024（方图）", labelEn: "1024×1024 (square)" },
            { value: "1024x1536", label: "1024×1536（竖图）", labelEn: "1024×1536 (portrait)" },
            { value: "1536x1024", label: "1536×1024（横图）", labelEn: "1536×1024 (landscape)" },
          ],
        },
      ],
    },
  ],
};
