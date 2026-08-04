import type { WorkflowFormSchema } from "@/types/workflow";

/** 百炼万相数字人：人物图片 + 人声音频 → 有声人物视频。 */
export const bailianWan22S2vWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-wan2.2-s2v",
  version: "1.0.0",
  title: "有声视频",
  titleEn: "Talking Character Video",
  description:
    "上传一张人物图片和一段清晰人声音频，生成口型、表情与动作同步的说话、唱歌或表演视频。官方预计生成约需 5–10 分钟。",
  descriptionEn:
    "Upload a character image and clear human-voice audio to generate a synchronized speaking, singing, or performing video. Generation typically takes 5–10 minutes.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "",
      labelEn: "",
      children: [
        {
          kind: "select",
          id: "modelName",
          label: "生成模型",
          labelEn: "Model",
          mapping: { nodeId: "input", inputPath: ["modelName"] },
          defaultValue: "wan2.2-s2v",
          options: [{ value: "wan2.2-s2v", label: "万相 2.2 有声视频", labelEn: "Wan 2.2 S2V" }],
          validation: { required: true },
        },
        {
          kind: "imageUpload",
          id: "characterImage",
          label: "人物图片",
          labelEn: "Character Image",
          description: "支持真人或卡通人物的肖像、半身或全身图。JPG、PNG、BMP、WEBP，不超过 5MB，宽高均需在 400–7000px。",
          descriptionEn: "Portrait, half-body, or full-body real/cartoon character. JPG, PNG, BMP or WEBP; up to 5 MB; each side 400–7000 px.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: {
            required: true,
            maxSizeMB: 5,
            accept: ["image/jpeg", "image/png", "image/bmp", "image/webp"],
            minDimension: 400,
          },
        },
        {
          kind: "audioUpload",
          id: "voiceAudio",
          label: "人声音频",
          labelEn: "Voice Audio",
          description: "上传小于 20 秒的 MP3 或 WAV，文件小于 15MB。请使用清晰响亮的人声，并尽量去除背景音乐和环境噪声。",
          descriptionEn: "Upload MP3 or WAV under 20 seconds and 15 MB. Use clear human speech with minimal music or ambient noise.",
          mapping: { nodeId: "input", inputPath: ["audio_url"] },
          durationMapping: { nodeId: "input", inputPath: ["duration"] },
          validation: {
            required: true,
            maxSizeMB: 15,
            maxDurationSec: 20,
            accept: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"],
          },
        },
        {
          kind: "select",
          id: "resolution",
          label: "输出分辨率",
          labelEn: "Output Resolution",
          description: "480P 成本更低；720P 画面更清晰、帧率更高。输出画幅会尽量保持人物图片的宽高比。",
          descriptionEn: "480P costs less; 720P is sharper and uses a higher frame rate. The input image aspect ratio is preserved where possible.",
          mapping: { nodeId: "input", inputPath: ["resolution"] },
          defaultValue: "480P",
          options: [
            { value: "480P", label: "480P（推荐）", labelEn: "480P (Recommended)" },
            { value: "720P", label: "720P 高清", labelEn: "720P HD" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
