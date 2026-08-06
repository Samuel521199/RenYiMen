"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Play, X } from "lucide-react";

type PopularWork = {
  id: string;
  titleZh: string;
  titleEn: string;
  categoryZh: string;
  categoryEn: string;
  video: string;
  poster: string;
  className: string;
  mediaClassName?: string;
};

const POPULAR_WORKS: PopularWork[] = [
  {
    id: "basketball-character-lineup",
    titleZh: "球场主角团",
    titleEn: "Courtside Character Lineup",
    categoryZh: "多角色叙事",
    categoryEn: "Multi-character story",
    video: "/showcase/popular-works/basketball-character-lineup.mp4",
    poster: "/showcase/popular-works/basketball-character-lineup-poster.jpg",
    className: "col-span-2 min-h-[270px] sm:min-h-[390px] lg:order-3 lg:col-span-6 lg:min-h-[620px]",
  },
  {
    id: "face-swap-resort-hostess",
    titleZh: "海岛角色焕新",
    titleEn: "Resort Character Refresh",
    categoryZh: "角色形象重塑",
    categoryEn: "Character restyling",
    video: "/showcase/popular-works/face-swap-resort-hostess.mp4",
    poster: "/showcase/popular-works/face-swap-resort-hostess-poster.jpg",
    className: "min-h-[360px] lg:order-1 lg:col-span-3 lg:min-h-[620px]",
    mediaClassName: "object-[50%_18%]",
  },
  {
    id: "scene-light-texas-hostess",
    titleZh: "德州大厅漫游",
    titleEn: "Texas Lounge Walkthrough",
    categoryZh: "场景与光影",
    categoryEn: "Scene and lighting",
    video: "/showcase/popular-works/scene-light-texas-hostess.mp4",
    poster: "/showcase/popular-works/scene-light-texas-hostess-poster.jpg",
    className: "min-h-[360px] lg:order-2 lg:col-span-3 lg:min-h-[620px]",
  },
  {
    id: "cowboy-character-design",
    titleZh: "牛仔角色设计",
    titleEn: "Cowboy Character Design",
    categoryZh: "IP 角色设计",
    categoryEn: "IP character design",
    video: "/showcase/popular-works/cowboy-character-design.mp4",
    poster: "/showcase/popular-works/cowboy-character-design-poster.jpg",
    className: "min-h-[260px] lg:order-4 lg:col-span-4 lg:min-h-[360px]",
  },
  {
    id: "character-motion-workflow",
    titleZh: "角色动作工作流",
    titleEn: "Character Motion Workflow",
    categoryZh: "动作生成",
    categoryEn: "Motion generation",
    video: "/showcase/popular-works/character-motion-workflow.mp4",
    poster: "/showcase/popular-works/character-motion-workflow-poster.jpg",
    className: "min-h-[260px] lg:order-5 lg:col-span-3 lg:min-h-[360px]",
    mediaClassName: "object-[50%_20%]",
  },
  {
    id: "color-blitz-social",
    titleZh: "色彩闪电社交短片",
    titleEn: "Color Blitz Social Film",
    categoryZh: "30 秒成片",
    categoryEn: "30-second film",
    video: "/showcase/popular-works/color-blitz-social.mp4",
    poster: "/showcase/popular-works/color-blitz-social-poster.jpg",
    className: "col-span-2 min-h-[280px] lg:order-6 lg:col-span-5 lg:min-h-[360px]",
  },
];

function PopularWorkVideo({ work, priority }: { work: PopularWork; priority: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void video.play().catch(() => undefined);
        else video.pause();
      },
      { rootMargin: "160px 0px", threshold: 0.15 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={videoRef}
      className={`absolute inset-0 h-full w-full object-cover opacity-90 saturate-[1.05] transition duration-700 group-hover:scale-[1.025] group-hover:opacity-100 group-hover:saturate-[1.14] ${work.mediaClassName ?? ""}`}
      muted
      loop
      playsInline
      preload={priority ? "metadata" : "none"}
      poster={work.poster}
      aria-hidden="true"
    >
      <source src={work.video} type="video/mp4" />
    </video>
  );
}

export function PopularWorksShowcase({ isEn }: { isEn: boolean }) {
  const [selectedWork, setSelectedWork] = useState<PopularWork | null>(null);

  useEffect(() => {
    if (!selectedWork) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedWork(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedWork]);

  return (
    <section className="relative mx-auto max-w-[1500px] px-6 pb-12 pt-20 lg:px-10 lg:pb-20 lg:pt-28">
      <div className="pointer-events-none absolute -left-24 top-36 h-80 w-80 rounded-full bg-[#9ef5d8]/[0.07] blur-[120px]" />
      <div className="relative mb-9 grid gap-6 border-t border-white/[0.12] pt-6 md:grid-cols-12 md:items-end lg:mb-12">
        <div className="md:col-span-8">
          <div className="mb-5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#9ef5d8]">
            <span>{isEn ? "Popular now" : "正在流行"}</span>
            <span className="h-px w-10 bg-current opacity-45" />
            <span className="text-white/35">CURATED 06</span>
          </div>
          <h2 className="home-section-title max-w-4xl text-[clamp(2.5rem,4.8vw,5.25rem)]">
            {isEn ? "Made with imagination.\nFinished with intelligence." : "灵感已成片，\n好作品正在发生。"}
          </h2>
        </div>
        <div className="md:col-span-4 md:pb-2">
          <p className="max-w-md whitespace-pre-line text-sm leading-7 text-white/45">
            {isEn
              ? "Six recent audience favorites, spanning character, motion, scene, and short-form storytelling."
              : "从角色塑造、动作生成到场景叙事，\n精选近期最受欢迎的六支成片。"}
          </p>
          <p className="mt-4 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
            <Play className="h-3 w-3 fill-current" />
            {isEn ? "Select a film to watch" : "点击作品 · 完整观看"}
          </p>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-4">
        {POPULAR_WORKS.map((work, index) => (
          <button
            key={work.id}
            type="button"
            onClick={() => setSelectedWork(work)}
            className={`home-popular-card group relative overflow-hidden rounded-[1.35rem] border border-white/[0.12] bg-[#09111a] text-left shadow-[0_18px_60px_rgba(0,0,0,.24)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#05080d] ${work.className}`}
            aria-label={`${isEn ? "Watch" : "观看"} ${isEn ? work.titleEn : work.titleZh}`}
          >
            <PopularWorkVideo work={work} priority={index < 3} />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(3,7,11,.94)_0%,rgba(3,7,11,.24)_48%,rgba(3,7,11,.03)_78%)] transition duration-500 group-hover:bg-[linear-gradient(0deg,rgba(3,7,11,.9)_0%,rgba(3,7,11,.15)_48%,rgba(3,7,11,.01)_78%)]" />
            <div className="absolute inset-x-0 top-0 flex items-start justify-between p-4 sm:p-5">
              <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/75 backdrop-blur-md">
                {isEn ? work.categoryEn : work.categoryZh}
              </span>
              <span className="flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-white/20 bg-black/20 text-white/75 opacity-0 backdrop-blur-md transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                <Maximize2 className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 sm:p-6">
              <div>
                <span className="mb-2 block text-[9px] font-medium uppercase tracking-[0.2em] text-[#9ef5d8]/70">0{index + 1}</span>
                <h3 className="text-xl font-medium tracking-[-0.035em] text-white sm:text-2xl">
                  {isEn ? work.titleEn : work.titleZh}
                </h3>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#071019] shadow-[0_10px_30px_rgba(0,0,0,.28)] transition duration-300 group-hover:scale-110 group-hover:bg-[#9ef5d8]">
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
              </span>
            </div>
          </button>
        ))}
      </div>

      {selectedWork ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 backdrop-blur-xl sm:p-8"
          role="dialog"
          aria-modal="true"
          aria-label={isEn ? selectedWork.titleEn : selectedWork.titleZh}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedWork(null);
          }}
        >
          <div className="relative flex max-h-full w-full max-w-6xl flex-col items-center">
            <button
              type="button"
              onClick={() => setSelectedWork(null)}
              className="mb-3 ml-auto flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 text-xs font-medium text-white/80 transition hover:bg-white/[0.12] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]"
              aria-label={isEn ? "Close video" : "关闭视频"}
            >
              <X className="h-4 w-4" />{isEn ? "Close" : "关闭"}
            </button>
            <video
              key={selectedWork.id}
              className="max-h-[calc(100vh-7rem)] w-auto max-w-full rounded-2xl bg-black shadow-[0_30px_100px_rgba(0,0,0,.65)]"
              autoPlay
              controls
              playsInline
              poster={selectedWork.poster}
            >
              <source src={selectedWork.video} type="video/mp4" />
            </video>
          </div>
        </div>
      ) : null}
    </section>
  );
}
