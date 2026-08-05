import type { WorkflowFormSchema } from "@/types/workflow";

/** 整体风格迁移：将原视频统一转换为指定视觉风格。 */
export const bailianOverallStyleTransferWorkflowMock: WorkflowFormSchema = {
  workflowId: "happyhorse-1.0-video-edit",
  version: "1.0.0",
  title: "整体风格迁移",
  titleEn: "Overall Style Transfer",
  description:
    "上传原视频并选择目标风格，将人物、场景、材质和光影统一迁移为动画、国风、黏土、水彩或赛博朋克等视觉效果。",
  descriptionEn:
    "Upload a source video and transform its characters, environments, materials, and lighting into a consistent animation, Chinese, clay, watercolor, or cyberpunk style.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "风格迁移输入",
      labelEn: "Style Transfer Input",
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
          kind: "select",
          id: "targetStyle",
          label: "目标风格",
          labelEn: "Target Style",
          description: "系统会根据所选风格自动组织适合视频整体重绘的模型指令。",
          descriptionEn: "The system automatically prepares a model instruction for consistent full-video restyling.",
          mapping: { nodeId: "input", inputPath: ["style_prompt"] },
          defaultValue: "将整段视频统一转换为高品质二维动画风格，人物、场景、动作和镜头连续性保持稳定。",
          options: [
            {
              value: "将整段视频统一转换为高品质二维动画风格，人物、场景、动作和镜头连续性保持稳定。",
              label: "真人变动画",
              labelEn: "Live Action to Animation",
            },
            {
              value: "将整段视频统一转换为写意国风美术风格，融入东方绘画笔触与雅致色彩，同时保持主体身份、动作和镜头连续性。",
              label: "写实变国风",
              labelEn: "Realistic to Chinese Art",
            },
            {
              value: "将整段视频统一转换为精致黏土定格动画风格，呈现手工塑形质感、柔和体积光与稳定的角色外观。",
              label: "黏土动画",
              labelEn: "Clay Animation",
            },
            {
              value: "将整段视频统一转换为手绘水彩风格，保留自然水色晕染、纸张肌理和流畅稳定的时序变化。",
              label: "水彩",
              labelEn: "Watercolor",
            },
            {
              value: "将整段视频统一转换为赛博朋克风格，加入霓虹灯光、未来都市材质和高对比色彩，同时保持主体、动作与镜头连续性。",
              label: "赛博朋克",
              labelEn: "Cyberpunk",
            },
          ],
          validation: { required: true },
        },
        {
          kind: "textInput",
          id: "styleDetails",
          label: "补充要求（可选）",
          labelEn: "Additional Direction (Optional)",
          multiline: true,
          placeholder: "例如：保留人物服装配色，画面更明亮，避免改变镜头构图",
          placeholderEn: "For example: Keep the outfit colors, brighten the image, and preserve the framing",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: false, maxLength: 2500 },
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
