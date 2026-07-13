import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 参考图 + 提示词 → GPT-image-2 生成图片（可自定义数量）。
 * 调用 OpenAI `/v1/images/edits`（有参考图）或 `/v1/images/generations`（无参考图）。
 * 网关 `providerCode: GPT_IMAGE2`，API Key 使用 `SOCIAL_OPENAI_API_KEY`。
 *
 * nodeInputs 布局（全部路由至 `nodeId: "input"`）：
 *   image_url  - 参考图远端 URL（可选）
 *   prompt     - 创作提示词
 *   n          - 生成数量 1–8
 *   size       - 输出尺寸
 *   quality    - 质量档位
 */
export const gptImage2WorkflowMock: WorkflowFormSchema = {
  workflowId: "gpt-image2-ref",
  version: "1.0.0",
  title: "智能图片生成",
  titleEn: "AI Image Generation",
  description:
    "上传一张参考图（可选）并输入创作提示词，GPT-image-2 将生成 1–8 张风格一致的高质量图片。支持自定义尺寸与质量。",
  descriptionEn:
    "Upload a reference image (optional) and enter a creative prompt — GPT-image-2 generates 1–8 high-quality images with a consistent style. Customize size and quality.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "输入素材",
      labelEn: "Input Material",
      description:
        "参考图为可选项：上传后将作为风格参考；不上传则纯文字生成。",
      descriptionEn:
        "Reference image is optional: when uploaded it guides the style; when omitted the model generates from text only.",
      children: [
        {
          kind: "imageUpload",
          id: "referenceImage",
          label: "参考图（可选）",
          labelEn: "Reference Image (optional)",
          description:
            "上传后作为创作风格锚点，传入 /v1/images/edits；不上传则走 /v1/images/generations。",
          descriptionEn:
            "Used as a style anchor for /v1/images/edits. If omitted, falls back to /v1/images/generations.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: {
            required: false,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
    {
      kind: "group",
      id: "promptGroup",
      label: "创作提示词",
      labelEn: "Creative Prompt",
      children: [
        {
          kind: "textInput",
          id: "prompt",
          label: "提示词",
          labelEn: "Prompt",
          multiline: true,
          placeholder:
            "例如：一位身穿汉服的年轻女性，站在夕阳下的古建筑前，背景是金色光晕，写实风格，高细节…",
          placeholderEn:
            "e.g. A young woman in hanfu standing in front of ancient architecture at sunset, golden halo background, photorealistic style, high detail…",
          description: "详细描述期望的画面内容、风格与氛围。",
          descriptionEn:
            "Describe the desired scene, style, and mood in detail.",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 4000 },
        },
      ],
    },
    {
      kind: "group",
      id: "generationGroup",
      label: "生成参数",
      labelEn: "Generation Settings",
      children: [
        {
          kind: "numberSlider",
          id: "imageCount",
          label: "生成数量",
          labelEn: "Image Count",
          description: "每次生成 1–8 张，多张时批量计费（单价 × 数量）。",
          descriptionEn:
            "Generate 1–8 images per run; multiple images are billed per unit price × count.",
          mapping: { nodeId: "input", inputPath: ["n"] },
          defaultValue: 1,
          validation: { min: 1, max: 8, step: 1, integer: true },
        },
        {
          kind: "select",
          id: "outputSize",
          label: "输出尺寸",
          labelEn: "Output Size",
          description: "影响图片分辨率与纵横比。",
          descriptionEn: "Affects output resolution and aspect ratio.",
          mapping: { nodeId: "input", inputPath: ["size"] },
          defaultValue: "1024x1024",
          options: [
            { value: "1024x1024", label: "1024×1024（方图）", labelEn: "1024×1024 (square)" },
            { value: "1024x1536", label: "1024×1536（竖版）", labelEn: "1024×1536 (portrait)" },
            { value: "1536x1024", label: "1536×1024（横版）", labelEn: "1536×1024 (landscape)" },
            { value: "auto", label: "自动（模型决定）", labelEn: "Auto (model decides)" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "quality",
          label: "质量档位",
          labelEn: "Quality Tier",
          description: "low: 20积分/张，medium: 50积分/张，high: 150积分/张",
          descriptionEn: "low: 20 cr/img, medium: 50 cr/img, high: 150 cr/img",
          mapping: { nodeId: "input", inputPath: ["quality"] },
          defaultValue: "medium",
          options: [
            { value: "low", label: "低 (快速，20积分/张)", labelEn: "Low (fast, 20 cr/img)" },
            { value: "medium", label: "中 (均衡，50积分/张)", labelEn: "Medium (balanced, 50 cr/img)" },
            { value: "high", label: "高 (精细，150积分/张)", labelEn: "High (refined, 150 cr/img)" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
