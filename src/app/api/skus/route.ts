import { NextResponse } from "next/server";
import { bailianMultiRefWorkflowMock } from "@/mocks/bailian-multi-ref-workflow";
import { bailianDanceMoveWorkflowMock } from "@/mocks/bailian-dance-move-workflow";
import { bailianWan22S2vWorkflowMock } from "@/mocks/bailian-wan22-s2v-workflow";
import { bailianVoiceCloneWorkflowMock } from "@/mocks/bailian-voice-clone-workflow";
import { bailianWanxI2vWorkflowMock } from "@/mocks/bailian-wanx-i2v-workflow";
import { bailianTripo3dWorkflowMock } from "@/mocks/bailian-tripo-3d-workflow";
import { bailianHappyHorseVideoEditWorkflowMock } from "@/mocks/bailian-happyhorse-video-edit-workflow";
import { bailianSceneLightVideoEditWorkflowMock } from "@/mocks/bailian-scene-light-video-edit-workflow";
import { bailianOverallStyleTransferWorkflowMock } from "@/mocks/bailian-overall-style-transfer-workflow";
import { bailianHighDynamicRedrawWorkflowMock } from "@/mocks/bailian-high-dynamic-redraw-workflow";
import { autoSubtitleWorkflowMock } from "@/mocks/auto-subtitle-workflow";
import { localAudioExtractionWorkflowMock } from "@/mocks/local-audio-extraction-workflow";
import { AUTO_SUBTITLE_CREDITS } from "@/lib/subtitle-pricing";
import { bailianVideoContinuationWorkflowMock } from "@/mocks/bailian-video-continuation-workflow";
import { bailianCameraReplicationWorkflowMock } from "@/mocks/bailian-camera-replication-workflow";
import { bailianEffectReplicationWorkflowMock } from "@/mocks/bailian-effect-replication-workflow";
import { bailianVoiceDesignWorkflowMock } from "@/mocks/bailian-voice-design-workflow";
import { bailianEmotionalTtsWorkflowMock } from "@/mocks/bailian-emotional-tts-workflow";
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
    cover: "/covers/prompt-reverse-animated.webp",
    coverVideo: "/covers/prompt-reverse-motion.mp4",
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
    coverVideo: "/covers/ai-image-generation-motion.mp4",
    displayName: "智能图片生成",
    displayNameEn: "AI Image Generation",
    description:
      "上传参考图（可选）+ 提示词，由 GPT-image-2 生成 1–8 张高质量图片，支持方图、竖图、横图输出。按张计费：低质 20积分、中质 50积分、高质 150积分。",
    descriptionEn:
      "Upload a reference image (optional) plus a prompt — GPT-image-2 generates 1–8 high-quality images in square, portrait, or landscape. Per-image billing: Low 20 cr, Medium 50 cr, High 150 cr.",
    sellCredits: 50,
    uiSchema: gptImage2WorkflowMock,
  },
  {
    skuId: "RH_BG_REPLACE",
    providerCode: "RUNNINGHUB_BG_REPLACE",
    category: "image",
    cover: "/covers/background-replace.webp",
    coverVideo: "/covers/background-replace-motion.mp4",
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
    coverVideo: "/covers/portrait-cutout-motion.mp4",
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
    coverVideo: "/covers/hd-upscale-motion.mp4",
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
    coverVideo: "/covers/face-swap-motion.mp4",
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
    coverVideo: "/covers/text-to-image-motion.mp4",
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
    coverVideo: "/covers/storyboard-generator-motion.mp4",
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
    coverVideo: "/covers/character-turnaround-motion.mp4",
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
  // ── 模型 / Model ─────────────────────────────────────────────────
  {
    skuId: "BAILIAN_TRIPO_3D",
    providerCode: "ALIYUN_BAILIAN",
    category: "model",
    cover: "/covers/tripo-3d.webp",
    coverVideo: "/covers/tripo-3d-motion.mp4",
    displayName: "Tripo 3D 模型生成",
    displayNameEn: "Tripo 3D Model Generation",
    description: "支持文生 3D、单图生 3D 和 2–4 张多视角图生 3D，可选择快速 P1.0 或高精度 H3.1，并控制贴图、PBR 与几何精度。",
    descriptionEn: "Generate 3D assets from text, one image, or 2–4 multi-view images. Choose fast P1.0 or high-fidelity H3.1 with texture, PBR, and geometry controls.",
    sellCredits: 700,
    uiSchema: bailianTripo3dWorkflowMock,
  },
  // ── 视频 / Video ─────────────────────────────────────────────────
  {
    skuId: "LOCAL_AUTO_SUBTITLES",
    providerCode: "LOCAL_MEDIA",
    category: "video",
    cover: "/covers/auto-subtitles.webp",
    coverVideo: "/covers/auto-subtitles-motion.mp4",
    displayName: "自动添加字幕",
    displayNameEn: "Auto Subtitles",
    description: "上传带有人声的视频，自动完成语音识别、时间轴匹配与字幕合成，并输出一个新的字幕版视频。",
    descriptionEn: "Upload a video with speech to automatically transcribe, align, and render a new captioned video.",
    sellCredits: AUTO_SUBTITLE_CREDITS,
    uiSchema: autoSubtitleWorkflowMock,
  },
  {
    skuId: "LOCAL_AUDIO_EXTRACTION",
    providerCode: "LOCAL_AUDIO_EXTRACTION",
    category: "video",
    cover: "/covers/video-audio-extraction.webp",
    coverVideo: "/covers/video-audio-extraction-motion.mp4",
    displayName: "视频提取音频",
    displayNameEn: "Extract Audio from Video",
    description: "上传带音轨的视频，一键提取为 MP3、M4A 或 WAV 音频。全程使用本地媒体处理，不消耗模型积分。",
    descriptionEn: "Upload a video with audio and extract it as MP3, M4A, or WAV. Local media processing only, with no model credits consumed.",
    sellCredits: 0,
    uiSchema: localAudioExtractionWorkflowMock,
  },
  {
    skuId: "ONE_PROMPT_30S_VIDEO",
    providerCode: "VIDEO_ORCHESTRATOR",
    category: "video",
    cover: "/covers/animated-cover.webp",
    coverVideo: "/covers/animated-cover-motion.mp4",
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
    coverVideo: "/covers/video-enhance-motion.mp4",
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
    coverVideo: "/covers/image-to-video-motion.mp4",
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
    coverVideo: "/covers/kling-standard-motion.mp4",
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
    coverVideo: "/covers/dance-motion-transfer-motion.mp4",
    displayName: "模仿生成舞蹈视频",
    displayNameEn: "Dance Motion Transfer",
    description:
      "上传人物图片和舞蹈参考视频，将视频中的动作与表情迁移到图片人物上。使用阿里百炼 wan2.2-animate-move，平均生成约 377 秒。",
    descriptionEn:
      "Upload a character image and dance reference video to transfer its motion and expressions with Alibaba Model Studio wan2.2-animate-move. Average generation time: about 377 seconds.",
    sellCredits: 500,
    uiSchema: bailianDanceMoveWorkflowMock,
  },
  {
    skuId: "BAILIAN_WAN27_CAMERA_REPLICATION",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/camera-movement-replication-animated.webp",
    coverVideo: "/covers/camera-movement-replication-motion.mp4",
    displayName: "运镜复刻",
    displayNameEn: "Camera Movement Replication",
    description:
      "上传参考运镜视频和目标画面参考图，智能复刻推拉、环绕、升降、跟拍等镜头运动，让目标画面延续参考视频的运镜节奏与表现力。",
    descriptionEn:
      "Upload a camera-movement reference video and target scene images to recreate dolly, orbit, crane, tracking, and other camera motion while preserving the reference pacing and visual energy.",
    sellCredits: 750,
    uiSchema: bailianCameraReplicationWorkflowMock,
  },
  {
    skuId: "BAILIAN_WAN27_EFFECT_REPLICATION",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/effect-replication-animated.webp",
    coverVideo: "/covers/effect-replication-motion.mp4",
    displayName: "特效复刻",
    displayNameEn: "Effect Replication",
    description:
      "上传特效参考视频和目标人物图片，将火焰、变身、粒子等视觉效果迁移到目标人物，并尽量保留人物主体特征与整体画面风格。",
    descriptionEn:
      "Upload an effect reference video and a target character image to transfer fire, transformation, particles, and other visual effects while preserving the character and overall visual style.",
    sellCredits: 750,
    uiSchema: bailianEffectReplicationWorkflowMock,
  },
  {
    skuId: "BAILIAN_WAN22_S2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/talking-character-video-animated.webp",
    coverVideo: "/covers/talking-character-video-motion.mp4",
    displayName: "有声视频",
    displayNameEn: "Talking Character Video",
    description:
      "支持自然口播、提示词手势和精准动作三种模式。可选择阿里云音色或上传现成录音，并用 Wan2.7、Animate Move 与 VideoRetalk 生成口型和动作同步的视频。",
    descriptionEn:
      "Choose natural speech, prompted gestures, or precise reference motion. Use an Alibaba Cloud voice or an existing recording with Wan 2.7, Animate Move, and VideoRetalk.",
    sellCredits: 625,
    uiSchema: bailianWan22S2vWorkflowMock,
  },
  {
    skuId: "BAILIAN_VOICE_CLONE",
    providerCode: "ALIYUN_BAILIAN_VOICE_CLONE",
    category: "video",
    cover: "/covers/voice-cloning-animated.webp",
    coverVideo: "/covers/voice-cloning-motion.mp4",
    displayName: "声音克隆",
    displayNameEn: "Voice Cloning",
    description:
      "上传 5～20 秒清晰录音，复刻音色并将指定文本合成为试听音频。仅可使用本人声音或已获得明确授权的声音。",
    descriptionEn:
      "Upload 5–20 seconds of clear speech, clone its timbre, and synthesize a preview from your text. Use only voices you are authorized to use.",
    sellCredits: 20,
    uiSchema: bailianVoiceCloneWorkflowMock,
  },
  {
    skuId: "BAILIAN_COSYVOICE_VOICE_DESIGN",
    providerCode: "ALIYUN_BAILIAN_VOICE_DESIGN",
    category: "video",
    cover: "/covers/voice-design-from-text.webp",
    coverVideo: "/covers/voice-design-from-text-motion.mp4",
    displayName: "文字设计新音色",
    displayNameEn: "Design a New Voice from Text",
    description:
      "无需真人录音，只需描述年龄、气质与声音质感，即可生成带试听音频和专属音色 ID 的全新品牌声音。",
    descriptionEn:
      "Create a new reusable brand voice and audio preview by describing its age, personality, and vocal texture—no recording required.",
    sellCredits: 0,
    uiSchema: bailianVoiceDesignWorkflowMock,
  },
  {
    skuId: "BAILIAN_EMOTIONAL_TTS",
    providerCode: "ALIYUN_BAILIAN_EMOTIONAL_TTS",
    category: "video",
    cover: "/covers/expressive-voiceover.webp",
    coverVideo: "/covers/expressive-voiceover-motion.mp4",
    displayName: "情绪化配音",
    displayNameEn: "Expressive Voiceover",
    description:
      "控制开心、悲伤、愤怒、耳语、激动和冷静等情绪，并调节语速与音量，快速生成适合短剧对白的高表现力配音。",
    descriptionEn:
      "Generate expressive short-drama voiceover with happy, sad, angry, whispering, excited, or calm delivery plus adjustable speed and volume.",
    sellCredits: 1,
    uiSchema: bailianEmotionalTtsWorkflowMock,
  },
  {
    skuId: "BAILIAN_HAPPYHORSE_VIDEO_EDIT",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/local-video-edit.webp",
    coverVideo: "/covers/local-video-edit-motion.mp4",
    displayName: "局部修改",
    displayNameEn: "Local Video Edit",
    description:
      "用自然语言修改视频中的局部内容，例如衣服变色、删除路人或替换产品；可选上传参考图来指定替换目标。",
    descriptionEn:
      "Edit local elements in a video with natural-language instructions, such as recoloring clothing, removing passers-by, or replacing a product. Optional reference images can guide replacements.",
    sellCredits: 225,
    uiSchema: bailianHappyHorseVideoEditWorkflowMock,
  },
  {
    skuId: "BAILIAN_SCENE_LIGHT_VIDEO_EDIT",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/scene-light-transform.webp",
    coverVideo: "/covers/scene-light-transform-motion.mp4",
    displayName: "场景与光影变换",
    displayNameEn: "Scene & Lighting Transform",
    description:
      "改变视频的时间、天气、光线与背景环境，例如白天变夜景、晴天变雨天或背景换成森林，同时尽量保持主体与镜头运动一致。",
    descriptionEn:
      "Transform the time of day, weather, lighting, or environment in a video while preserving its subjects and camera motion.",
    sellCredits: 225,
    uiSchema: bailianSceneLightVideoEditWorkflowMock,
  },
  {
    skuId: "BAILIAN_OVERALL_STYLE_TRANSFER",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/overall-style-transfer.webp",
    coverVideo: "/covers/overall-style-transfer-motion.mp4",
    displayName: "整体风格迁移",
    displayNameEn: "Overall Style Transfer",
    description:
      "将整段视频统一转换为动画、国风、黏土、水彩或赛博朋克等视觉风格，同时尽量保持主体、动作与镜头连续性。",
    descriptionEn:
      "Transform an entire video into animation, Chinese art, clay, watercolor, cyberpunk, or another cohesive visual style while preserving subjects, motion, and camera continuity.",
    sellCredits: 225,
    uiSchema: bailianOverallStyleTransferWorkflowMock,
  },
  {
    skuId: "BAILIAN_HIGH_DYNAMIC_REDRAW",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/high-motion-redraw.webp",
    coverVideo: "/covers/high-motion-redraw-motion.mp4",
    displayName: "高动态重绘",
    displayNameEn: "High-Motion Restyle",
    description:
      "改变视频整体风格，同时尽量保留高速动作、复杂运动轨迹和原有镜头语言，适合动态丰富的素材重绘。",
    descriptionEn:
      "Restyle a video while preserving fast action, complex motion trajectories, and the original camera language as closely as possible.",
    sellCredits: 300,
    uiSchema: bailianHighDynamicRedrawWorkflowMock,
  },
  {
    skuId: "BAILIAN_WANX_I2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/multimodal-image-to-video.webp",
    coverVideo: "/covers/multimodal-image-to-video-motion.mp4",
    displayName: "多模态图生视频",
    displayNameEn: "Multimodal Image-to-Video",
    description:
      "上传一张参考图，用文字描述您想要的动作或场景，AI 将为您生成流畅生动的动画视频。支持多种最新模型自选。计费规则：250积分/秒，动态扣除。",
    descriptionEn:
      "Upload a reference image, describe the desired action or scene, and AI generates a smooth animated video. Multiple cutting-edge models available. Billing: 250 credits/sec, charged dynamically.",
    sellCredits: 1250,
    uiSchema: bailianWanxI2vWorkflowMock,
  },
  {
    skuId: "BAILIAN_WAN27_VIDEO_CONTINUATION",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/video-continuation.webp",
    coverVideo: "/covers/video-continuation-motion.mp4",
    displayName: "视频续写",
    displayNameEn: "Video Continuation",
    description:
      "上传一段视频，从结尾自然延伸后续内容；可选择自由续写、指定后续剧情与运镜，或上传目标尾帧控制结束画面，最终成片最长 15 秒。",
    descriptionEn:
      "Upload a clip and extend it naturally from the ending. Choose free continuation, direct the next action and camera movement, or provide a target last frame, with up to 15 seconds total output.",
    sellCredits: 1800,
    uiSchema: bailianVideoContinuationWorkflowMock,
  },
  {
    skuId: "BAILIAN_MULTI_REF_I2V",
    providerCode: "ALIYUN_BAILIAN",
    category: "video",
    cover: "/covers/multi-reference-drama.webp",
    coverVideo: "/covers/multi-reference-drama-motion.mp4",
    displayName: "多参考图剧场生成",
    displayNameEn: "Multi-Reference Drama",
    description:
      "HappyHorse 1.1 最多支持 9 张参考图，通义万相 2.7 最多支持 5 张；支持分别填写正向与负向提示词。计费规则：动态秒数计费。",
    descriptionEn:
      "HappyHorse 1.1 supports up to 9 reference images and Wan 2.7 supports up to 5, with separate positive and negative prompt inputs. Billed dynamically by duration.",
    sellCredits: 1250,
    uiSchema: bailianMultiRefWorkflowMock,
  },
  {
    skuId: "RH_SVD_IMG2VID",
    providerCode: "RUNNINGHUB_SVD",
    category: "video",
    cover: "/covers/first-last-frame.webp",
    coverVideo: "/covers/first-last-frame-motion.mp4",
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
