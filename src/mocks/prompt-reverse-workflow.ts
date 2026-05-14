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
  description:
    "上传任意一张图片，AI 将用 Qwen3-VL 视觉模型（llama.cpp 量化版）分析图片内容，自动反推出适合 AI 绘画的中文提示词，涵盖人物、场景、风格、光线等关键要素。",
  fields: [
    {
      kind: "group",
      id: "input",
      label: "输入图片",
      description: "上传需要分析的图片，写入节点 3（LoadImage）。",
      children: [
        {
          kind: "imageUpload",
          id: "sourceImage",
          label: "待分析图片",
          description: "上传您希望反推提示词的图片，支持人像、场景、艺术作品等。",
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
