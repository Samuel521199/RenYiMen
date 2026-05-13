import type { WorkflowFormSchema } from "@/types/workflow";

const MODEL_ENUM = ["wan2.7-i2v-2026-04-25", "happyhorse-1.0-i2v"] as const;
const MODEL_ENUM_NAMES = ["通义万相 2.7", "HappyHorse 1.0"] as const;

/** 多模态图生视频：单张参考图 + 文案描述生成短视频，模型与时长在表单中自选。 */
export const bailianWanxI2vWorkflowMock: WorkflowFormSchema = {
  workflowId: "bailian-multi-i2v",
  version: "1.7.0",
  title: "多模态图生视频",
  description:
    "上传一张参考图，用文字描述您想要的动作或场景，即可生成流畅生动的动画视频。可在下方选择生成风格与视频时长；计费按所选秒数动态估算（250 积分/秒）。",
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
        title: "视频时长 (秒) - 250积分/秒",
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
      children: [
        {
          kind: "select",
          id: "modelName",
          label: "选择生成模型",
          mapping: { nodeId: "input", inputPath: ["modelName"] },
          defaultValue: "wan2.7-i2v-2026-04-25",
          options: [
            { value: "wan2.7-i2v-2026-04-25", label: "通义万相 2.7" },
            { value: "happyhorse-1.0-i2v", label: "HappyHorse 1.0" },
          ],
          validation: { required: true },
        },
        {
          kind: "numberSlider",
          id: "duration",
          label: "视频时长 (秒) - 250积分/秒",
          description: "时长越长，消耗积分越多。允许范围：3–15 秒。",
          mapping: { nodeId: "input", inputPath: ["duration"] },
          defaultValue: 5,
          validation: { min: 3, max: 15, step: 1, integer: true },
        },
        {
          kind: "imageUpload",
          id: "refImage",
          label: "参考图",
          description: "请上传一张清晰的图片，作为视频的起始画面。",
          mapping: { nodeId: "input", inputPath: ["image_url"] },
          validation: { required: true, maxSizeMB: 20, accept: ["image/jpeg", "image/png", "image/webp"] },
        },
        {
          kind: "textInput",
          id: "videoPrompt",
          label: "视频描述 / 运镜",
          multiline: true,
          placeholder: "描述画面运动、镜头与风格…",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 2000 },
        },
      ],
    },
  ],
};
