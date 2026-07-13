import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 视频模糊一键修复（RunningHub AI App）：
 * 上传模糊 / 低清视频，AI 超分辨率算法自动修复画质。
 * 接口：POST /openapi/v2/run/ai-app/2054098303159152642
 * 请求体格式：{ nodeInfoList: [{nodeId, fieldName, fieldValue}] }
 * 网关 providerCode: RUNNINGHUB_VIDEO_ENHANCE
 *
 * 节点对应：
 *   - 节点 5099，字段 video：输入视频文件
 *   - 节点 5148，字段 value：输出最大边（像素），默认 1280
 */
export const videoEnhanceWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-video-enhance",
  version: "1.0.0",
  title: "视频模糊一键修复",
  titleEn: "Video Enhancement",
  description:
    "上传模糊或低清视频，AI 超分辨率算法自动增强画质、修复细节，支持选择输出分辨率的最大边。",
  descriptionEn:
    "Upload a blurry or low-resolution video. The AI super-resolution algorithm will automatically enhance quality and restore detail. Choose the maximum edge of the output resolution.",
  fields: [
    {
      kind: "videoUpload",
      id: "inputVideo",
      label: "上传视频",
      labelEn: "Upload Video",
      description:
        "支持 MP4、WebM、MOV 格式，建议文件大小不超过 200MB。对应节点 5099。",
      descriptionEn:
        "Supports MP4, WebM, and MOV formats. Recommended file size: under 200 MB. Maps to node 5099.",
      mapping: { nodeId: "5099", inputPath: ["video"] },
      validation: {
        required: true,
        maxSizeMB: 200,
        accept: ["video/mp4", "video/webm", "video/quicktime", "video/*"],
      },
    },
    {
      kind: "select",
      id: "maxEdge",
      label: "输出最大边（像素）",
      labelEn: "Output Max Edge (px)",
      description:
        "控制修复后视频的最大边长。分辨率越高耗时越长，建议先用 1280 试效果。对应节点 5148。",
      descriptionEn:
        "Controls the maximum edge length of the enhanced video. Higher resolution takes longer. Start with 1280 to preview the effect. Maps to node 5148.",
      mapping: { nodeId: "5148", inputPath: ["value"] },
      defaultValue: "1280",
      options: [
        { value: "720", label: "720（快速预览）", labelEn: "720 (quick preview)" },
        { value: "1080", label: "1080（标准高清）", labelEn: "1080 (HD)" },
        { value: "1280", label: "1280（推荐）", labelEn: "1280 (recommended)" },
        { value: "1920", label: "1920（全高清）", labelEn: "1920 (Full HD)" },
        { value: "2560", label: "2560（超高清）", labelEn: "2560 (Ultra HD)" },
      ],
    },
  ],
};
