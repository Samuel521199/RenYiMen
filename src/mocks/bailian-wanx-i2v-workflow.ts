import type { WorkflowFormSchema } from "@/types/workflow";

const MODEL_ENUM = ["wan2.7-i2v-2026-04-25", "happyhorse-1.1-i2v"] as const;
const MODEL_ENUM_NAMES = ["通义万相 2.7", "HappyHorse 1.1"] as const;

/** 多模态图生视频：单张参考图 + 文案描述生成短视频，模型与时长在表单中自选。 */
export const bailianWanxI2vWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-multi-i2v",
  version: "1.8.0",
  title: "多模态图生视频",
  titleEn: "Multimodal Image-to-Video",
  description:
    "上传一张参考图，用文字描述您想要的动作或场景，即可生成流畅生动的动画视频。可在下方选择生成风格与视频时长；计费按所选秒数动态估算（150 积分/秒）。",
  descriptionEn:
    "Upload a reference image and describe the desired motion or scene in text to generate a smooth, vivid animated video. Choose the generation style and duration below. Billing is dynamically estimated at 150 credits per second.",
  schema: {
    type: "object",
    properties: {
      modelName: {
        type: "string",
        title: "选择生成模型",
        enum: [...MODEL_ENUM],
        enumNames: [...MODEL_ENUM_NAMES],
        default: "wan2.7-i2v-2026-04-25",
      },
      duration: {
        type: "integer",
        title: "视频时长 (秒) - 150积分/秒",
        minimum: 3,
        maximum: 15,
        default: 5,
      },
    },
  },
  uiSchema: {
    modelName: { "ui:widget": "select" },
    duration: {
      "ui:widget": "range",
      "ui:help": "时长越长，消耗积分越多。允许范围：3-15秒。",
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
          defaultValue: "wan2.7-i2v-2026-04-25",
          options: [
            { value: "wan2.7-i2v-2026-04-25", label: "通义万相 2.7", labelEn: "Tongyi Wanxiang 2.7" },
            { value: "happyhorse-1.1-i2v", label: "HappyHorse 1.1", labelEn: "HappyHorse 1.1" },
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
          validation: { min: 3, max: 15, step: 1, integer: true },
        },
        {
          kind: "imageUpload",
          id: "refImage",
          label: "参考图",
          labelEn: "Reference Image",
          description: "请上传一张清晰的图片（宽高均 ≥ 300 px），作为视频的起始画面。",
          descriptionEn: "Upload a clear image (width and height ≥ 300 px) to serve as the opening frame.",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: { required: true, maxSizeMB: 20, accept: ["image/jpeg", "image/png", "image/webp"], minDimension: 300 },
        },
        {
          kind: "textInput",
          id: "videoPrompt",
          label: "视频描述 / 运镜",
          labelEn: "Video Description / Camera",
          multiline: true,
          placeholder: "描述画面运动、镜头与风格…",
          placeholderEn: "Describe motion, camera moves and style…",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 2000 },
        },
      ],
    },
  ],
};
