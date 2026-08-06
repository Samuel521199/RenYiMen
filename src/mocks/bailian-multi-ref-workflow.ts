import type { WorkflowFormSchema } from "@/types/workflow";

/** 百炼 Reference-to-Video（多参考图）模型枚举，与官方文档一致。 */
const MODEL_ENUM = ["wan2.7-r2v", "happyhorse-1.1-r2v"] as const;
const MODEL_ENUM_NAMES = ["通义万相 2.7 (多角色)", "HappyHorse 1.1 (多角色)"] as const;

const RATIO_ENUM = ["16:9", "9:16", "3:4", "4:3", "1:1"] as const;

/** 多参考图图生视频：万相最多 5 张、HappyHorse 最多 9 张，供网关透传至百炼侧 `nodeInputs.input`。 */
export const bailianMultiRefWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-multi-ref-i2v",
  version: "1.2.0",
  title: "多参考图剧场生成",
  titleEn: "Multi-Reference Video Generation",
  description:
    "HappyHorse 1.1 最多支持 9 张参考图，通义万相 2.7 最多支持 5 张；可分别填写正向与负向提示词。计费规则：动态秒数计费。",
  descriptionEn:
    "HappyHorse 1.1 supports up to 9 reference images and Wan 2.7 supports up to 5, with separate positive and negative prompt inputs. Billing: dynamic per-second rate.",
  schema: {
    type: "object",
    properties: {
      modelName: {
        type: "string",
        title: "选择生成模型",
        enum: [...MODEL_ENUM],
        enumNames: [...MODEL_ENUM_NAMES],
        default: "wan2.7-r2v",
      },
      ratio: {
        type: "string",
        title: "画面比例",
        enum: [...RATIO_ENUM],
        default: "16:9",
      },
      duration: {
        type: "integer",
        title: "视频时长 (秒) - 150积分/秒",
        minimum: 3,
        maximum: 15,
        default: 5,
      },
      image_urls: {
        type: "array",
        title: "参考图 (HappyHorse 最多9张)",
        items: { type: "string" },
        maxItems: 9,
      },
      prompt: {
        type: "string",
        title: "正向提示词",
      },
      negative_prompt: {
        type: "string",
        title: "负向提示词",
        maxLength: 500,
      },
    },
  },
  uiSchema: {
    modelName: { "ui:widget": "select" },
    ratio: { "ui:widget": "select", "ui:help": "输出视频的画面宽高比。" },
    duration: {
      "ui:widget": "range",
      "ui:help": "时长越长，消耗积分越多。允许范围：3-15秒。",
    },
    image_urls: {
      "ui:widget": "multiImageUploader",
      "ui:help":
        "HappyHorse 最多9张，万相最多5张。若选万相，请用『图1、图2』；若选 HappyHorse，请用『[Image 1]、[Image 2]』。",
    },
  },
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "生成输入",
      labelEn: "Generation Input",
      children: [
        {
          kind: "select",
          id: "modelName",
          label: "选择生成模型",
          labelEn: "Select Model",
          description: "最新版 HappyHorse 1.1 功能更强大。",
          descriptionEn: "The latest HappyHorse 1.1 is more powerful.",
          mapping: { nodeId: "input", inputPath: ["modelName"] },
          defaultValue: "wan2.7-r2v",
          options: [
            { value: "wan2.7-r2v", label: "通义万相 2.7 (多角色)", labelEn: "Tongyi Wanxiang 2.7 (multi-character)" },
            { value: "happyhorse-1.1-r2v", label: "HappyHorse 1.1 (多角色)", labelEn: "HappyHorse 1.1 (multi-character)" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "ratio",
          label: "画面比例",
          labelEn: "Aspect Ratio",
          mapping: { nodeId: "input", inputPath: ["ratio"] },
          defaultValue: "16:9",
          options: [
            { value: "16:9", label: "16:9" },
            { value: "9:16", label: "9:16" },
            { value: "3:4", label: "3:4" },
            { value: "4:3", label: "4:3" },
            { value: "1:1", label: "1:1" },
          ],
          validation: { required: true },
        },
        {
          kind: "select",
          id: "resolution",
          label: "输出分辨率",
          labelEn: "Output Resolution",
          mapping: { nodeId: "input", inputPath: ["resolution"] },
          defaultValue: "720P",
          options: [
            { value: "720P",  label: "720P（标准）",  labelEn: "720P (Standard)" },
            { value: "1080P", label: "1080P（高清）", labelEn: "1080P (HD)" },
          ],
          validation: { required: true },
        },
        {
          kind: "numberSlider",
          id: "duration",
          label: "视频时长 (秒) - 150积分/秒",
          labelEn: "Duration (seconds) — 150 credits/sec",
          description: "时长越长，消耗积分越多。允许范围：3–15 秒。",
          descriptionEn: "Longer videos consume more credits. Allowed range: 3–15 seconds.",
          mapping: { nodeId: "input", inputPath: ["duration"] },
          defaultValue: 5,
          showMinLabel: false,
          showMaxLabel: false,
          validation: { min: 3, max: 15, step: 1, integer: true },
        },
        {
          kind: "multiImageUpload",
          id: "image_urls",
          label: "参考图 (HappyHorse 最多9张)",
          labelEn: "Reference Images (HappyHorse: up to 9)",
          description:
            "HappyHorse 最多 9 张，万相最多 5 张。万相请使用「图1、图2」；HappyHorse 请使用「[Image 1]、[Image 2]」。",
          descriptionEn:
            "HappyHorse accepts up to 9 images; Wan accepts up to 5. For Wan use '图1, 图2'; for HappyHorse use '[Image 1], [Image 2]'.",
          mapping: { nodeId: "input", inputPath: ["image_urls"] },
          maxItems: 9,
          validation: { required: true, maxSizeMB: 20, accept: ["image/jpeg", "image/png", "image/webp"], minDimension: 400 },
        },
        {
          kind: "textInput",
          id: "videoPrompt",
          label: "正向提示词",
          labelEn: "Positive Prompt",
          multiline: true,
          placeholder: "描述希望出现的主体、动作、镜头与风格，并使用「图1」或「[Image 1]」引用参考图…",
          placeholderEn: "Describe the subjects, motion, camera and style you want; reference images using '图1' or '[Image 1]'…",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 5000 },
        },
        {
          kind: "textInput",
          id: "negativePrompt",
          label: "负向提示词",
          labelEn: "Negative Prompt",
          multiline: true,
          placeholder: "描述不希望出现的内容，例如：低清晰度、畸形肢体、多余手指、闪烁、画面抖动…",
          placeholderEn: "Describe what to avoid, e.g. low resolution, deformed limbs, extra fingers, flicker, camera shake…",
          description: "万相将使用原生反向提示词；HappyHorse 将其转换为提示词中的排除约束。",
          descriptionEn: "Wan uses the native negative prompt; for HappyHorse it is converted into an exclusion instruction.",
          mapping: { nodeId: "input", inputPath: ["negative_prompt"] },
          defaultValue: "",
          validation: { maxLength: 500 },
        },
      ],
    },
  ],
};
