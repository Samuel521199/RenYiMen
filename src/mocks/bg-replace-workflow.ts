import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 背景替换（RunningHub AI App）：
 * 上传用户图（主体）+ 背景图，AI 自动抠出主体并融合到新背景中。
 * 接口：POST /openapi/v2/run/ai-app/1985263746748661761
 * 请求体格式：{ nodeInfoList: [{nodeId, fieldName, fieldValue}] }
 * 网关 providerCode: RUNNINGHUB_BG_REPLACE
 *
 * 节点对应：
 *   - 节点 2，字段 image：用户图（人物 / 主体）
 *   - 节点 21，字段 image：背景图（目标背景）
 */
export const bgReplaceWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-bg-replace",
  version: "1.0.0",
  title: "背景替换",
  titleEn: "Background Replace",
  description:
    "上传两张图片：主体图保留人物或物体，背景图提供目标场景，AI 自动完成抠图与融合，输出自然合成结果。",
  descriptionEn:
    "Upload two images: the subject image retains the person or object; the background image provides the target scene. The AI automatically segments and composites them into a natural result.",
  fields: [
    {
      kind: "group",
      id: "images",
      label: "上传图片",
      labelEn: "Upload Images",
      description: "两张图片均为必填，顺序不可颠倒。",
      descriptionEn: "Both images are required. Order matters — do not reverse them.",
      children: [
        {
          kind: "imageUpload",
          id: "subjectImage",
          label: "用户图（保留人物 / 主体）",
          labelEn: "Subject Image (keep person / object)",
          description:
            "AI 将从此图中识别并抠出主体（人物、物品等），保留其外观与细节。对应节点 2。",
          descriptionEn:
            "The AI will detect and extract the main subject (person, object, etc.) from this image, preserving its appearance and details. Maps to node 2.",
          mapping: { nodeId: "2", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 25,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
        {
          kind: "imageUpload",
          id: "backgroundImage",
          label: "背景图（目标场景）",
          labelEn: "Background Image (target scene)",
          description:
            "主体将被融合到此背景中，建议使用与主体光线方向一致的场景图，效果更自然。对应节点 21。",
          descriptionEn:
            "The subject will be composited onto this background. For the most natural result, choose a scene whose lighting direction matches the subject. Maps to node 21.",
          mapping: { nodeId: "21", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 25,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
      ],
    },
  ],
};
