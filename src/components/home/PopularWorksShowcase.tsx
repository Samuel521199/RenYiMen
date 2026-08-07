"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Maximize2, Play, Volume1, Volume2, VolumeX, X } from "lucide-react";
import { homeMediaUrl } from "@/lib/home-media";

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
  createHref?: string;
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
    titleZh: "风格迁移",
    titleEn: "Style Transfer",
    categoryZh: "角色形象重塑",
    categoryEn: "Character restyling",
    video: "/showcase/popular-works/face-swap-resort-hostess.mp4",
    poster: "/showcase/popular-works/face-swap-resort-hostess-poster.jpg",
    className: "min-h-[360px] lg:order-2 lg:col-span-3 lg:min-h-[620px]",
    mediaClassName: "object-[50%_18%]",
  },
  {
    id: "scene-light-texas-hostess",
    titleZh: "场景与光影变换",
    titleEn: "Texas Lounge Walkthrough",
    categoryZh: "场景与光影",
    categoryEn: "Scene and lighting",
    video: "/showcase/popular-works/scene-light-texas-hostess.mp4",
    poster: "/showcase/popular-works/scene-light-texas-hostess-poster.jpg",
    className: "min-h-[360px] lg:order-5 lg:col-span-3 lg:min-h-[360px]",
    mediaClassName: "object-[50%_18%]",
  },
  {
    id: "cowboy-character-design",
    titleZh: "牛仔角色设计",
    titleEn: "Cowboy Character Design",
    categoryZh: "IP 角色设计",
    categoryEn: "IP character design",
    video: "/showcase/popular-works/cowboy-character-design.mp4",
    poster: "/showcase/popular-works/cowboy-character-design-poster.jpg",
    className: "min-h-[260px] lg:order-4 lg:col-span-3 lg:min-h-[360px]",
  },
  {
    id: "character-motion-workflow",
    titleZh: "角色动作工作流",
    titleEn: "Character Motion Workflow",
    categoryZh: "动作生成",
    categoryEn: "Motion generation",
    video: "/showcase/popular-works/character-motion-workflow.mp4",
    poster: "/showcase/popular-works/character-motion-workflow-poster.jpg",
    className: "min-h-[260px] lg:order-1 lg:col-span-3 lg:min-h-[620px]",
    mediaClassName: "object-[50%_20%]",
  },
  {
    id: "island-dance-workflow",
    titleZh: "海岛舞步",
    titleEn: "Island Dance",
    categoryZh: "角色动画",
    categoryEn: "Character animation",
    video: "/showcase/popular-works/island-dance-workflow.mp4",
    poster: "/showcase/popular-works/island-dance-workflow-poster.jpg",
    className: "min-h-[260px] lg:order-6 lg:col-span-3 lg:min-h-[360px]",
    mediaClassName: "object-[50%_22%]",
  },
  {
    id: "color-blitz-social",
    titleZh: "色彩闪电社交短片",
    titleEn: "Color Blitz Social Film",
    categoryZh: "30 秒成片",
    categoryEn: "30-second film",
    video: "/showcase/popular-works/color-blitz-social.mp4",
    poster: "/showcase/popular-works/color-blitz-social-poster.jpg",
    className: "min-h-[260px] lg:order-7 lg:col-span-3 lg:min-h-[360px]",
  },
  {
    id: "3d-model-generation",
    titleZh: "3D 模型生成",
    titleEn: "3D Model Generation",
    categoryZh: "3D 角色创作",
    categoryEn: "3D character creation",
    video: "/showcase/popular-works/3d-model-generation.mp4",
    poster: "/showcase/popular-works/3d-model-generation-poster.jpg",
    className: "col-span-2 min-h-[280px] lg:order-8 lg:col-span-12 lg:min-h-[500px]",
    createHref: "/workbench/tools?sku=BAILIAN_TRIPO_3D",
  },
];

function PopularWorkVideo({ work, priority, muted, volume }: { work: PopularWork; priority: boolean; muted: boolean; volume: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mutedRef = useRef(muted);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let isVisible = false;
    const playPreview = () => {
      if (!isVisible) return;
      // Card previews start muted so browsers can play them without a user gesture.
      video.defaultMuted = true;
      video.muted = mutedRef.current;
      void video.play().catch(() => undefined);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (isVisible) playPreview();
        else video.pause();
      },
      { rootMargin: "160px 0px", threshold: 0.15 },
    );
    // With preload="none", some production browsers resolve the first play()
    // attempt before enough media is buffered. Retry as soon as it becomes playable.
    video.addEventListener("loadeddata", playPreview);
    video.addEventListener("canplay", playPreview);
    observer.observe(video);
    return () => {
      observer.disconnect();
      video.removeEventListener("loadeddata", playPreview);
      video.removeEventListener("canplay", playPreview);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    mutedRef.current = muted;
    video.muted = muted;
    video.volume = volume;
    if (!muted) void video.play().catch(() => undefined);
  }, [muted, volume]);

  return (
    <video
      ref={videoRef}
      className={`absolute inset-0 h-full w-full object-cover opacity-90 saturate-[1.05] transition duration-700 group-hover:scale-[1.025] group-hover:opacity-100 group-hover:saturate-[1.14] ${work.mediaClassName ?? ""}`}
      muted={muted}
      loop
      playsInline
      preload={priority ? "metadata" : "none"}
      poster={work.poster}
      aria-hidden="true"
    >
      <source src={homeMediaUrl(work.video)} type="video/mp4" />
    </video>
  );
}

export function PopularWorksShowcase({ isEn }: { isEn: boolean }) {
  const [selectedWork, setSelectedWork] = useState<PopularWork | null>(null);
  const [unmutedWorkId, setUnmutedWorkId] = useState<string | null>(null);
  const [workVolumes, setWorkVolumes] = useState<Record<string, number>>(() =>
    Object.fromEntries(POPULAR_WORKS.map((work) => [work.id, 0.7])),
  );

  const openWork = (work: PopularWork) => {
    setUnmutedWorkId(null);
    setSelectedWork(work);
  };

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
            <span className="text-white/35">CURATED 08</span>
          </div>
          <h2 className="home-section-title max-w-4xl text-[clamp(2.5rem,4.8vw,5.25rem)]">
            {isEn ? "Made with imagination.\nFinished with intelligence." : "灵感已成片，\n好作品正在发生。"}
          </h2>
        </div>
        <div className="md:col-span-4 md:pb-2">
          <p className="max-w-md whitespace-pre-line text-sm leading-7 text-white/45">
            {isEn
              ? "Eight recent audience favorites, spanning character, motion, scene, 3D creation, and short-form storytelling."
              : "从角色塑造、动作生成到场景叙事与 3D 创作，\n精选近期最受欢迎的八支成片。"}
          </p>
          <p className="mt-4 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
            <Play className="h-3 w-3 fill-current" />
            {isEn ? "Select a film to watch" : "点击作品 · 完整观看"}
          </p>
        </div>
      </div>

      <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-12 lg:gap-4">
        {POPULAR_WORKS.map((work, index) => {
          const isMuted = unmutedWorkId !== work.id;
          const volume = workVolumes[work.id] ?? 0.7;
          return (
          <article
            key={work.id}
            className={`home-popular-card group relative overflow-hidden rounded-[1.35rem] border border-white/[0.12] bg-[#09111a] text-left shadow-[0_18px_60px_rgba(0,0,0,.24)] ${work.className}`}
          >
            <PopularWorkVideo work={work} priority={index < 3} muted={isMuted} volume={volume} />
            <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(3,7,11,.94)_0%,rgba(3,7,11,.24)_48%,rgba(3,7,11,.03)_78%)] transition duration-500 group-hover:bg-[linear-gradient(0deg,rgba(3,7,11,.9)_0%,rgba(3,7,11,.15)_48%,rgba(3,7,11,.01)_78%)]" />
            <button
              type="button"
              onClick={() => openWork(work)}
              className="absolute inset-0 z-10 rounded-[1.35rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#9ef5d8]"
              aria-label={`${isEn ? "Watch" : "观看"} ${isEn ? work.titleEn : work.titleZh}`}
            />
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end p-4 sm:p-5">
              <span className="flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-white/20 bg-black/20 text-white/75 opacity-0 backdrop-blur-md transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                <Maximize2 className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-4 p-5 sm:p-6">
              <div className="min-w-0 flex-1">
                <span className="mb-2 block text-[9px] font-medium uppercase tracking-[0.2em] text-[#9ef5d8]/70">0{index + 1}</span>
                <div className="flex min-w-0 items-center gap-2.5">
                  <h3 className="min-w-0 shrink truncate text-xl font-medium tracking-[-0.035em] text-white sm:text-2xl">
                    {isEn ? work.titleEn : work.titleZh}
                  </h3>
                  {work.createHref ? (
                    <Link
                      href={work.createHref}
                      className="pointer-events-auto relative z-30 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-black/25 px-3 text-[11px] font-medium tracking-[0.02em] text-white/75 backdrop-blur-md transition duration-300 hover:border-[#9ef5d8]/45 hover:bg-[#9ef5d8]/10 hover:text-[#dffdf4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8] sm:h-9 sm:px-4 sm:text-xs"
                      aria-label={isEn ? `Start creating with ${work.titleEn}` : `开始创作${work.titleZh}`}
                    >
                      <span>{isEn ? "Start creating" : "开始创作"}</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : null}
                  <div className="home-volume-control group/volume pointer-events-auto relative z-30 shrink-0 sm:translate-y-1 sm:opacity-0 sm:transition sm:duration-300 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isMuted) {
                          setUnmutedWorkId(null);
                          return;
                        }
                        if (volume === 0) setWorkVolumes((current) => ({ ...current, [work.id]: 0.7 }));
                        setUnmutedWorkId(work.id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#9ef5d8] text-[#071019] shadow-[0_8px_24px_rgba(0,0,0,.28),0_0_0_1px_rgba(158,245,216,.16)] transition duration-300 hover:scale-105 hover:bg-[#b8f8e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                      aria-label={isMuted ? (isEn ? `Unmute ${work.titleEn}` : `开启${work.titleZh}的声音`) : (isEn ? `Mute ${work.titleEn}` : `静音${work.titleZh}`)}
                      aria-pressed={!isMuted}
                      title={isMuted ? (isEn ? "Turn sound on" : "开启声音") : (isEn ? "Mute or adjust volume" : "静音或调节音量")}
                    >
                      {isMuted || volume === 0 ? <VolumeX className="h-3.5 w-3.5" /> : volume <= 0.5 ? <Volume1 className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </button>
                    <div className="pointer-events-none invisible absolute left-full top-1/2 w-[110px] -translate-y-1/2 pl-2 opacity-0 transition duration-200 group-hover/volume:pointer-events-auto group-hover/volume:visible group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:visible group-focus-within/volume:opacity-100">
                      <div className="flex h-8 w-[102px] items-center gap-1.5 rounded-full bg-black/45 px-2 backdrop-blur-md">
                        <input
                          className="home-volume-slider block w-[70px] shrink-0 cursor-pointer"
                          style={{ "--volume-progress": `${volume * 100}%` } as CSSProperties}
                          type="range"
                          min="0"
                          max="1"
                          step="0.05"
                          value={volume}
                          onChange={(event) => {
                            const nextVolume = Number(event.target.value);
                            setWorkVolumes((current) => ({ ...current, [work.id]: nextVolume }));
                            setUnmutedWorkId(nextVolume === 0 ? null : work.id);
                          }}
                          aria-label={isEn ? `${work.titleEn} volume` : `${work.titleZh}音量`}
                        />
                        <span className="w-5 text-right text-[10px] font-medium tabular-nums text-white/80">
                          {Math.round(volume * 100)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <span className="home-popular-play flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#071019] shadow-[0_10px_30px_rgba(0,0,0,.28)] transition duration-300 group-hover:scale-110 group-hover:bg-[#9ef5d8]">
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
              </span>
            </div>
          </article>
          );
        })}
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
              <source src={homeMediaUrl(selectedWork.video)} type="video/mp4" />
            </video>
          </div>
        </div>
      ) : null}
    </section>
  );
}
