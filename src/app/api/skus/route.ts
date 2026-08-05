import { NextResponse } from "next/server";
import { bailianMultiRefWorkflowMock } from "@/mocks/bailian-multi-ref-workflow";
import { bailianDanceMoveWorkflowMock } from "@/mocks/bailian-dance-move-workflow";
import { bailianWan22S2vWorkflowMock } from "@/mocks/bailian-wan22-s2v-workflow";
import { bailianWanxI2vWorkflowMock } from "@/mocks/bailian-wanx-i2v-workflow";
import { autoSubtitleWorkflowMock } from "@/mocks/auto-subtitle-workflow";
import { AUTO_SUBTITLE_CREDITS } from "@/lib/subtitle-pricing";
import { bgReplaceWorkflowMock } from "@/mocks/bg-replace-workflow";
import { videoEnhanceWorkflowMock } from "@/mocks/video-enhance-workflow";
import { faceSwapWorkflowMock } from "@/mocks/face-swap-workflow";
import { gptImage2WorkflowMock } from "@/mocks/gpt-image2-workflow";
import { hdUpscaleWorkflowMock } from "@/mocks/hd-upscale-workflow";
import { mattingWorkflowMock } from "@/mocks/matting-workflow";
import { imageToVideoWorkflowMock } from "@/mocks/image-to-video-workflow";
import { klingCinemaWorkflowMock } from "@/mocks/kling-cinema-workflow";
import { klingStdWorkflowMock } from "@/mocks/kling-std-workflow";
import { klingProWorkflowMock } from "@/mocks/kling-pro-workflow";
import { storyboardWorkflowMock } from "@/mocks/storyboard-workflow";
import { promptReverseWorkflowMock } from "@/mocks/prompt-reverse-workflow";
import { textToImageWorkflowMock } from "@/mocks/text-to-image-workflow";
import { isOnePromptVideoWorkbenchEnabled } from "@/lib/one-prompt-video-feature";
import type { SkuCatalogResponse, SkuDefinition } from "@/types/sku-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOG: SkuDefinition[] = [
  // ── 提示词 / Prompt ──────────────────────────────────────────────
  {
    skuId: "RH_PROMPT_REVERSE",
    providerCode: "RUNNINGHUB_PROMPT_REVERSE",
    category: "prompt",
    cover: "/covers/prompt-reverse.webp",
    displayName: "提示词反推",
    displayNameEn: "Image to Prompt",
    description:
      "上传任意图片，AI 自动分析图片内容，反推出适合 AI 绘画的中文提示词，涵盖人物、场景、风格、光线等关键要素。",
    descriptionEn:
      "Upload any image and AI will analyze its content to generate a detailed AI-painting prompt covering subjects, scenes, styles, and lighting.",
    sellCredits: 10,
    uiSchema: promptReverseWorkflowMock,
  },
  // ── 图片 / Image ─────────────────────────────────────────────────
  {
    skuId: "GPT_IMAGE2_REF",
    providerCode: "GPT_IMAGE2",
    category: "image",
    cover: "/covers/ai-image-generation.webp",
    displayName: "智能图片生成",
    displayNameEn: "AI Image Generation",
    description:
      "上传参考图（可选）并输入创作描述，可一次生成 1–8 张风格一致的高质量图片，支持方形、竖版和横版输出。",
    descriptionEn:
      "Upload an optional reference image and a creative description to generate 1–8 consistent, high-quality images in square, portrait, or landscape formats.",
    sellCredits: 50,
    uiSchema: gptImage2WorkflowMock,
  },
  {
    skuId: "RH_BG_REPLACE",
    providerCode: "RUNNINGHUB_BG_REPLACE",
    category: "image",
    cover: "/covers/background-replace.webp",
    displayName: "背景替换",
    displayNameEn: "Background Replace",
    description:
      "上传用户图（人物/主体）和背景图（目标场景），AI 自动抠出主体并无缝融合到新背景中，适合写真合成、电商场景图制作。",
    descriptionEn:
      "Upload a subject image and a background image — AI automatically cuts out the subject and seamlessly composites it onto the new background. Great for portrait compositing and e-commerce scene creation.",
    sellCredits: 15,
    uiSchema: bgReplaceWorkflowMock,
  },
  {
    skuId: "RH_MATTING",
    providerCode: "RUNNINGHUB_MATTING",
    category: "image",
    cover: "/covers/portrait-cutout.webp",
    displayName: "人像抠图",
    displayNameEn: "Portrait Cutout",
    description:
      "上传图片并用文字描述需求，AI 自动完成抠图、换背景、去文字、去特效等操作。例如：「抠出人物，背景换成纯白色」。",
    descriptionEn:
      "Upload an image and describe your goal in plain text — AI will automatically cut out the subject, replace backgrounds, remove text or effects, and more. E.g. 'Cut out the person and set a pure white background'.",
    sellCredits: 10,
    uiSchema: mattingWorkflowMock,
  },
  {
    skuId: "RH_HD_UPSCALE",
    providerCode: "RUNNINGHUB_HD_UPSCALE",
    category: "image",
    cover: "/covers/hd-upscale.webp",
    displayName: "高清放大",
    displayNameEn: "HD Upscale",
    description:
      "上传任意图片，AI 超分辨率算法自动增强细节、提升清晰度，输出分辨率可选 1k～8k，适合老照片修复、生成图及分镜图放大。",
    descriptionEn:
      "Upload any image and AI super-resolution will enhance details and clarity. Choose output resolution from 1k to 8k — ideal for photo restoration, generated images, and storyboard upscaling.",
    sellCredits: 10,
    uiSchema: hdUpscaleWorkflowMock,
  },
  {
    skuId: "RH_FACE_SWAP",
    providerCode: "RUNNINGHUB_FACE_SWAP",
    category: "image",
    cover: "/covers/face-swap.webp",
    displayName: "换头换脸",
    displayNameEn: "Face Swap",
    description:
      "上传底图和换脸源图，AI 自动将源图的面部/头部高清合成到底图上，保留底图的身体、服装与背景，输出自然融合的结果。",
    descriptionEn:
      "Upload a base image and a face-donor image. AI replaces the head/face in the base image with the one from the donor, preserving the body, outfit, and background for a photorealistic result.",
    sellCredits: 20,
    uiSchema: faceSwapWorkflowMock,
  },
  {
    skuId: "RH_TXT2IMG_SHORTDRAMA",
    providerCode: "RUNNINGHUB_TXT2IMG",
    category: "image",
    cover: "/covers/text-to-image.webp",
    displayName: "文字生成图片",
    displayNameEn: "Text to Image",
    description:
      "用一句话说出您脑海中的画面，选择想要的画幅比例，即可得到一张风格统一的创意配图，适合海报、配图与灵感草图。",
    descriptionEn:
      "Describe your idea in one sentence, choose an aspect ratio, and get a stylistically consistent creative image — perfect for posters, covers, and mood boards.",
    sellCredits: 5,
    uiSchema: textToImageWorkflowMock,
  },
  {
    skuId: "RH_STORYBOARD",
    providerCode: "RUNNINGHUB_STORYBOARD",
    category: "image",
    cover: "/covers/storyboard-generator.webp",
    displayName: "分镜生成出图",
    displayNameEn: "Storyboard Generator",
    description:
      "上传一张角色参考图，描述创作方向，AI 自动生成多张风格一致的电影级分镜图，每张均可单独下载。适合广告预演、短剧分镜与概念设计。",
    descriptionEn:
      "Upload a character reference image, describe your creative direction, and AI generates multiple cinematic storyboard frames — each downloadable individually. Ideal for ad storyboards, short drama production, and concept design.",
    sellCredits: 30,
    uiSchema: storyboardWorkflowMock,
  },
  {
    skuId: "CHARACTER_TURNAROUND",
    providerCode: "VIDEO_ORCHESTRATOR",
    category: "image",
    cover: "/covers/character-turnaround.webp",
    displayName: "人物三视图",
    displayNameEn: "Character Turnaround",
    description:
      "上传一张人物身份参考图，依次生成并审核正面、侧面和背面三张独立全身设定图。侧面继承已批准正面，背面继承已批准侧面，避免身份漂移。",
    descriptionEn:
      "Upload one identity reference to generate three separate full-body views: front, side, and back. Each derived view waits for the previous approved view to preserve identity.",
    sellCredits: 0,
    href: "/workbench/tools/character-turnaround",
    uiSchema: textToImageWorkflowMock,
  },
  // ── 视频 / Video ─────────────────────────────────────────────────
  {
    skuId: "LOCAL_AUTO_SUBTITLES",
    providerCode: "LOCAL_MEDIA",
    category: "video",
    cover: "/covers/auto-subtitles.webp",
    displayName: "自动添加字幕",
    displayNameEn: "Auto Subtitles",
    description: "上传带有人声的视频，自动完成语音识别、时间轴匹配与字幕合成，并输出一个新的字幕版视频。",
    descriptionEn: "Upload a video with speech to automatically transcribe, align, and render a new captioned video.",
    sellCredits: AUTO_SUBTITLE_CREDITS,
    uiSchema: autoSubtitleWorkflowMock,
  },
  {
    skuId: "ONE_PROMPT_30S_VIDEO",
    providerCode: "VIDEO_ORCHESTRATOR",
    category: "video",
    cover: "/covers/animated-cover.webp",
    displayName: "一句话成片",
    displayNameEn: "One Prompt 30s Video",
    description:
      "输入一句话，自动拆分 30s 分镜脚本，生成可审核关键帧，并预留逐镜头视频与最终合成流程。",
    descriptionEn:
      "Enter one prompt to generate an editable 30-second storyboard plan, review keyframes, then continue toward shot clips and final composition.",
    sellCredits: 5000,
    href: "/workbench/tools/one-prompt-video",
    uiSchema: textToImageWorkflowMock,
  },  {
    skuId: "RH_VIDEO_ENHANCE",
    providerCode: "RUNNINGHUB_VIDEO_ENHANCE",
    category: "video",
    cover: "/covers/video-enhance.webp",
    displayName: "视频模糊修复",
    displayNameEn: "Video Enhance",
    description:
      "上传模糊或低清视频，AI 超分辨率算法自动修复画质、增强细节，输出最大边可选 720～2560 像素，适合老视频翻新与内容二次制作。",
    descriptionEn:
      "Upload a blurry or low-resolution video — AI super-resolution restores clarity and enhances detail. Output max edge from 720 to 2560 px. Perfect for restoring old footage and repurposing content.",
    sellCredits: 40,
    uiSchema: videoEnhanceWorkflowMock,
  },
  {
    skuId: "KLING_CINEMA_PRO",
    providerCode: "RUNNINGHUB_IMG2VIDEO",
    category: "video",
    cover: "/covers/image-to-video.webp",
    displayName: "单图生成短视频",
    displayNameEn: "Image to Video",
    description:
      "上传一张参考图，用日常语言描述镜头怎么走、人物怎么动，系统会据此生成一段连贯的短视频，适合产品展示与社交短片。",
    descriptionEn:
      "Upload a reference image and describe how the camera moves or characters act — the system generates a short cohesive video, great for product showcases and social clips.",
    sellCredits: 25,
    uiSchema: klingCinemaWorkflowMock,
  },
  {
    skuId: "KLING_STD_I2V",
    providerCode: "KLING_STD",
    category: "video",
    cover: "/covers/kling-standard.webp",
    displayName: "Kling 标准版·图生视频",
    displayNameEn: "Kling Standard · Image to Video",
    description:
      "上传一张参考图，填写镜头描述，生成流畅生动的短视频。标准版性价比更高，适合快速迭代与批量生成。单次固定消耗 400 积分。",
    descriptionEn:
      "Upload a reference image and describe the motion to generate a smooth video clip. The Standard version offers great value for rapid iteration. Flat rate: 400 credits/generation.",
    sellCredits: 400,
    uiSchema: klingStdWorkflowMock,
  },
  // KLING_PRO_I2V 暂时隐藏（O3-pro 生成较慢，体验待优化后再上线）
  {
    skuId: "BAILIAN_WAN22_ANIMATE_MOVE",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/dance-motion-transfer.webp",
    displayName: "模仿生成舞蹈视频",
    displayNameEn: "Dance Motion Transfer",
    description:
      "上传人物图片和舞蹈参考视频，将参考视频中的动作与表情自然迁移到图片人物上，适合舞蹈演绎、角色表演与创意短视频制作。",
    descriptionEn:
      "Upload a character image and dance reference video to transfer the motion and expressions naturally onto the character for dance, performance, and creative short videos.",
    sellCredits: 500,
    uiSchema: bailianDanceMoveWorkflowMock,
  },
  {
    skuId: "BAILIAN_WAN22_S2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/talking-character-video.webp",
    displayName: "有声视频",
    displayNameEn: "Talking Character Video",
    description:
      "上传人物图片和人声音频，生成口型、表情和动作同步的说话、唱歌或表演视频，支持 480P 与 720P 输出。",
    descriptionEn:
      "Upload a character image and voice audio to generate a synchronized speaking, singing, or performing video in 480P or 720P.",
    sellCredits: 625,
    uiSchema: bailianWan22S2vWorkflowMock,
  },
  {
    skuId: "BAILIAN_WANX_I2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/multimodal-image-to-video.webp",
    displayName: "多模态图生视频",
    displayNameEn: "Multimodal Image-to-Video",
    description:
      "上传一张参考图并描述想要的动作或场景，生成流畅生动的动画视频，可自由设置画面比例、清晰度与时长。",
    descriptionEn:
      "Upload a reference image and describe the desired action or scene to generate a smooth animated video with adjustable aspect ratio, quality, and duration.",
    sellCredits: 1250,
    uiSchema: bailianWanxI2vWorkflowMock,
  },
  {
    skuId: "BAILIAN_MULTI_REF_I2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/multi-reference-drama.webp",
    displayName: "多参考图剧场生成",
    displayNameEn: "Multi-Reference Drama",
    description:
      "上传多张参考图，在描述中指定不同角色与场景，生成角色外观与画面风格保持连贯的微短剧片段。",
    descriptionEn:
      "Upload multiple reference images and identify characters and scenes in the description to generate coherent micro-drama clips with consistent visual style.",
    sellCredits: 1250,
    uiSchema: bailianMultiRefWorkflowMock,
  },
  {
    skuId: "RH_SVD_IMG2VID",
    providerCode: "RUNNINGHUB_SVD",
    category: "video",
    cover: "/covers/first-last-frame.webp",
    displayName: "首尾帧过渡视频",
    displayNameEn: "First-Last Frame Video",
    description:
      "上传开头和结尾两张图片，用文字或选项说明期望的过渡感觉，AI 会自动补足中间的连贯动作，让首尾自然衔接成一段完整视频。",
    descriptionEn:
      "Upload a first and last frame, describe the desired transition, and AI fills in the smooth motion in between — turning two images into a complete video.",
    sellCredits: 10,
    uiSchema: imageToVideoWorkflowMock,
  },
];

const PUBLIC_DESCRIPTION_FORBIDDEN_NAME = /阿里百炼|Alibaba Model Studio|RunningHub|GPT[- ]?image|Qwen|llama\.cpp|O3[- ]?pro|wan\d|HappyHorse|通义万相|Tongyi Wanxiang/i;

for (const sku of CATALOG) {
  const publicDescriptions = [
    sku.description,
    sku.descriptionEn,
    sku.uiSchema.description,
    sku.uiSchema.descriptionEn,
  ].filter((value): value is string => typeof value === "string");
  if (publicDescriptions.some((description) => PUBLIC_DESCRIPTION_FORBIDDEN_NAME.test(description))) {
    throw new Error(`Public tool description must describe functionality without provider or model names: ${sku.skuId}`);
  }
}

/**
 * GET `/api/skus` — 返回创作功能目录与表单配置，供工作台动态渲染。
 */
export async function GET(): Promise<NextResponse<SkuCatalogResponse>> {
  const skus = isOnePromptVideoWorkbenchEnabled()
    ? CATALOG
    : CATALOG.filter((sku) => sku.skuId !== "ONE_PROMPT_30S_VIDEO");
  const body: SkuCatalogResponse = { ok: true, skus };
  return NextResponse.json(body);
}
