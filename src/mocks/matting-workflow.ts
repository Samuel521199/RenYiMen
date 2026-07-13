import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 智能人像编辑（RunningHub AI App）：
 * 上传图片 + 文字描述，AI 自动完成抠图、背景替换、特效清除等操作。
 * 接口：POST /openapi/v2/run/ai-app/2051132575132995586
 * 请求体格式：{ nodeInfoList: [{nodeId, fieldName, fieldValue}] }
 * 网关 providerCode: RUNNINGHUB_MATTING
 *
 * 节点对应：
 *   - 节点 1，字段 image：待处理图片
 *   - 节点 18，字段 text：操作指令（自然语言描述要做什么）
 */
export const mattingWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-matting",
  version: "1.1.0",
  title: "人像抠图",
  titleEn: "Portrait Matting",
  description:
    "上传图片并用文字描述你的需求，AI 自动完成抠图、背景替换、文字清除、特效去除等操作，输出高质量结果图。",
  descriptionEn:
    "Upload an image and describe your request in text. The AI will automatically perform matting, background replacement, text removal, effect removal, and more — outputting a high-quality result.",
  fields: [
    {
      kind: "group",
      id: "input",
      label: "上传图片",
      labelEn: "Upload Image",
      description: "建议上传人物清晰、主体突出的图片，效果更佳。支持 JPG / PNG / WebP，不超过 20MB。",
      descriptionEn: "For best results, upload an image with a clear subject. Supports JPG / PNG / WebP, max 20 MB.",
      children: [
        {
          kind: "imageUpload",
          id: "inputImage",
          label: "待处理图片",
          labelEn: "Image to Process",
          description: "AI 将根据下方指令对此图进行处理。",
          descriptionEn: "The AI will process this image according to the instruction below.",
          mapping: { nodeId: "1", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
    {
      kind: "group",
      id: "prompt",
      label: "操作指令",
      labelEn: "Instruction",
      children: [
        {
          kind: "textInput",
          id: "editText",
          label: "描述你想要的效果",
          labelEn: "Describe the desired effect",
          multiline: true,
          placeholder:
            "例如：抠出人物并将背景改成纯白色；或：删除图片中的文字，删除人物前面的特效，然后抠出人物并将背景改成纯蓝色背景",
          placeholderEn:
            "e.g. Extract the person and change the background to pure white; or: remove the text in the image, remove effects in front of the subject, then extract the person and set the background to pure blue",
          description:
            "用中文自然语言描述操作需求，支持抠图、换背景、去文字、去特效等组合指令。",
          descriptionEn:
            "Describe your request in natural language. Supports combined operations: matting, background swap, text removal, effect removal, etc.",
          mapping: { nodeId: "18", inputPath: ["text"] },
          defaultValue: "抠出图中人物，将背景改成纯白色背景",
          validation: { required: true, minLength: 5, maxLength: 500 },
        },
      ],
    },
  ],
};
