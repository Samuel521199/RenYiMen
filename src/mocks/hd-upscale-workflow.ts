import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 高清放大（RunningHub AI App）：
 * 上传一张图片，AI 超分辨率放大并增强细节。
 * 接口：POST /openapi/v2/run/ai-app/2051722999090434050
 * 请求体格式：{ nodeInfoList: [{nodeId, fieldName, fieldValue}] }（与 workflow 相同）
 * 网关 providerCode: RUNNINGHUB_HD_UPSCALE
 *
 * 节点对应：
 *   - 节点 36，字段 image：待放大图片
 *   - 节点 82，字段 index：像素倍数选择（"1"=2x, "2"=4x）
 */
export const hdUpscaleWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-hd-upscale",
  version: "1.1.0",
  title: "高清放大",
  titleEn: "HD Upscale",
  description:
    "上传一张图片，AI 超分辨率算法自动增强细节、提升清晰度，输出分辨率可选 1k～8k，适合生成图、老照片修复及分镜图。",
  descriptionEn:
    "Upload an image and the AI super-resolution algorithm will automatically enhance details and clarity. Output resolution ranges from 1k to 8k — ideal for AI-generated images, old photo restoration, and storyboard frames.",
  fields: [
    {
      kind: "group",
      id: "input",
      label: "上传图片",
      labelEn: "Upload Image",
      description: "支持 JPG / PNG / WebP，文件大小建议不超过 20MB。",
      descriptionEn: "Supports JPG / PNG / WebP. Recommended file size: under 20 MB.",
      children: [
        {
          kind: "imageUpload",
          id: "inputImage",
          label: "待放大图片",
          labelEn: "Image to Upscale",
          description: "AI 将对此图进行高清超分处理，输出更清晰、细节更丰富的版本。",
          descriptionEn: "The AI will apply super-resolution processing to this image, producing a sharper, detail-rich output.",
          mapping: { nodeId: "36", inputPath: ["image"] },
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
      id: "settings",
      label: "放大参数",
      labelEn: "Upscale Settings",
      children: [
        {
          kind: "select",
          id: "scaleIndex",
          label: "输出分辨率",
          labelEn: "Output Resolution",
          description: "分辨率越高画面越清晰，处理时间也相应增加。默认 2k，推荐日常使用。",
          descriptionEn: "Higher resolution produces a sharper image but takes longer. Default is 2k, recommended for everyday use.",
          mapping: { nodeId: "82", inputPath: ["index"] },
          defaultValue: "2",
          options: [
            { value: "1", label: "1k 像素", labelEn: "1k pixels" },
            { value: "2", label: "2k 像素（默认）", labelEn: "2k pixels (default)" },
            { value: "3", label: "3k 像素", labelEn: "3k pixels" },
            { value: "4", label: "4k 像素", labelEn: "4k pixels" },
            { value: "5", label: "6k 像素", labelEn: "6k pixels" },
            { value: "6", label: "8k 像素", labelEn: "8k pixels" },
          ],
        },
      ],
    },
  ],
};
