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
  description:
    "上传一张角色参考图，填写创作方向，AI 将自动生成多张风格一致的电影级分镜图，每张均可单独下载。",
  fields: [
    {
      kind: "group",
      id: "reference",
      label: "参考素材",
      description: "参考图写入节点 74（LoadImage），用于保持人物外观与光影风格一致。",
      children: [
        {
          kind: "imageUpload",
          id: "referenceImage",
          label: "角色 / 场景参考图",
          description: "写入工作流节点 74，LLM 与图像生成均以此图为风格锚点。",
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
      children: [
        {
          kind: "textInput",
          id: "directorPrompt",
          label: "创作方向 / 导演提示",
          multiline: true,
          placeholder:
            "例如：这是一部化妆品广告宣传片，从坐姿到站起身，不同运镜和角度，不同的视角和景别…",
          description:
            "写入节点 103（JjkText），LLM 以此为主题生成连续分镜脚本，再逐帧出图。",
          mapping: { nodeId: "103", inputPath: ["text"] },
          defaultValue:
            "这是一部化妆品广告宣传片，帮我生成12张美女化妆品广告宣传片，从坐姿到站起身，不同运镜和角度，不同的视角和景别",
          validation: { required: true, minLength: 10, maxLength: 2000 },
        },
        {
          kind: "select",
          id: "outputResolution",
          label: "输出分辨率（最短边）",
          description: "写入节点 104（Int）；720×1280 比例固定，此值调整整体清晰度与耗时。",
          mapping: { nodeId: "104", inputPath: ["value"] },
          defaultValue: "1024",
          options: [
            { value: "512", label: "512（较快）" },
            { value: "768", label: "768" },
            { value: "1024", label: "1024（默认）" },
          ],
        },
      ],
    },
  ],
};
