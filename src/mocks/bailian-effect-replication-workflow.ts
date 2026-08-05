import type { WorkflowFormSchema } from "@/types/workflow";

/** 万相 2.7 特效复刻：参考视频提供动态特效，目标图片定义承载特效的人物。 */
export const bailianEffectReplicationWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-wan2.7-effect-replication",
  version: "1.0.0",
  title: "特效复刻",
  titleEn: "Effect Replication",
  description:
    "上传特效参考视频和目标人物图片，将火焰、变身、粒子等视觉效果迁移到目标人物，并尽量保留人物主体特征与整体画面风格。",
  descriptionEn:
    "Upload an effect reference video and a target character image to transfer fire, transformation, particles, and other visual effects while preserving the character and overall visual style.",
  fields: [
    {
      kind: "group",
      id: "effectReplicationInput",
      label: "复刻输入",
      labelEn: "Replication Input",
      children: [
        {
          kind: "videoUpload",
          id: "effectReferenceVideo",
          label: "特效参考视频",
          labelEn: "Effect Reference Video",
          description:
            "上传包含待复刻特效的视频。支持 MP4、MOV，时长 2–10 秒，文件不超过 100MB。",
          descriptionEn:
            "Upload a video containing the effect to replicate. MP4 or MOV, 2–10 seconds, up to 100 MB.",
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
          kind: "imageUpload",
          id: "targetCharacterImage",
          label: "目标人物图片",
          labelEn: "Target Character Image",
          description:
            "上传需要应用特效的人物图片。支持 JPG、PNG、BMP、WEBP，文件不超过 20MB。",
          descriptionEn:
            "Upload the character image that should receive the effect. JPG, PNG, BMP, or WEBP, up to 20 MB.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: {
            required: true,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/bmp", "image/webp"],
            minDimension: 240,
          },
        },
        {
          kind: "textInput",
          id: "effectPrompt",
          label: "特效复刻指令",
          labelEn: "Effect Replication Instruction",
          description:
            "说明要复刻的特效、应用对象及目标场景，未提及的内容尽量保持目标人物设定。",
          descriptionEn:
            "Describe the effect, its target, and the desired scene. Unspecified character details will be preserved whenever possible.",
          multiline: true,
          placeholder:
            "例如：参考视频中的火焰与粒子特效，将同样的特效应用到图片中的人物身上，保持人物外观，场景为夜晚街道。",
          placeholderEn:
            "Example: Replicate the fire and particle effects from the video and apply them to the person in the image. Preserve the character's appearance in a nighttime street scene.",
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
