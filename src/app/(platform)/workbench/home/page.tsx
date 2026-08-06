"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, AudioLines, Box, Clapperboard, ImageIcon, Play, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/i18n";
import { HomeShowcaseCarousel } from "@/components/home/HomeShowcaseCarousel";
import { PopularWorksShowcase } from "@/components/home/PopularWorksShowcase";

type HomeTool = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  cover: string;
  motion: string;
  alternateCover?: string;
  alternateMotion?: string;
};

type CapabilitySection = {
  navLabel: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  glow: string;
  highlights?: string[];
  tools: HomeTool[];
};

const CAPABILITY_SECTIONS_ZH: CapabilitySection[] = [
  {
    navLabel: "动态影像",
    title: "让画面，开始讲故事",
    description: "从参考图到完整镜头，把角色、运镜、特效与后期重绘汇入同一条影像生产链。",
    href: "/workbench/tools?category=video",
    icon: Clapperboard,
    accent: "text-cyan-300",
    glow: "bg-cyan-400/[0.13]",
    tools: [
      { eyebrow: "多角色叙事", title: "多参考图剧场生成", description: "最多引用 9 张人物与场景图，生成角色一致、叙事连贯的微短剧片段。", href: "/workbench/tools?sku=BAILIAN_MULTI_REF_I2V", cover: "/covers/multi-reference-drama.webp", motion: "/covers/multi-reference-drama-motion.mp4" },
      { eyebrow: "镜头语言", title: "运镜复刻", description: "把推拉、环绕、升降与跟拍节奏迁移到目标画面。", href: "/workbench/tools?sku=BAILIAN_WAN27_CAMERA_REPLICATION", cover: "/covers/camera-movement-replication.webp", motion: "/covers/camera-movement-replication-motion.mp4" },
      { eyebrow: "风格重塑", title: "风格迁移", description: "迁移参考视频的整体视觉风格，同时保留主体、动作与镜头语言。", href: "/workbench/tools?sku=BAILIAN_OVERALL_STYLE_TRANSFER", cover: "/covers/overall-style-transfer.webp", motion: "/covers/overall-style-transfer-motion.mp4" },
      { eyebrow: "风格重塑", title: "高动态重绘", description: "改变视觉风格，并尽量保留高速动作与原有镜头语言。", href: "/workbench/tools?sku=BAILIAN_HIGH_DYNAMIC_REDRAW", cover: "/covers/high-motion-redraw.webp", motion: "/covers/high-motion-redraw-motion.mp4" },
    ],
  },
  {
    navLabel: "声音与角色",
    title: "让声音，拥有自己的角色",
    description: "从音色设计、声音克隆到情绪化表达和数字人演绎，完成声音驱动的内容生产。",
    href: "/workbench/tools?group=audio-post",
    icon: AudioLines,
    accent: "text-emerald-300",
    glow: "bg-emerald-400/[0.12]",
    tools: [
      { eyebrow: "声音驱动角色", title: "有声视频", description: "自然口播、提示词手势和精准动作三档可选，支持阿里云音色与现成录音。", href: "/workbench/tools?sku=BAILIAN_WAN22_S2V", cover: "/covers/talking-character-video.webp", motion: "/covers/talking-character-video-motion.mp4" },
      { eyebrow: "专属音色", title: "声音克隆", description: "用一段清晰录音复刻音色，并快速合成指定文本。", href: "/workbench/tools?sku=BAILIAN_VOICE_CLONE", cover: "/covers/voice-cloning-animated.webp", motion: "/covers/voice-cloning-motion.mp4" },
      { eyebrow: "品牌声线", title: "文字设计新音色", description: "描述年龄、气质和质感，创造可复用的新声音。", href: "/workbench/tools?sku=BAILIAN_COSYVOICE_VOICE_DESIGN", cover: "/covers/voice-design-from-text.webp", motion: "/covers/voice-design-from-text-motion.mp4" },
      { eyebrow: "情绪表达", title: "情绪化配音", description: "控制开心、悲伤、愤怒、耳语等情绪与语速。", href: "/workbench/tools?sku=BAILIAN_EMOTIONAL_TTS", cover: "/covers/expressive-voiceover.webp", motion: "/covers/expressive-voiceover-motion.mp4" },
    ],
  },
  {
    navLabel: "三维造物",
    title: "从平面灵感，到可用的三维资产",
    description: "通过文字、单图或多视角参考生成 3D 模型，并控制贴图、PBR 材质与几何精度。",
    href: "/workbench/tools?category=model",
    icon: Box,
    accent: "text-violet-300",
    glow: "bg-violet-500/[0.16]",
    highlights: ["文生 3D", "单图生 3D", "多视角生 3D", "PBR 材质", "高精度几何"],
    tools: [
      { eyebrow: "Tripo P1.0 / H3.1", title: "Tripo 3D 模型生成", description: "兼顾快速原型与高精度输出，为角色、商品和场景快速建立可交付的三维资产。", href: "/workbench/tools?sku=BAILIAN_TRIPO_3D", cover: "/covers/tripo-3d.webp", motion: "/covers/tripo-3d-motion.mp4", alternateCover: "/covers/tripo-3d-showcase-poster.webp", alternateMotion: "/covers/tripo-3d-showcase.mp4" },
    ],
  },
  {
    navLabel: "视觉创意",
    title: "把灵感，变成完整视觉",
    description: "覆盖图片生成、背景重构、人像抠图与高清放大，让创意从概念走向可用素材。",
    href: "/workbench/tools?category=image",
    icon: ImageIcon,
    accent: "text-amber-300",
    glow: "bg-amber-400/[0.12]",
    tools: [
      { eyebrow: "创意生成", title: "智能图片生成", description: "结合提示词与参考图，生成多比例、高质量的完整视觉。", href: "/workbench/tools?sku=GPT_IMAGE2_REF", cover: "/covers/ai-image-generation.webp", motion: "/covers/ai-image-generation-motion.mp4" },
      { eyebrow: "场景重构", title: "背景替换", description: "自动分离主体，并自然融合到新的目标场景。", href: "/workbench/tools?sku=RH_BG_REPLACE", cover: "/covers/background-replace.webp", motion: "/covers/background-replace-motion.mp4" },
      { eyebrow: "智能分离", title: "人像抠图", description: "用自然语言完成抠图、换背景与干扰元素移除。", href: "/workbench/tools?sku=RH_MATTING", cover: "/covers/portrait-cutout.webp", motion: "/covers/portrait-cutout-motion.mp4" },
      { eyebrow: "细节增强", title: "高清放大", description: "增强画面细节与清晰度，支持从 1K 到 8K 输出。", href: "/workbench/tools?sku=RH_HD_UPSCALE", cover: "/covers/hd-upscale.webp", motion: "/covers/hd-upscale-motion.mp4" },
    ],
  },
];

const CAPABILITY_SECTIONS_EN: CapabilitySection[] = [
  {
    ...CAPABILITY_SECTIONS_ZH[0], navLabel: "Moving Image", title: "Let every frame tell a story", description: "Bring characters, camera language, effects, and AI post-production into one visual pipeline.",
    tools: [
      { ...CAPABILITY_SECTIONS_ZH[0].tools[0], eyebrow: "Multi-character stories", title: "Multi-reference drama", description: "Reference up to nine characters and scenes to create coherent micro-drama clips." },
      { ...CAPABILITY_SECTIONS_ZH[0].tools[1], eyebrow: "Camera language", title: "Camera replication", description: "Transfer dolly, orbit, crane, and tracking motion to a target scene." },
      { ...CAPABILITY_SECTIONS_ZH[0].tools[2], eyebrow: "Visual restyling", title: "Style transfer", description: "Transfer the reference video's visual style while preserving subject, motion, and camera language." },
      { ...CAPABILITY_SECTIONS_ZH[0].tools[3], eyebrow: "Visual restyling", title: "High-motion redraw", description: "Restyle footage while retaining fast action and original camera language." },
    ],
  },
  {
    ...CAPABILITY_SECTIONS_ZH[1], navLabel: "Voice & Characters", title: "Give every voice a character", description: "Design, clone, direct, and perform with a complete voice-driven content toolkit.",
    tools: [
      { ...CAPABILITY_SECTIONS_ZH[1].tools[0], eyebrow: "Voice-driven character", title: "Talking character video", description: "Turn one portrait and a voice track into a naturally synchronized performance." },
      { ...CAPABILITY_SECTIONS_ZH[1].tools[1], eyebrow: "Signature timbre", title: "Voice cloning", description: "Clone an authorized voice from a clear recording and synthesize new lines." },
      { ...CAPABILITY_SECTIONS_ZH[1].tools[2], eyebrow: "Brand voice", title: "Voice design from text", description: "Create a reusable voice by describing age, personality, and texture." },
      { ...CAPABILITY_SECTIONS_ZH[1].tools[3], eyebrow: "Emotional delivery", title: "Expressive voiceover", description: "Direct emotion, pace, and volume for more convincing performances." },
    ],
  },
  {
    ...CAPABILITY_SECTIONS_ZH[2], navLabel: "3D Creation", title: "From flat inspiration to production-ready 3D", description: "Generate 3D from text, one image, or multiple views with control over texture, PBR, and geometry.", highlights: ["Text to 3D", "Image to 3D", "Multi-view to 3D", "PBR materials", "High-detail geometry"],
    tools: [{ ...CAPABILITY_SECTIONS_ZH[2].tools[0], eyebrow: "Tripo P1.0 / H3.1", title: "Tripo 3D model generation", description: "Move from rapid prototypes to detailed, deliverable assets for characters, products, and scenes." }],
  },
  {
    ...CAPABILITY_SECTIONS_ZH[3], navLabel: "Visual Design", title: "Turn inspiration into complete visuals", description: "Generate, reconstruct, isolate, and upscale images from concept to usable production assets.",
    tools: [
      { ...CAPABILITY_SECTIONS_ZH[3].tools[0], eyebrow: "Creative generation", title: "AI image generation", description: "Combine prompts and references to create high-quality visuals in multiple ratios." },
      { ...CAPABILITY_SECTIONS_ZH[3].tools[1], eyebrow: "Scene reconstruction", title: "Background replacement", description: "Separate the subject and blend it naturally into a new target scene." },
      { ...CAPABILITY_SECTIONS_ZH[3].tools[2], eyebrow: "Smart isolation", title: "Portrait cutout", description: "Use natural language to cut out subjects and remove visual distractions." },
      { ...CAPABILITY_SECTIONS_ZH[3].tools[3], eyebrow: "Detail enhancement", title: "HD upscaling", description: "Enhance detail and clarity with output options from 1K to 8K." },
    ],
  },
];

type FeaturedModel = {
  name: string;
  family: string;
  description: string;
  href: string;
  poster: string;
  motion: string;
};

const FEATURED_MODELS_ZH: FeaturedModel[] = [
  { name: "Wan 2.7", family: "视频生成", description: "覆盖图生视频、运镜复刻、特效复刻与视频续写", href: "/workbench/tools?category=video", poster: "/model-showcase/wan-27.webp", motion: "/model-showcase/wan-27-motion.mp4?v=2" },
  { name: "Wan 2.2 S2V", family: "声音驱动视频", description: "由人声驱动角色口型、表情与动作自然同步", href: "/workbench/tools?sku=BAILIAN_WAN22_S2V", poster: "/model-showcase/wan-22-s2v.webp", motion: "/model-showcase/wan-22-s2v-motion.mp4?v=2" },
  { name: "Kling Cinema", family: "电影级影像", description: "从单张参考图快速生成连贯、富有表现力的镜头", href: "/workbench/tools?sku=KLING_CINEMA_PRO", poster: "/model-showcase/kling-cinema.webp", motion: "/model-showcase/kling-cinema-motion.mp4?v=2" },
  { name: "GPT Image 2", family: "图像生成", description: "结合自然语言与参考图生成高质量完整视觉", href: "/workbench/tools?sku=GPT_IMAGE2_REF", poster: "/model-showcase/gpt-image-2.webp", motion: "/model-showcase/gpt-image-2-motion.mp4?v=2" },
  { name: "Qwen3-VL", family: "视觉理解", description: "理解画面中的主体、场景、风格与光线并反推提示词", href: "/workbench/tools?sku=RH_PROMPT_REVERSE", poster: "/model-showcase/qwen3-vl.webp", motion: "/model-showcase/qwen3-vl-motion.mp4?v=2" },
  { name: "CosyVoice", family: "语音生成", description: "完成音色设计、声音克隆与富有情绪的语音表达", href: "/workbench/tools?sku=BAILIAN_COSYVOICE_VOICE_DESIGN", poster: "/model-showcase/cosyvoice.webp", motion: "/model-showcase/cosyvoice-motion.mp4?v=2" },
  { name: "Tripo 3D", family: "三维生成", description: "从文字、单图或多视角参考创建带材质的 3D 资产", href: "/workbench/tools?sku=BAILIAN_TRIPO_3D", poster: "/model-showcase/tripo-3d.webp", motion: "/model-showcase/tripo-3d-motion.mp4?v=2" },
  { name: "RunningHub", family: "工作流引擎", description: "连接复杂节点工作流，为图像与视频工具提供稳定执行能力", href: "/workbench/tools?group=video-editing", poster: "/model-showcase/runninghub-workflow.webp", motion: "/model-showcase/runninghub-workflow-motion.mp4?v=2" },
];

const FEATURED_MODELS_EN: FeaturedModel[] = [
  { ...FEATURED_MODELS_ZH[0], family: "Video generation", description: "Image-to-video, camera replication, effect transfer, and continuation" },
  { ...FEATURED_MODELS_ZH[1], family: "Speech-to-video", description: "Synchronize character lips, expressions, and motion from a voice track" },
  { ...FEATURED_MODELS_ZH[2], family: "Cinematic motion", description: "Turn one reference image into a coherent, expressive moving shot" },
  { ...FEATURED_MODELS_ZH[3], family: "Image generation", description: "Create polished visuals from natural language and visual references" },
  { ...FEATURED_MODELS_ZH[4], family: "Visual understanding", description: "Read subjects, scenes, styles, and light to reconstruct useful prompts" },
  { ...FEATURED_MODELS_ZH[5], family: "Voice generation", description: "Design, clone, and direct expressive voices for production" },
  { ...FEATURED_MODELS_ZH[6], family: "3D generation", description: "Build textured 3D assets from text, one image, or multiple views" },
  { ...FEATURED_MODELS_ZH[7], family: "Workflow engine", description: "Run production-grade image and video node workflows reliably" },
];

export default function WorkbenchHomePage() {
  const { locale } = useLanguage();
  const isEn = locale === "en";
  const capabilitySections = isEn ? CAPABILITY_SECTIONS_EN : CAPABILITY_SECTIONS_ZH;
  const [featuredToolIndexes, setFeaturedToolIndexes] = useState<number[]>(() => CAPABILITY_SECTIONS_ZH.map(() => 0));
  const [singleToolMotionIndexes, setSingleToolMotionIndexes] = useState<number[]>(() => CAPABILITY_SECTIONS_ZH.map(() => 0));

  const advanceFeaturedTool = (sectionIndex: number, toolCount: number) => {
    if (toolCount <= 1) return;
    setFeaturedToolIndexes((current) => current.map((value, index) => index === sectionIndex ? (value + 1) % toolCount : value));
  };
  const featuredModels = isEn ? FEATURED_MODELS_EN : FEATURED_MODELS_ZH;

  return (
    <div className="workbench-home min-h-full overflow-hidden bg-[#05080d] text-slate-200">
      <section className="relative px-3 pb-3 pt-3 sm:px-5 sm:pb-5 lg:px-7">
        <HomeShowcaseCarousel />
      </section>

      <PopularWorksShowcase isEn={isEn} />

      <section className="relative mx-auto max-w-[1500px] px-6 pb-12 pt-24 lg:px-10 lg:pb-16 lg:pt-32">
        <div className="grid gap-8 border-t border-white/[0.12] pt-6 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9ef5d8]">02 / {isEn ? "Creative capabilities" : "创作能力"}</div>
            <h2 className="home-display-title max-w-4xl whitespace-pre-line text-[clamp(2.8rem,5vw,5.5rem)]">
              {isEn ? "Four creative worlds. One intelligent studio." : "四种创作维度，\n一座智能工作台。"}
            </h2>
          </div>
          <p className="whitespace-pre-line text-sm leading-7 text-white/45 md:col-span-4 md:pb-2">
            {isEn ? "Explore moving image, voice, 3D, and visual design through focused creative systems built from your existing tools." : "从视频、音频、3D 到图片，\n按创作目标进入清晰、完整的专业能力体系。"}
          </p>
        </div>
      </section>

      {capabilitySections.map((section, sectionIndex) => {
        const SectionIcon = section.icon;
        const isSingleTool = section.tools.length === 1;
        const featuredToolIndex = (featuredToolIndexes[sectionIndex] ?? 0) % section.tools.length;
        const orderedTools = isSingleTool
          ? section.tools
          : [section.tools[featuredToolIndex], ...section.tools.filter((_, index) => index !== featuredToolIndex)];
        return (
          <section key={section.navLabel} className="relative mx-auto max-w-[1500px] px-6 py-16 lg:px-10 lg:py-24">
            <div className={`pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full ${section.glow} blur-[110px]`} />
            <div className="relative mb-10 grid gap-6 border-t border-white/[0.1] pt-6 md:grid-cols-12 md:items-end lg:mb-14">
              <div className="md:col-span-8">
                <div className={`mb-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.25em] ${section.accent}`}>
                  <span>02.{sectionIndex + 1}</span><span className="h-px w-10 bg-current opacity-45" /><SectionIcon className="h-4 w-4" /><span>{section.navLabel}</span>
                </div>
                <h2 className="home-section-title max-w-4xl text-[clamp(2rem,3.2vw,3.65rem)]">{section.title}</h2>
              </div>
              <div className="md:col-span-4 md:pb-1">
                <Link href={section.href} className={`inline-flex items-center gap-2 text-xs font-semibold ${section.accent} transition hover:text-white`}>
                  {isEn ? `Explore ${section.navLabel}` : `查看全部${section.navLabel}工具`}<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <div className={`relative grid gap-4 ${isSingleTool ? "" : "lg:grid-cols-12 lg:grid-rows-3"}`}>
              {orderedTools.map((tool, displayIndex) => {
                const isFeatured = displayIndex === 0;
                const toolIndex = section.tools.indexOf(tool);
                const motionSources = tool.alternateMotion ? [tool.motion, tool.alternateMotion] : [tool.motion];
                const coverSources = tool.alternateCover ? [tool.cover, tool.alternateCover] : [tool.cover];
                const activeMotionIndex = isSingleTool ? (singleToolMotionIndexes[sectionIndex] ?? 0) % motionSources.length : 0;
                const activeMotion = motionSources[activeMotionIndex];
                const activeCover = coverSources[activeMotionIndex] ?? tool.cover;
                return (
                  <Link
                    key={`${section.navLabel}-${tool.title}-${isFeatured ? "featured" : "secondary"}`}
                    href={tool.href}
                    className={`home-capability-card group relative overflow-hidden rounded-[1.5rem] border border-white/[0.12] bg-[#09111a] shadow-[0_18px_60px_rgba(0,0,0,.28)] ${isFeatured ? "home-capability-swap" : ""} ${isSingleTool ? "aspect-video min-h-[420px] sm:min-h-0" : isFeatured ? "min-h-[500px] lg:col-span-7 lg:row-span-3 lg:min-h-[650px]" : "min-h-[220px] lg:col-span-5"}`}
                  >
                    <video
                      key={activeMotion}
                      className={`absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:opacity-100 ${isSingleTool ? "opacity-[.94] brightness-[.88] contrast-[1.08] saturate-[1.08]" : isFeatured ? "opacity-[.9] brightness-[1.08] contrast-[1.08] saturate-[1.18] group-hover:scale-[1.035] group-hover:saturate-[1.28]" : "opacity-90 brightness-[1.07] contrast-[1.07] saturate-[1.14] group-hover:scale-[1.04]"}`}
                      autoPlay muted loop={!isFeatured || (isSingleTool && motionSources.length === 1)} playsInline preload="metadata" poster={activeCover} aria-hidden="true"
                      onEnded={isSingleTool && motionSources.length > 1
                        ? () => setSingleToolMotionIndexes((current) => current.map((value, index) => index === sectionIndex ? (value + 1) % motionSources.length : value))
                        : isFeatured ? () => advanceFeaturedTool(sectionIndex, section.tools.length) : undefined}
                    >
                      <source src={activeMotion} type="video/mp4" />
                    </video>
                    <div className={`absolute inset-0 ${isSingleTool ? "bg-[linear-gradient(90deg,rgba(3,7,12,.96)_0%,rgba(3,7,12,.82)_28%,rgba(3,7,12,.42)_52%,rgba(3,7,12,.06)_76%),linear-gradient(0deg,rgba(3,7,12,.88)_0%,rgba(3,7,12,.24)_48%,rgba(3,7,12,.1)_100%)]" : "bg-[linear-gradient(0deg,rgba(3,7,12,.92)_0%,rgba(3,7,12,.44)_48%,rgba(3,7,12,.04)_82%)]"}`} />
                    {isSingleTool && motionSources.length > 1 ? (
                      <div className="absolute right-5 top-5 z-10 flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-black/25 px-2.5 py-2 backdrop-blur-md" aria-hidden="true">
                        {motionSources.map((motion, motionIndex) => <span key={motion} className={`h-1 rounded-full transition-all duration-500 ${motionIndex === activeMotionIndex ? "w-7 bg-violet-300" : "w-3 bg-white/25"}`} />)}
                      </div>
                    ) : null}
                    <div className={`home-capability-copy absolute inset-x-0 bottom-0 ${isSingleTool ? "max-w-2xl p-7 sm:p-10 lg:p-14" : isFeatured ? "p-7 sm:p-10" : "p-6"}`}>
                      <div className={`mb-4 text-[10px] font-semibold uppercase tracking-[0.22em] ${section.accent}`}>{String(toolIndex + 1).padStart(2, "0")} / {tool.eyebrow}</div>
                      <h3 className={`home-capability-title font-medium tracking-[-0.035em] ${isSingleTool ? "text-3xl sm:text-5xl" : isFeatured ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl"}`}>{tool.title}</h3>
                      <div className="mt-3 flex items-end justify-between gap-5">
                        <p className={`home-capability-description leading-6 ${isSingleTool || isFeatured ? "max-w-xl text-sm sm:text-base" : "max-w-md text-xs sm:text-sm"}`}>{tool.description}</p>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/[0.85] backdrop-blur transition group-hover:border-white/40 group-hover:bg-white group-hover:text-[#071019]"><ArrowRight className="h-4 w-4" /></span>
                      </div>
                      {isSingleTool && section.highlights ? (
                        <div className="mt-7 flex flex-wrap gap-2">
                          {section.highlights.map((highlight) => <span key={highlight} className="rounded-full border border-white/[0.14] bg-black/25 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur">{highlight}</span>)}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="relative mx-auto max-w-[1500px] px-6 py-20 lg:px-10 lg:py-28">
        <div className="pointer-events-none absolute right-0 top-16 h-80 w-80 rounded-full bg-[#9ef5d8]/[0.07] blur-[120px]" />
        <div className="relative grid gap-3 lg:grid-cols-12">
          <div className="relative flex min-h-[440px] flex-col justify-between overflow-hidden rounded-[1.5rem] border border-[#9ef5d8]/[0.16] bg-[linear-gradient(145deg,#0d1820_0%,#091017_52%,#05090e_100%)] p-7 text-white shadow-[inset_0_1px_0_rgba(255,255,255,.055),0_28px_80px_rgba(0,0,0,.28)] sm:p-9 lg:col-span-4 lg:row-span-2 lg:min-h-[520px]">
            <div className="pointer-events-none absolute -left-24 -top-28 h-72 w-72 rounded-full bg-[#9ef5d8]/[0.11] blur-[90px]" />
            <div className="pointer-events-none absolute inset-x-9 top-0 h-px bg-gradient-to-r from-transparent via-[#9ef5d8]/50 to-transparent" />
            <div className="pointer-events-none absolute bottom-0 right-0 h-48 w-48 bg-[radial-gradient(circle_at_bottom_right,rgba(103,232,249,.08),transparent_68%)]" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#9ef5d8]/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9ef5d8] shadow-[0_0_12px_rgba(158,245,216,.8)]" />
                HERONHUB / MODEL ROUTER
              </div>
              <h3 className="mt-7 max-w-sm text-[clamp(2.4rem,4vw,4.8rem)] font-black leading-[0.96] tracking-[-0.055em]">
                {isEn ? "Selected model APIs" : "精选模型 API"}
              </h3>
              <p className="mt-6 max-w-sm text-sm leading-7 text-white/50">
                {isEn ? "One consistent creative experience, backed by specialized intelligence for every medium." : "以统一的创作体验，调度不同媒介中各有所长的专业模型。"}
              </p>
            </div>
            <div className="relative z-10">
              <div className="mb-6 flex flex-wrap gap-2">
                {["VIDEO", "IMAGE", "VOICE", "VISION", "3D"].map((label) => <span key={label} className="rounded-full border border-white/[0.11] bg-white/[0.035] px-3 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,.035)]">{label}</span>)}
              </div>
            </div>
          </div>

          {featuredModels.map((model, modelIndex) => (
            <div
              key={model.name}
              className={`relative min-h-[245px] overflow-hidden rounded-[1.35rem] border border-white/[0.12] bg-[#0a0e13] ${modelIndex < 4 ? "lg:col-span-4" : "lg:col-span-3 lg:min-h-[230px]"}`}
            >
              <video className="absolute inset-0 h-full w-full object-cover opacity-90 saturate-[0.92]" autoPlay muted loop playsInline preload="metadata" poster={model.poster} aria-hidden="true">
                <source src={model.motion} type="video/mp4" />
              </video>
              <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(3,6,10,.94)_0%,rgba(3,6,10,.34)_52%,rgba(3,6,10,.04)_82%)]" />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between p-5">
                <span className="rounded-full border border-white/15 bg-black/20 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/70 backdrop-blur-md">{model.family}</span>
                <span className="text-[9px] font-medium tracking-[0.18em] text-white/45">API</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
                <h3 className="text-2xl font-medium tracking-[-0.04em] text-white sm:text-3xl">{model.name}</h3>
                <div className="mt-2">
                  <p className="max-w-sm text-xs leading-5 text-white/55">{model.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="px-3 pb-3 sm:px-5 sm:pb-5 lg:px-7">
        <div className="relative mx-auto min-h-[560px] max-w-[1600px] overflow-hidden rounded-[2rem] border border-white/[0.1] bg-[#0a1018]">
          <video className="absolute inset-0 h-full w-full object-cover opacity-50" autoPlay muted loop playsInline preload="metadata" poster="/covers/kling-standard.webp" aria-hidden="true">
            <source src="/covers/kling-standard-motion.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(4,8,13,.96),rgba(4,8,13,.68)_48%,rgba(4,8,13,.12)),linear-gradient(0deg,rgba(4,8,13,.82),transparent_60%)]" />
          <div className="relative flex min-h-[560px] max-w-4xl flex-col justify-end p-7 sm:p-12 lg:p-16">
            <div className="mb-6 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9ef5d8]">04 / {isEn ? "Start creating" : "开始创作"}</div>
            <h2 className="home-display-title whitespace-pre-line text-[clamp(3.2rem,6vw,6.8rem)]">{isEn ? "Make the next frame unforgettable." : "让下一帧，\n值得被看见。"}</h2>
            <p className="mt-7 max-w-xl whitespace-pre-line text-sm leading-7 text-white/55 sm:text-base">{isEn ? "Bring the idea. HeronHub handles the models, workflow, assets, and delivery." : "你只需要带来想法。\n模型调度、生产流程、素材沉淀与最终交付，都交给 HeronHub。"}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/workbench/tools" className="inline-flex h-12 items-center gap-3 rounded-full bg-white px-6 text-sm font-semibold text-[#071019] transition hover:bg-[#9ef5d8]"><Play className="h-3.5 w-3.5 fill-current" />{isEn ? "Enter the studio" : "进入创作工作台"}<ArrowRight className="h-4 w-4" /></Link>
              <Link href="/workbench/tools?group=favorites" className="inline-flex h-12 items-center rounded-full border border-white/20 bg-black/15 px-6 text-sm font-medium text-white/70 backdrop-blur transition hover:bg-white/10 hover:text-white">{isEn ? "My favorites" : "我的收藏"}</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1500px] flex-col gap-3 px-6 py-10 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between lg:px-10"><span>© 2026 HERONHUB</span><span>{isEn ? "Built for ideas worth seeing." : "为值得被看见的创意而生。"}</span></footer>
    </div>
  );
}
