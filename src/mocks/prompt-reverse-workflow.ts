import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 提示词反推（图生文）：
 * 上传一张图片 → Llama-cpp Qwen3-VL 分析 → 输出 AI 绘画提示词。
 * 工作流见 `config/runninghub/lu-prompt-reverse-workflow.json`，
 * 网关 `providerCode: RUNNINGHUB_PROMPT_REVERSE`，接口 `/openapi/v2/run/workflow/2037912443044765697`。
 */
export const promptReverseWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-prompt-reverse",
  version: "1.1.0",
  title: "提示词反推",
  titleEn: "Prompt Reverse Engineering",
  description:
    "上传任意一张图片，自动分析人物、场景、风格、光线与构图等关键要素，并生成可用于图像创作的详细中文提示词。",
  descriptionEn:
    "Upload any image to analyze its subjects, scene, style, lighting, and composition, then generate a detailed prompt for image creation.",
  fields: [
    {
      kind: "group",
      id: "input",
      label: "输入图片",
      labelEn: "Input Image",
      children: [
        {
          kind: "imageUpload",
          id: "sourceImage",
          label: "",
          labelEn: "",
          mapping: { nodeId: "3", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 25,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
  ],
};
