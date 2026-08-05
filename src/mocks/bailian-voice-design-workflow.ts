import type { WorkflowFormSchema } from "@/types/workflow";

/** 通过自然语言描述创建全新 CosyVoice 品牌音色，无需真人录音。 */
export const bailianVoiceDesignWorkflowMock: WorkflowFormSchema = {
  workflowId: "voice-enrollment:cosyvoice-v3.5-plus",
  version: "1.0.0",
  title: "文字设计新音色",
  titleEn: "Design a New Voice from Text",
  description:
    "用文字描述年龄、气质、音色和声音质感，生成可试听、可复用的全新品牌音色，无需上传真人录音。",
  descriptionEn:
    "Describe the age, personality, timbre, and texture of a voice to create a reusable brand voice with an audio preview—no recording required.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "音色设计",
      labelEn: "Voice Design",
      children: [
        {
          kind: "textInput",
          id: "voicePrompt",
          label: "音色描述",
          labelEn: "Voice Description",
          multiline: true,
          placeholder: "例如：年轻、神秘、带轻微机械感的女声，语气克制而自信，音色清晰、有未来科技感",
          placeholderEn: "For example: A young, mysterious female voice with a subtle mechanical texture, restrained confidence, clarity, and a futuristic feel",
          mapping: { nodeId: "input", inputPath: ["voice_prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 500 },
        },
        {
          kind: "textInput",
          id: "previewText",
          label: "试听文案",
          labelEn: "Preview Script",
          multiline: true,
          placeholder: "欢迎来到我们的未来世界，每一次聆听，都是一次全新的发现。",
          placeholderEn: "Welcome to our future world, where every listen reveals something new.",
          mapping: { nodeId: "input", inputPath: ["preview_text"] },
          defaultValue: "",
          validation: { required: true, minLength: 15, maxLength: 200 },
        },
        {
          kind: "textInput",
          id: "voicePrefix",
          label: "音色名称前缀",
          labelEn: "Voice Name Prefix",
          description: "仅支持英文字母和数字，最长 10 个字符，例如 brand01。",
          descriptionEn: "Letters and numbers only, up to 10 characters, for example brand01.",
          mapping: { nodeId: "input", inputPath: ["prefix"] },
          defaultValue: "",
          placeholder: "brand01",
          placeholderEn: "brand01",
          validation: { required: true, minLength: 1, maxLength: 10 },
        },
        {
          kind: "select",
          id: "language",
          label: "语言倾向",
          labelEn: "Language Preference",
          mapping: { nodeId: "input", inputPath: ["language_hint"] },
          defaultValue: "zh",
          options: [
            { value: "zh", label: "中文", labelEn: "Chinese" },
            { value: "en", label: "英文", labelEn: "English" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "format",
          label: "试听音频格式",
          labelEn: "Preview Audio Format",
          mapping: { nodeId: "input", inputPath: ["response_format"] },
          defaultValue: "wav",
          options: [
            { value: "wav", label: "WAV（无损）", labelEn: "WAV (Lossless)" },
            { value: "mp3", label: "MP3（体积较小）", labelEn: "MP3 (Smaller)" },
          ],
          validation: { required: true },
        },
      ],
    },
  ],
};
