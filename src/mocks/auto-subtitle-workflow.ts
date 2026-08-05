import type { WorkflowFormSchema } from "@/types/workflow";

/** Existing video -> speech timestamps -> hard-burned subtitle video. */
export const autoSubtitleWorkflowMock: WorkflowFormSchema = {
  workflowId: "auto-subtitles",
  version: "1.0.0",
  title: "自动添加字幕",
  titleEn: "Auto Subtitles",
  description: "上传带有人声的视频，自动识别语音、匹配时间轴并生成带字幕的新视频。原视频不会被修改。",
  descriptionEn: "Upload a video with speech to automatically transcribe, align, and render subtitles into a new video. The original remains unchanged.",
  fields: [
    {
      kind: "group",
      id: "sourceGroup",
      label: "",
      labelEn: "",
      children: [
        {
          kind: "videoUpload",
          id: "sourceVideo",
          label: "原视频",
          labelEn: "Source Video",
          description: "支持 MP4、MOV、WebM，文件不超过 200MB。视频中需要包含清晰可辨的人声。",
          descriptionEn: "MP4, MOV, or WebM up to 200 MB. The video must contain clearly audible speech.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          validation: {
            required: true,
            maxSizeMB: 200,
            accept: ["video/mp4", "video/quicktime", "video/webm"],
          },
        },
      ],
    },
  ],
};
