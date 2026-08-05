import type { WorkflowFormSchema } from "@/types/workflow";

/** HappyHorse 视频编辑：原视频 + 编辑指令 + 可选参考图。 */
export const bailianHappyHorseVideoEditWorkflowMock: WorkflowFormSchema = {
  workflowId: "happyhorse-1.0-video-edit",
  version: "1.0.0",
  title: "局部修改",
  titleEn: "Local Video Edit",
  description:
    "上传原视频并描述需要修改的局部内容，例如衣服变红、删除路人或替换产品；可选上传最多 5 张参考图。",
  descriptionEn:
    "Upload a source video and describe a local edit, such as changing clothing color, removing passers-by, or replacing a product. Up to five reference images are optional.",
  fields: [
    {
      kind: "group",
      id: "inputGroup",
      label: "编辑输入",
      labelEn: "Edit Input",
      children: [
        {
          kind: "videoUpload",
          id: "sourceVideo",
          label: "原视频",
          labelEn: "Source Video",
          description:
            "上传 3–60 秒的 MP4 或 MOV 视频，不超过 100MB；超过 15 秒时仅编辑前 15 秒。建议使用 H.264 编码。",
          descriptionEn:
            "Upload a 3–60 second MP4 or MOV video, up to 100 MB. For videos longer than 15 seconds, only the first 15 seconds are edited. H.264 is recommended.",
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
          kind: "multiImageUpload",
          id: "referenceImages",
          label: "参考图（可选）",
          labelEn: "Reference Images (Optional)",
          description: "替换衣服、产品或其他元素时可上传参考图，最多 5 张。",
          descriptionEn: "Add reference images when replacing clothing, products, or other elements. Maximum 5 images.",
          mapping: { nodeId: "input", inputPath: ["reference_image_urls"] },
          maxItems: 5,
          validation: {
            required: false,
            maxSizeMB: 20,
            accept: ["image/jpeg", "image/png", "image/webp"],
            minDimension: 300,
          },
        },
        {
          kind: "textInput",
          id: "editPrompt",
          label: "修改要求",
          labelEn: "Edit Instruction",
          multiline: true,
          placeholder: "例如：把人物的衣服变成红色，其他内容保持不变",
          placeholderEn: "For example: Change the person's clothing to red and keep everything else unchanged",
          mapping: { nodeId: "input", inputPath: ["prompt"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 2500 },
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
