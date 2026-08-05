import type { WorkflowFormSchema } from "@/types/workflow";

/** 万相 2.7 运镜复刻：参考视频提供运镜，参考图定义目标人物或场景。 */
export const bailianCameraReplicationWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-wan2.7-camera-replication",
  version: "1.0.0",
  title: "运镜复刻",
  titleEn: "Camera Movement Replication",
  description:
    "上传参考运镜视频和目标画面参考图，智能复刻推拉、环绕、升降、跟拍等镜头运动，让目标画面延续参考视频的运镜节奏与表现力。",
  descriptionEn:
    "Upload a camera-movement reference video and target images to recreate dolly, orbit, crane, tracking, and other camera motion while preserving the reference pacing and visual energy.",
  fields: [
    {
      kind: "group",
      id: "cameraReplicationInput",
      label: "复刻输入",
      labelEn: "Replication Input",
      children: [
        {
          kind: "videoUpload",
          id: "referenceVideo",
          label: "参考运镜视频",
          labelEn: "Camera Reference Video",
          description:
            "上传需要复刻运镜的参考视频。支持 MP4、MOV，时长 2–10 秒，文件不超过 100MB。",
          descriptionEn:
            "Upload the video whose camera movement you want to replicate. MP4 or MOV, 2–10 seconds, up to 100 MB.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          durationMapping: { nodeId: "input", inputPath: ["video_duration"] },
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
          id: "targetImages",
          label: "目标画面参考图",
          labelEn: "Target Scene Images",
          description:
            "上传希望承载参考运镜的人物、产品或场景图片，至少 1 张、最多 4 张。",
          descriptionEn:
            "Upload images of the person, product, or scene that should receive the camera movement. 1–4 images.",
          mapping: { nodeId: "input", inputPath: ["image_urls"] },
          maxItems: 4,
          validation: {
            required: true,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/bmp", "image/webp"],
            minDimension: 240,
          },
        },
        {
          kind: "textInput",
          id: "replicationPrompt",
          label: "运镜复刻指令",
          labelEn: "Replication Instruction",
          description:
            "说明目标主体和场景，并明确要求复刻参考视频的镜头轨迹、速度与节奏。",
          descriptionEn:
            "Describe the target subject and scene, and specify that the reference camera path, speed, and rhythm should be followed.",
          multiline: true,
          placeholder:
            "例如：将参考视频中的环绕跟拍运镜复刻到图1人物所在的场景，保持人物外观和背景设定，镜头轨迹、速度与节奏参考输入视频。",
          placeholderEn:
            "Example: Apply the orbiting tracking shot from the reference video to the person in Image 1. Preserve the character and scene while matching the camera path, speed, and rhythm.",
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
          defaultValue: "auto",
          options: [
            { value: "auto", label: "智能处理", labelEn: "Auto" },
            { value: "origin", label: "保留参考视频原声", labelEn: "Keep Reference Audio" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
