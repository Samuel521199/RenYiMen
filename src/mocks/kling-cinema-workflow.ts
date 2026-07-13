import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 图生视频（LU 短剧六件套之三）：参考图 + 主题/手写描述，对应 Comfy 节点 21（LoadImage）、70/78（JjkText）、77（是否走大模型扩写）。
 * 完整图结构见 `config/runninghub/lu-img2video-workflow.json`，由网关随 `RUNNINGHUB_IMG2VIDEO_REMOTE_WORKFLOW_ID` 一并提交。
 */
export const klingCinemaWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-img2video-i2v",
  version: "1.0.0",
  title: "图生视频",
  titleEn: "Image-to-Video",
  description: "上传参考图，填写主题与镜头描述；与 LU 图生视频工作流节点对齐。",
  descriptionEn: "Upload a reference image and provide a theme and camera description; aligned with LU image-to-video workflow nodes.",
  fields: [
    {
      kind: "group",
      id: "reference",
      label: "参考图与描述",
      labelEn: "Reference & Description",
      description: "参考图经上传后写入 LoadImage；主题与手写描述对应工作流中的「主题」与「自定义提示词」链路。",
      descriptionEn: "The reference image is written to LoadImage after upload; theme and hand-written description map to the 'theme' and 'custom prompt' paths in the workflow.",
      children: [
        {
          kind: "imageUpload",
          id: "referenceImage",
          label: "参考图",
          labelEn: "Reference Image",
          description: "作为图生视频的视觉参考（工作流节点 21）。",
          descriptionEn: "Visual reference for image-to-video generation (workflow node 21).",
          mapping: { nodeId: "21", inputPath: ["image"] },
          validation: { required: true, maxSizeMB: 25, accept: ["image/jpeg", "image/png", "image/webp"] },
        },
        {
          kind: "textInput",
          id: "theme",
          label: "主题 / 一句话剧情",
          labelEn: "Theme / One-line Plot",
          multiline: true,
          placeholder: "例如：雨夜霓虹巷口，人物回眸，电影感…",
          placeholderEn: "e.g. A rainy neon alley at night, the character glances back, cinematic mood…",
          mapping: { nodeId: "70", inputPath: ["text"] },
          defaultValue: "",
          validation: { required: false, minLength: 0, maxLength: 2000 },
        },
        {
          kind: "textInput",
          id: "motionPrompt",
          label: "手写运动与镜头描述",
          labelEn: "Camera & Motion Description",
          multiline: true,
          placeholder: "例如：镜头缓慢推进，人物转身，光影由冷变暖…",
          placeholderEn: "e.g. The camera slowly pushes in, the character turns around, light shifts from cold to warm…",
          mapping: { nodeId: "78", inputPath: ["text"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 4000 },
        },
        {
          kind: "select",
          id: "useLlmExpansion",
          label: "提示词来源",
          labelEn: "Prompt Source",
          description: "开启后由工作流内大模型节点根据参考图与主题扩写；关闭则仅使用「手写运动与镜头描述」。",
          descriptionEn: "When enabled, the LLM node in the workflow expands the prompt based on the reference image and theme; when disabled, only the hand-written camera description is used.",
          mapping: { nodeId: "77", inputPath: ["value"] },
          defaultValue: "false",
          options: [
            { value: "false", label: "仅使用手写描述（推荐）", labelEn: "Hand-written only (recommended)" },
            { value: "true", label: "由大模型根据参考图 + 主题扩写", labelEn: "Expand via LLM using image + theme" },
          ],
        },
        {
          kind: "numberSlider",
          id: "videoDurationSeconds",
          label: "视频时长（秒）",
          labelEn: "Video Duration (seconds)",
          description: "生成视频的时长，对应工作流节点 99；实际帧数 = 秒数 × 16 + 1。时长越长显存消耗越高，建议不超过 8 秒。",
          descriptionEn: "Duration of the generated video, mapped to workflow node 99. Actual frames = seconds × 16 + 1. Longer videos consume more VRAM; recommend keeping under 8 seconds.",
          mapping: { nodeId: "99", inputPath: ["value"] },
          defaultValue: 5,
          validation: { min: 3, max: 10, step: 1, integer: true },
        },
      ],
    },
  ],
};
