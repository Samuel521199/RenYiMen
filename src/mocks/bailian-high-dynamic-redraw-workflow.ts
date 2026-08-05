import type { WorkflowFormSchema } from "@/types/workflow";

/** 高动态重绘：使用 Wan 2.7 VideoEdit 改变风格，同时保留复杂运动与镜头轨迹。 */
export const bailianHighDynamicRedrawWorkflowMock: WorkflowFormSchema = {
  workflowId: "wan2.7-videoedit",
  version: "1.0.0",
  title: "高动态重绘",
  titleEn: "High-Motion Restyle",
  description:
    "上传包含复杂动作或运镜的原视频，重新绘制整体视觉风格，同时尽量保留人物运动、物体轨迹与镜头语言。",
  descriptionEn:
    "Restyle a source video while preserving complex subject motion, object trajectories, and camera movement as closely as possible.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "重绘输入",
      labelEn: "Redraw Input",
      children: [
        {
          kind: "videoUpload",
          id: "sourceVideo",
          label: "原视频",
          labelEn: "Source Video",
          description:
            "上传 2–10 秒的 MP4 或 MOV 视频，不超过 100MB。建议使用动作丰富、镜头运动清晰的 H.264 视频。",
          descriptionEn:
            "Upload a 2–10 second MP4 or MOV video, up to 100 MB. H.264 footage with clear motion and camera movement is recommended.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          durationMapping: { nodeId: "input", inputPath: ["duration"] },
          validation: {
            required: true,
            maxSizeMB: 100,
            accept: ["video/mp4", "video/quicktime"],
            minDurationSec: 2,
            maxDurationSec: 10,
          },
        },
        {
          kind: "multiImageUpload",
          id: "referenceImages",
          label: "风格参考图（可选）",
          labelEn: "Style References (Optional)",
          description: "可上传目标画风、材质或特效参考图，最多 4 张。",
          descriptionEn: "Add up to four images to guide the target style, material, or visual effect.",
          mapping: { nodeId: "input", inputPath: ["reference_image_urls"] },
          maxItems: 4,
          validation: {
            required: false,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp", "image/bmp"],
            minDimension: 240,
          },
        },
        {
          kind: "textInput",
          id: "editPrompt",
          label: "重绘要求",
          labelEn: "Restyle Instruction",
          multiline: true,
          placeholder:
            "例如：将整段视频重绘为厚涂赛博朋克动画，保留人物的高速动作、物体运动轨迹和原有镜头推进节奏",
          placeholderEn:
            "For example: Restyle the video as painterly cyberpunk animation while preserving fast character motion, object trajectories, and the original camera push-in",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 5000 },
        },
        {
          kind: "select",
          id: "resolution",
          label: "输出分辨率",
          labelEn: "Output Resolution",
          mapping: { nodeId: "input", inputPath: ["resolution"] },
          defaultValue: "720P",
          options: [
            { value: "720P", label: "720P（标准）", labelEn: "720P (Standard)" },
            { value: "1080P", label: "1080P（高清）", labelEn: "1080P (HD)" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "audioSetting",
          label: "声音处理",
          labelEn: "Audio Handling",
          mapping: { nodeId: "input", inputPath: ["audio_setting"] },
          defaultValue: "origin",
          options: [
            { value: "origin", label: "保留原视频声音", labelEn: "Keep original audio" },
            { value: "auto", label: "由模型自动处理", labelEn: "Let the model decide" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
