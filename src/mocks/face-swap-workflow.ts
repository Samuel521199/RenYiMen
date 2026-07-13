import type { WorkflowFormSchema } from "@/types/workflow";

/**
 * 换头换脸（Best-Face-Swap）：
 * 底图（保留身体+背景）+ 换脸源图（提供脸/头部）→ 高清合成输出。
 * 工作流见 `config/runninghub/lu-face-swap-workflow.json`，
 * 网关 `providerCode: RUNNINGHUB_FACE_SWAP`，接口 `/openapi/v2/run/workflow/2056544007479709698`。
 *
 * 节点对应：
 *   - 节点 71（LoadImage）：底图（保留其身体、背景、光影）
 *   - 节点 85（LoadImage）：换脸源图（提取其头部/面部）
 */
export const faceSwapWorkflowMock: WorkflowFormSchema = {
  workflowId: "lu-face-swap",
  version: "1.0.0",
  title: "换头换脸",
  titleEn: "Face Swap",
  description:
    "上传两张图片：底图保留身体与背景，换脸源图提供人脸/头部，AI 自动完成高清合成，输出自然融合的结果。",
  descriptionEn:
    "Upload two images: the base image retains the body and background; the face-source image provides the head/face. The AI composites them into a naturally blended, high-resolution result.",
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
          id: "baseImage",
          label: "底图（保留身体 / 背景）",
          labelEn: "Base Image (keep body / background)",
          description:
            "此图的身体、服装、背景与光影将完整保留，仅替换头部。对应工作流节点 71。",
          descriptionEn:
            "The body, clothing, background, and lighting of this image will be fully preserved — only the head is replaced. Maps to workflow node 71.",
          mapping: { nodeId: "71", inputPath: ["image"] },
          validation: {
            required: true,
            maxSizeMB: 25,
            accept: ["image/jpeg", "image/png", "image/webp"],
          },
        },
        {
          kind: "imageUpload",
          id: "faceImage",
          label: "换脸源图（提供人脸 / 头部）",
          labelEn: "Face Source (provide face / head)",
          description:
            "AI 将从此图中提取面部/头部，融合到底图上。对应工作流节点 85。",
          descriptionEn:
            "The AI extracts the face/head from this image and composites it onto the base image. Maps to workflow node 85.",
          mapping: { nodeId: "85", inputPath: ["image"] },
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
