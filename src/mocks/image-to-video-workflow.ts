import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * LU 短剧六件套之四「首尾帧生视频」：节点与 `config/runninghub/lu-flf2video-workflow.json` 一致；
 * 网关对 RUNNINGHUB_SVD 会如「图生视频」一样发送完整 workflow + 本地 apply 覆盖（见 RunningHubAdapter）。
 */
export const imageToVideoWorkflowMock: WorkflowFormSchema = {
  workflowId: "img2vid-runninghub-demo",
  version: "1.3.0",
  title: "首尾帧生成视频",
  description:
    "上传首帧与尾帧，填写镜头描述；可选由工作流内大模型根据双图扩写。节点与 LU 首尾帧工作流（ImageLoader 23/20、CLIP 22 链路）对齐。",
  fields: [
    {
      kind: "group",
      id: "media",
      label: "素材",
      description: "首帧写入节点 23，尾帧写入节点 20（经缩放后接入 WanFirstLastFrameToVideo）。",
      children: [
        {
          kind: "imageUpload",
          id: "firstFrame",
          label: "首帧图片",
          description: "视频起点画面（ImageLoader 23 → 缩放 11 → start_image）",
          mapping: { nodeId: "23", inputPath: ["image"] },
          validation: { required: true, maxSizeMB: 25, accept: ["image/jpeg", "image/png", "image/webp"] },
        },
        {
          kind: "imageUpload",
          id: "lastFrame",
          label: "尾帧图片",
          description: "视频终点画面（ImageLoader 20 → Resize 12 → end_image）",
          mapping: { nodeId: "20", inputPath: ["image"] },
          validation: { required: true, maxSizeMB: 25, accept: ["image/jpeg", "image/png", "image/webp"] },
        },
      ],
    },
    {
      kind: "group",
      id: "generation",
      label: "生成参数",
      children: [
        {
          kind: "textInput",
          id: "positivePrompt",
          label: "手写镜头与运动描述",
          multiline: true,
          placeholder: "例如：两图之间如何过渡、运镜与动作变化…",
          mapping: { nodeId: "37", inputPath: ["text"] },
          defaultValue: "",
          validation: { required: true, minLength: 2, maxLength: 4000 },
        },
        {
          kind: "select",
          id: "useLlmExpansion",
          label: "提示词来源",
          description:
            "开启后由 Qwen3 等节点根据双图与内置导演词扩写；关闭时仅使用上方手写描述（对应节点 36 → easy ifElse → ShowAnything 46 → CLIP 22）。",
          mapping: { nodeId: "36", inputPath: ["value"] },
          defaultValue: "false",
          options: [
            { value: "false", label: "仅使用手写描述（推荐）" },
            { value: "true", label: "由大模型根据双图扩写" },
          ],
        },
        {
          kind: "numberSlider",
          id: "videoDurationSeconds",
          label: "视频时长（秒）",
          description: "生成视频的时长，对应工作流节点 50；实际帧数 = 秒数 × 16 + 1。时长越长显存消耗越高，建议不超过 8 秒。",
          mapping: { nodeId: "50", inputPath: ["value"] },
          defaultValue: 5,
          validation: { min: 3, max: 10, step: 1, integer: true },
        },
        {
          kind: "select",
          id: "outputResolution",
          label: "缩放最长边（像素）",
          description: "写入节点 19，经 ImageScale 节点 11 影响生成尺寸。",
          mapping: { nodeId: "19", inputPath: ["value"] },
          defaultValue: "1280",
          options: [
            { value: "480", label: "480（较快）" },
            { value: "720", label: "720" },
            { value: "960", label: "960" },
            { value: "1080", label: "1080" },
            { value: "1280", label: "1280（默认）" },
          ],
        },
      ],
    },
  ],
};
