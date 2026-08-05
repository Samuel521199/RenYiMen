import type { WorkflowFormSchema } from "@/types/workflow";

/** 场景与光影变换：使用 HappyHorse 视频编辑模型重塑环境、天气与光线。 */
export const bailianSceneLightVideoEditWorkflowMock: WorkflowFormSchema = {
  workflowId: "happyhorse-1.0-video-edit",
  version: "1.0.0",
  title: "场景与光影变换",
  titleEn: "Scene & Lighting Transform",
  description:
    "上传原视频，通过文字指令改变时间、天气、光线或背景环境，例如白天变夜景、晴天变雨天、背景换成森林。",
  descriptionEn:
    "Upload a source video and transform its time of day, weather, lighting, or environment, such as day to night, sun to rain, or replacing the background with a forest.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "变换输入",
      labelEn: "Transform Input",
      children: [
        {
          kind: "videoUpload",
          id: "sourceVideo",
          label: "原视频",
          labelEn: "Source Video",
          description:
            "上传 3–60 秒的 MP4 或 MOV 视频，不超过 100MB；超过 15 秒时仅处理前 15 秒。建议使用 H.264 编码。",
          descriptionEn:
            "Upload a 3–60 second MP4 or MOV video, up to 100 MB. For videos longer than 15 seconds, only the first 15 seconds are processed. H.264 is recommended.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          durationMapping: { nodeId: "input", inputPath: ["duration"] },
          validation: {
            required: true,
            maxSizeMB: 100,
            accept: ["video/mp4", "video/quicktime"],
            minDurationSec: 3,
            maxDurationSec: 60,
          },
        },
        {
          kind: "multiImageUpload",
          id: "referenceImages",
          label: "场景参考图（可选）",
          labelEn: "Scene References (Optional)",
          description: "需要指定森林、城市、室内等目标环境时可上传参考图，最多 5 张。",
          descriptionEn: "Add reference images to guide a target forest, city, interior, or other environment. Maximum 5 images.",
          mapping: { nodeId: "input", inputPath: ["reference_image_urls"] },
          maxItems: 5,
          validation: {
            required: false,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp"],
            minDimension: 300,
          },
        },
        {
          kind: "textInput",
          id: "editPrompt",
          label: "变换要求",
          labelEn: "Transform Instruction",
          multiline: true,
          placeholder: "例如：将白天变成夜景，路灯亮起，人物与镜头运动保持不变",
          placeholderEn: "For example: Turn daytime into night with streetlights on, while preserving the subject and camera motion",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 2500 },
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
