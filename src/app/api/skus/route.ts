import { NextResponse } from "next/server";
import { bailianMultiRefWorkflowMock } from "@/mocks/bailian-multi-ref-workflow";
import { bailianWanxI2vWorkflowMock } from "@/mocks/bailian-wanx-i2v-workflow";
import { imageToVideoWorkflowMock } from "@/mocks/image-to-video-workflow";
import { klingCinemaWorkflowMock } from "@/mocks/kling-cinema-workflow";
import { storyboardWorkflowMock } from "@/mocks/storyboard-workflow";
import { textToImageWorkflowMock } from "@/mocks/text-to-image-workflow";
import type { SkuCatalogResponse, SkuDefinition } from "@/types/sku-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOG: SkuDefinition[] = [
  {
    skuId: "RH_TXT2IMG_SHORTDRAMA",
    providerCode: "RUNNINGHUB_TXT2IMG",
    displayName: "文字生成图片",
    description:
      "用一句话说出您脑海中的画面，选择想要的画幅比例，即可得到一张风格统一的创意配图，适合海报、配图与灵感草图。",
    sellCredits: 5,
    uiSchema: textToImageWorkflowMock,
  },
  {
    skuId: "KLING_CINEMA_PRO",
    providerCode: "RUNNINGHUB_IMG2VIDEO",
    displayName: "单图生成短视频",
    description:
      "上传一张参考图，用日常语言描述镜头怎么走、人物怎么动，系统会据此生成一段连贯的短视频，适合产品展示与社交短片。",
    sellCredits: 25,
    uiSchema: klingCinemaWorkflowMock,
  },
  {
    skuId: "BAILIAN_WANX_I2V",
    providerCode: "ALIYUN_BAILIAN",
    displayName: "多模态图生视频",
    description:
      "上传一张参考图，用文字描述您想要的动作或场景，AI 将为您生成流畅生动的动画视频。支持多种最新模型自选。计费规则：250积分/秒，动态扣除。",
    sellCredits: 1250,
    uiSchema: bailianWanxI2vWorkflowMock,
  },
  {
    skuId: "BAILIAN_MULTI_REF_I2V",
    providerCode: "ALIYUN_BAILIAN",
    displayName: "多参考图剧场生成",
    description:
      "支持上传多达 9 张参考图！在描述中轻松引用不同角色与场景，为您生成连贯的微短剧片段。计费规则：动态秒数计费。",
    sellCredits: 1250,
    uiSchema: bailianMultiRefWorkflowMock,
  },
  {
    skuId: "RH_SVD_IMG2VID",
    providerCode: "RUNNINGHUB_SVD",
    displayName: "首尾帧过渡视频",
    description:
      "上传开头和结尾两张图片，用文字或选项说明期望的过渡感觉，AI 会自动补足中间的连贯动作，让首尾自然衔接成一段完整视频。",
    sellCredits: 10,
    uiSchema: imageToVideoWorkflowMock,
  },
  {
    skuId: "RH_STORYBOARD",
    providerCode: "RUNNINGHUB_STORYBOARD",
    displayName: "分镜生成出图",
    description:
      "上传一张角色参考图，描述创作方向，AI 自动生成多张风格一致的电影级分镜图，每张均可单独下载。适合广告预演、短剧分镜与概念设计。",
    sellCredits: 30,
    uiSchema: storyboardWorkflowMock,
  },
];

/**
 * GET `/api/skus` — 返回创作功能目录与表单配置，供工作台动态渲染。
 */
export async function GET(): Promise<NextResponse<SkuCatalogResponse>> {
  const body: SkuCatalogResponse = { ok: true, skus: CATALOG };
  return NextResponse.json(body);
}
