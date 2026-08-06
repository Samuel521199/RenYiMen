"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useLanguage } from "@/i18n";

type ShowcaseItem = {
  id: string;
  title: string;
  titleEn: string;
  label: string;
  labelEn: string;
  description: string;
  descriptionEn: string;
  model: string;
  video?: string;
  poster: string;
  href: string;
  durationMs: number;
};

const SHOWCASES: ShowcaseItem[] = [
  {
    id: "multimodal-video",
    title: "多模态生视频",
    titleEn: "Multimodal Video Creation",
    label: "多模态视觉生成",
    labelEn: "Multimodal Visual Generation",
    description: "上传参考图并描述动作、场景与运镜，让静态画面生成流畅自然的动态视频。",
    descriptionEn: "Upload a reference image and describe the action, scene, and camera movement to create fluid, natural video.",
    model: "WAN / I2V",
    video: "/covers/multimodal-image-to-video-motion-ai-4k.mp4",
    poster: "/covers/multimodal-image-to-video.webp",
    href: "/workbench/tools?sku=BAILIAN_WANX_I2V",
    durationMs: 5000,
  },
  {
    id: "overall-style-transfer",
    title: "整体风格迁移",
    titleEn: "Overall Style Transfer",
    label: "全局视觉重塑",
    labelEn: "Full-scene Restyling",
    description: "将整段视频统一转换为动画、国风、水彩或赛博朋克等风格，同时保持主体与动作连续。",
    descriptionEn: "Restyle an entire video while preserving its subjects, movement, and shot continuity.",
    model: "HAPPYHORSE / STYLE",
    video: "/covers/overall-style-transfer-ai-4k.mp4",
    poster: "/covers/overall-style-transfer.webp",
    href: "/workbench/tools?sku=BAILIAN_OVERALL_STYLE_TRANSFER",
    durationMs: 5000,
  },
  {
    id: "dance-video",
    title: "生成舞蹈视频",
    titleEn: "Dance Video Generation",
    label: "动作与表情迁移",
    labelEn: "Motion & Expression Transfer",
    description: "上传人物图片与舞蹈参考视频，把动作和表情自然迁移到目标角色。",
    descriptionEn: "Transfer motion and expression from a dance reference video to a target character image.",
    model: "WAN 2.2 / ANIMATE",
    video: "/covers/dance-motion-transfer-ai-4k.mp4",
    poster: "/covers/dance-motion-transfer.webp",
    href: "/workbench/tools?sku=BAILIAN_WAN22_ANIMATE_MOVE",
    durationMs: 5000,
  },
  {
    id: "high-motion-redraw",
    title: "高动态重绘",
    titleEn: "High-Motion Redraw",
    label: "高运动保真",
    labelEn: "High-motion Fidelity",
    description: "重塑视频整体风格，同时尽量保留高速动作、复杂运动轨迹和原有镜头语言。",
    descriptionEn: "Restyle footage while preserving fast action, complex trajectories, and the original camera language.",
    model: "WAN 2.7 / REDRAW",
    video: "/covers/high-motion-redraw-ai-4k.mp4",
    poster: "/covers/high-motion-redraw.webp",
    href: "/workbench/tools?sku=BAILIAN_HIGH_DYNAMIC_REDRAW",
    durationMs: 5000,
  },
  {
    id: "voice-cloning",
    title: "声音克隆",
    titleEn: "Voice Cloning",
    label: "专属音色复刻",
    labelEn: "Signature Voice Cloning",
    description: "上传一段清晰录音，复刻授权音色并将指定文本合成为自然、稳定的试听音频。",
    descriptionEn: "Clone an authorized voice from a clear recording and synthesize natural, consistent speech from text.",
    model: "QWEN AUDIO / CLONE",
    video: "/covers/voice-cloning-ai-4k.mp4",
    poster: "/covers/voice-cloning.webp",
    href: "/workbench/tools?sku=BAILIAN_VOICE_CLONE",
    durationMs: 5000,
  },
];

export function HomeShowcaseCarousel() {
  const { locale } = useLanguage();
  const isEn = locale === "en";
  const [activeIndex, setActiveIndex] = useState(0);
  const active = SHOWCASES[activeIndex];

  const move = useCallback((offset: number) => {
    setActiveIndex((current) => (current + offset + SHOWCASES.length) % SHOWCASES.length);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => move(1), active.durationMs + 350);
    return () => window.clearTimeout(timer);
  }, [active.durationMs, move]);

  return (
    <div className="home-cinema group relative mx-auto h-[clamp(620px,calc(100vh-6.5rem),880px)] w-full max-w-[1600px] overflow-hidden rounded-[2rem] bg-[#06090f] shadow-[0_34px_110px_rgba(0,0,0,.42),inset_0_1px_0_rgba(255,255,255,.025)]" aria-roledescription={isEn ? "carousel" : "轮播区域"}>
      {active.video ? (
        <video
          key={active.id}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          preload="metadata"
          poster={active.poster}
          onEnded={() => move(1)}
        >
          <source src={active.video} type="video/mp4" />
        </video>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={active.id} src={active.poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,13,.94)_0%,rgba(3,7,13,.7)_34%,rgba(3,7,13,.08)_72%),linear-gradient(0deg,rgba(3,7,13,.92)_0%,transparent_48%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_38%,transparent_0%,rgba(3,7,13,.08)_48%,rgba(3,7,13,.52)_100%)]" />
      <div className="pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-[#05080d]/80 via-[#05080d]/25 to-transparent sm:w-20" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-[#05080d]/80 via-[#05080d]/25 to-transparent sm:w-20" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#05080d]/25 to-transparent" />

      <div className="absolute left-6 right-6 top-6 flex items-center justify-end md:left-10 md:right-10 md:top-9">
        <div className="hidden text-[10px] font-medium tracking-[0.2em] text-white/45 sm:block">{active.model}</div>
      </div>

      <div className="absolute bottom-28 left-6 max-w-[760px] md:bottom-24 md:left-10 lg:left-16">
        <div className="mb-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#8fbbae]">
          <span>{String(activeIndex + 1).padStart(2, "0")}</span>
          <span className="h-px w-10 bg-[#8fbbae]/35" />
          {isEn ? active.labelEn : active.label}
        </div>
        <h1 className="home-display-title home-showcase-title max-w-[720px] text-[clamp(3.25rem,6.2vw,6.8rem)]">
          {isEn ? active.titleEn : active.title}
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-7 text-white/62 sm:text-base">
          {isEn ? active.descriptionEn : active.description}
        </p>
        <Link
          href={active.href}
          aria-label={isEn ? `Open ${active.titleEn}` : `立即使用${active.title}`}
          className="mt-8 inline-flex h-12 items-center gap-2.5 rounded-full border border-white/[0.16] bg-[#111a20]/85 px-5 text-sm font-semibold text-white/80 shadow-[0_10px_28px_rgba(0,0,0,.2),inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-md transition duration-300 hover:-translate-y-0.5 hover:border-[#9fc7bb]/35 hover:bg-[#18242a]/95 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8fbbae]/55 focus-visible:ring-offset-2 focus-visible:ring-offset-[#071019] active:translate-y-0"
        >
          <span>{isEn ? "Open tool" : "立即使用"}</span>
          <span className="h-3.5 w-px bg-white/15" aria-hidden />
          <span>{isEn ? active.titleEn : active.title}</span>
          <ArrowUpRight className="ml-0.5 h-4 w-4" />
        </Link>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" aria-hidden>
        <span className="absolute bottom-0 h-px" style={{ left: `${activeIndex * 20}%`, width: "20%" }}>
          <span
            key={`${active.id}-progress`}
            className="home-showcase-progress block h-full bg-[#9ef5d8] shadow-[0_0_10px_rgba(158,245,216,.28)]"
            style={{ animationDuration: `${active.durationMs + 350}ms` }}
          />
        </span>
      </div>

      <div className="absolute right-6 top-1/2 hidden -translate-y-1/2 flex-col gap-2 sm:flex">
        <button type="button" onClick={() => move(-1)} aria-label={isEn ? "Previous showcase" : "上一个核心功能"} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/20 text-white/65 backdrop-blur transition hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => move(1)} aria-label={isEn ? "Next showcase" : "下一个核心功能"} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/20 text-white/65 backdrop-blur transition hover:bg-white hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
