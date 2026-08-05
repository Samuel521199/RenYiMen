import type { WorkflowFormSchema } from "@/types/workflow";

/** 百炼万相图生动作：人物图片 + 舞蹈参考视频 → 动作迁移视频。 */
export const bailianDanceMoveWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-wan2.2-animate-move",
  version: "1.0.0",
  title: "模仿生成舞蹈视频",
  titleEn: "Dance Motion Transfer",
  description:
    "上传一张清晰的人物图片和一段舞蹈参考视频，AI 会将视频中的动作与表情迁移到图片人物上。平均生成约需 377 秒。",
  descriptionEn:
    "Upload a clear character image and a dance reference video. AI transfers the motion and expressions to the character. Average generation time is about 377 seconds.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "",
      labelEn: "",
      children: [
        {
          kind: "imageUpload",
          id: "characterImage",
          label: "人物图片",
          labelEn: "Character Image",
          description: "上传全身清晰可见的图片，尽量保持站立，不和其他物体黏连。支持 JPG、PNG、BMP、WEBP，不超过 5MB，宽高均需在 200–4096px。",
          descriptionEn: "Upload a clear, preferably full-body character image. JPG, PNG, BMP or WEBP; up to 5 MB; each side 200–4096 px.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: {
            required: true,
            maxSizeMB: 5,
            accept: ["image/jpeg", "image/png", "image/bmp", "image/webp"],
            minDimension: 200,
          },
        },
        {
          kind: "videoUpload",
          id: "danceVideo",
          label: "舞蹈参考视频",
          labelEn: "Dance Reference Video",
          description: "上传 2–30 秒的 MP4、AVI 或 MOV 视频，建议人物全身清晰、动作连贯；文件不超过 200MB。",
          descriptionEn: "Upload a 2–30 second MP4, AVI or MOV video with clear full-body motion; maximum 200 MB.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          validation: {
            required: true,
            maxSizeMB: 200,
            accept: ["video/mp4", "video/x-msvideo", "video/quicktime"],
          },
        },
        {
          kind: "select",
          id: "mode",
          label: "生成质量",
          labelEn: "Generation Quality",
          description: "专业模式动作更流畅、画面更真实，但通常需要更长时间。",
          descriptionEn: "Professional mode is smoother and more realistic, but usually takes longer.",
          mapping: { nodeId: "input", inputPath: ["mode"] },
          defaultValue: "wan-pro",
          options: [
            {
              value: "wan-std",
              label: "标准模式（适合快速预览效果）",
              labelEn: "Standard (Best for quick previews)",
            },
            {
              value: "wan-pro",
              label: "专业模式（适合专业细腻生成）",
              labelEn: "Professional (Best for detailed generation)",
            },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
