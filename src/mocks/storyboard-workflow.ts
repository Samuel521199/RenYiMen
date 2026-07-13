import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 分镜生成出图（美妆广告 3~N 分镜）：
 * 参考图 + 文字导演提示词 → LLM 生成分镜描述 → 批量出图（多图输出）。
 * 工作流见 `config/runninghub/lu-storyboard-workflow.json`，
 * 网关 `providerCode: RUNNINGHUB_STORYBOARD`，接口 `/openapi/v2/run/workflow/1991312445449023489`。
 */
export const storyboardWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-storyboard",
  version: "1.0.0",
  title: "分镜生成出图",
  titleEn: "Storyboard Generation",
  description:
    "上传一张角色参考图，填写创作方向，AI 将自动生成多张风格一致的电影级分镜图，每张均可单独下载。",
  descriptionEn:
    "Upload a character reference image and provide a creative direction. The AI will automatically generate multiple cinematic storyboard frames with a consistent style, each available for individual download.",
  fields: [
    {
      kind: "group",
      id: "reference",
      label: "参考素材",
      labelEn: "Reference Material",
      description: "参考图写入节点 74（LoadImage），用于保持人物外观与光影风格一致。",
      descriptionEn: "The reference image is written to node 74 (LoadImage) to maintain consistent character appearance and lighting style.",
      children: [
        {
          kind: "imageUpload",
          id: "referenceImage",
          label: "角色 / 场景参考图",
          labelEn: "Character / Scene Reference",
          description: "写入工作流节点 74，LLM 与图像生成均以此图为风格锚点。",
          descriptionEn: "Written to workflow node 74. Both the LLM and image generation use this image as the style anchor.",
          mapping: { nodeId: "74", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 25,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
    {
      kind: "group",
      id: "generation",
      label: "生成参数",
      labelEn: "Generation Settings",
      children: [
        {
          kind: "textInput",
          id: "directorPrompt",
          label: "创作方向 / 导演提示",
          labelEn: "Creative Direction / Director Notes",
          multiline: true,
          placeholder:
            "例如：这是一部化妆品广告宣传片，从坐姿到站起身，不同运镜和角度，不同的视角和景别…",
          placeholderEn:
            "e.g. This is a cosmetics commercial — from sitting to standing, varied camera moves and angles, different perspectives and shot types…",
          description:
            "写入节点 103（JjkText），LLM 以此为主题生成连续分镜脚本，再逐帧出图。",
          descriptionEn:
            "Written to node 103 (JjkText). The LLM uses this as the theme to generate a sequential storyboard script, then renders each frame.",
          mapping: { nodeId: "103", inputPath: ["text"] },
          defaultValue:
            "这是一部化妆品广告宣传片，帮我生成12张美女化妆品广告宣传片，从坐姿到站起身，不同运镜和角度，不同的视角和景别",
          validation: { required: true, minLength: 10, maxLength: 2000 },
        },
        {
          kind: "select",
          id: "outputResolution",
          label: "输出分辨率（最短边）",
          labelEn: "Output Resolution (short edge)",
          description: "写入节点 104（Int）；720×1280 比例固定，此值调整整体清晰度与耗时。",
          descriptionEn: "Written to node 104 (Int). The 720×1280 aspect ratio is fixed; this value adjusts overall clarity and processing time.",
          mapping: { nodeId: "104", inputPath: ["value"] },
          defaultValue: "1024",
          options: [
            { value: "512", label: "512（较快）", labelEn: "512 (faster)" },
            { value: "768", label: "768", labelEn: "768" },
            { value: "1024", label: "1024（默认）", labelEn: "1024 (default)" },
          ],
        },
      ],
    },
  ],
};
