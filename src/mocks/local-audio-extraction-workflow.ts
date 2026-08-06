import type { WorkflowFormSchema } from "@/types/workflow";

export const localAudioExtractionWorkflowMock: WorkflowFormSchema = {
  workflowId: "local-audio-extraction",
  version: "1.0.0",
  title: "视频提取音频",
  titleEn: "Extract Audio from Video",
  description: "上传带音轨的视频，快速提取为独立音频文件。处理在本地媒体服务完成，不调用生成模型。",
  descriptionEn: "Upload a video with an audio track and extract it as a standalone audio file. Processing runs locally without a generative model.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "提取设置",
      labelEn: "Extraction Settings",
      children: [
        {
          kind: "videoUpload",
          id: "sourceVideo",
          label: "源视频",
          labelEn: "Source Video",
          description: "支持 MP4、MOV 和 WebM，最大 200MB。视频必须包含至少一条音轨。",
          descriptionEn: "MP4, MOV, or WebM up to 200 MB. The video must contain at least one audio track.",
          mapping: { nodeId: "input", inputPath: ["video_url"] },
          validation: {
            required: true,
            maxSizeMB: 200,
            accept: ["video/mp4", "video/quicktime", "video/webm"],
          },
        },
        {
          kind: "select",
          id: "outputFormat",
          label: "输出格式",
          labelEn: "Output Format",
          description: "MP3 适合日常使用，M4A 体积更小，WAV 适合后续专业处理。",
          descriptionEn: "MP3 is widely compatible, M4A is compact, and WAV is best for professional post-production.",
          mapping: { nodeId: "input", inputPath: ["output_format"] },
          defaultValue: "mp3",
          options: [
            { value: "mp3", label: "MP3（推荐）", labelEn: "MP3 (Recommended)" },
            { value: "m4a", label: "M4A（高质量小体积）", labelEn: "M4A (High quality, compact)" },
            { value: "wav", label: "WAV（无压缩）", labelEn: "WAV (Uncompressed)" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
