import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * Kling 高级版 (O3-pro) 图生视频。
 * 调用 302.ai → kwaivgi/kling-video-o3-pro/image-to-video
 * 单张图 + 提示词，支持 5s / 10s 时长与多种画面比例。
 */
export const klingProWorkflowMock: WorkflowFormSchema = {
  workflowId: "kling-pro-i2v",
  version: "1.0.0",
  title: "Kling 高级版",
  titleEn: "Kling Pro",
  description:
    "上传一张参考图，填写镜头描述，即可生成高质量短视频。高级版采用 O3-pro 模型，动作流畅度与细节质量更佳，适合精品内容制作。计费：600 积分/次。",
  descriptionEn:
    "Upload a reference image and describe the motion to generate a high-quality video clip. The Pro version uses the O3-pro model for smoother motion and superior detail, ideal for premium content. Billing: 600 credits/generation.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "生成输入",
      labelEn: "Generation Input",
      children: [
        {
          kind: "imageUpload",
          id: "referenceImage",
          label: "参考图（首帧）",
          labelEn: "Reference Image (First Frame)",
          description: "作为视频起始画面，宽高均 ≥ 300 px。",
          descriptionEn: "Serves as the opening frame. Width and height must be ≥ 300 px.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: {
            required: true,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp"],
            minDimension: 300,
          },
        },
        {
          kind: "textInput",
          id: "prompt",
          label: "镜头与运动描述",
          labelEn: "Camera & Motion Description",
          multiline: true,
          placeholder: "例如：人物缓慢转身，镜头推近，暖光逐渐覆盖画面…",
          placeholderEn: "e.g. The character slowly turns, camera pushes in, warm light gradually fills the frame…",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 2000 },
        },
        {
          kind: "select",
          id: "ratio",
          label: "画面比例",
          labelEn: "Aspect Ratio",
          mapping: { nodeId: "input", inputPath: ["ratio"] },
          defaultValue: "16:9",
          options: [
            { value: "16:9", label: "16:9（横屏）", labelEn: "16:9 (Landscape)" },
            { value: "9:16", label: "9:16（竖屏）", labelEn: "9:16 (Portrait)" },
            { value: "1:1",  label: "1:1（方形）",  labelEn: "1:1 (Square)" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "duration",
          label: "视频时长",
          labelEn: "Video Duration",
          description: "5 秒或 10 秒，时长越长消耗越多。",
          descriptionEn: "5 or 10 seconds. Longer duration costs more.",
          mapping: { nodeId: "input", inputPath: ["duration"] },
          defaultValue: "5",
          options: [
            { value: "5",  label: "5 秒",  labelEn: "5 seconds" },
            { value: "10", label: "10 秒", labelEn: "10 seconds" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
