"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  ChevronDown,
  Clapperboard,
  ImageIcon,
  LayoutGrid,
  Menu,
  Search,
  Sparkles,
  Star,
  Video,
  WandSparkles,
  X,
} from "lucide-react";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { usePermission } from "@workbench/lib/PermissionContext";

type MenuLink = { href: string; label: string; labelEn?: string };
type OperationsMenu = { label: string; labelEn: string; href?: string; children?: MenuLink[] };

const GENERAL_COLUMNS = [
  {
    label: "视频生成",
    labelEn: "Video Creation",
    description: "从静态画面生成具有运动与叙事感的视频",
    descriptionEn: "Animate still frames into expressive video",
    href: "/workbench/tools?group=video-generation",
    icon: Video,
    accent: "text-cyan-300 bg-cyan-300/10",
    tools: [
      { label: "单图生成短视频", labelEn: "Single-image video", href: "/workbench/tools?sku=KLING_CINEMA_PRO" },
      { label: "Kling 图生视频", labelEn: "Kling image-to-video", href: "/workbench/tools?sku=KLING_STD_I2V" },
      { label: "模仿生成舞蹈视频", labelEn: "Dance motion transfer", href: "/workbench/tools?sku=BAILIAN_WAN22_ANIMATE_MOVE" },
      { label: "多模态图生视频", labelEn: "Multimodal I2V", href: "/workbench/tools?sku=BAILIAN_WANX_I2V" },
      { label: "多参考图剧场生成", labelEn: "Multi-reference drama", href: "/workbench/tools?sku=BAILIAN_MULTI_REF_I2V" },
      { label: "视频续写", labelEn: "Video continuation", href: "/workbench/tools?sku=BAILIAN_WAN27_VIDEO_CONTINUATION" },
      { label: "首尾帧过渡视频", labelEn: "Boundary-frame transition", href: "/workbench/tools?sku=RH_SVD_IMG2VID" },
    ],
  },
  {
    label: "视频编辑",
    labelEn: "Video Editing",
    description: "修复、改造与复刻现有视频画面",
    descriptionEn: "Repair, transform, and replicate existing footage",
    href: "/workbench/tools?group=video-editing",
    icon: WandSparkles,
    accent: "text-violet-300 bg-violet-300/10",
    tools: [
      { label: "视频模糊修复", labelEn: "Video enhancement", href: "/workbench/tools?sku=RH_VIDEO_ENHANCE" },
      { label: "运镜复刻", labelEn: "Camera replication", href: "/workbench/tools?sku=BAILIAN_WAN27_CAMERA_REPLICATION" },
      { label: "特效复刻", labelEn: "Effect replication", href: "/workbench/tools?sku=BAILIAN_WAN27_EFFECT_REPLICATION" },
      { label: "局部修改", labelEn: "Local editing", href: "/workbench/tools?sku=BAILIAN_HAPPYHORSE_VIDEO_EDIT" },
      { label: "场景与光影变换", labelEn: "Scene & lighting transform", href: "/workbench/tools?sku=BAILIAN_SCENE_LIGHT_VIDEO_EDIT" },
      { label: "整体风格迁移", labelEn: "Overall style transfer", href: "/workbench/tools?sku=BAILIAN_OVERALL_STYLE_TRANSFER" },
      { label: "高动态重绘", labelEn: "High-motion restyle", href: "/workbench/tools?sku=BAILIAN_HIGH_DYNAMIC_REDRAW" },
    ],
  },
  {
    label: "声音与数字人",
    labelEn: "Voice & Characters",
    description: "让角色开口表达，并完成声音与字幕后期",
    descriptionEn: "Bring characters to life with voice and captions",
    href: "/workbench/tools?group=audio-post",
    icon: AudioLines,
    accent: "text-emerald-300 bg-emerald-300/10",
    tools: [
      { label: "有声视频", labelEn: "Talking character", href: "/workbench/tools?sku=BAILIAN_WAN22_S2V" },
      { label: "自动添加字幕", labelEn: "Automatic captions", href: "/workbench/tools?sku=LOCAL_AUTO_SUBTITLES" },
      { label: "视频提取音频", labelEn: "Extract audio from video", href: "/workbench/tools?sku=LOCAL_AUDIO_EXTRACTION" },
      { label: "声音克隆", labelEn: "Voice cloning", href: "/workbench/tools?sku=BAILIAN_VOICE_CLONE" },
      { label: "文字设计音色", labelEn: "Voice design", href: "/workbench/tools?sku=BAILIAN_COSYVOICE_VOICE_DESIGN" },
      { label: "情绪化配音", labelEn: "Expressive speech", href: "/workbench/tools?sku=BAILIAN_EMOTIONAL_TTS" },
    ],
  },
  {
    label: "图片与灵感",
    labelEn: "Images & Ideas",
    description: "生成与处理图片，把视觉参考转成灵感和三维资产",
    descriptionEn: "Create and refine images, extract ideas, and build 3D assets",
    href: "/workbench/tools?category=image",
    icon: ImageIcon,
    accent: "text-amber-300 bg-amber-300/10",
    tools: [
      { label: "智能图片生成", labelEn: "Smart image generation", href: "/workbench/tools?sku=GPT_IMAGE2_REF" },
      { label: "文字生成图片", labelEn: "Text to image", href: "/workbench/tools?sku=RH_TXT2IMG_SHORTDRAMA" },
      { label: "分镜生成出图", labelEn: "Storyboard generator", href: "/workbench/tools?sku=RH_STORYBOARD" },
      { label: "人物三视图", labelEn: "Character turnaround", href: "/workbench/tools/character-turnaround" },
      { label: "背景替换", labelEn: "Background replacement", href: "/workbench/tools?sku=RH_BG_REPLACE" },
      { label: "人像抠图", labelEn: "Portrait matting", href: "/workbench/tools?sku=RH_MATTING" },
      { label: "换头换脸", labelEn: "Face swap", href: "/workbench/tools?sku=RH_FACE_SWAP" },
      { label: "高清放大", labelEn: "HD upscaling", href: "/workbench/tools?sku=RH_HD_UPSCALE" },
      { label: "提示词反推", labelEn: "Prompt intelligence", href: "/workbench/tools?sku=RH_PROMPT_REVERSE" },
      { label: "Tripo 3D 模型生成", labelEn: "Tripo 3D model", href: "/workbench/tools?sku=BAILIAN_TRIPO_3D" },
    ],
  },
] as const;

function isHrefActive(pathname: string, query: string, href: string): boolean {
  const url = new URL(href, "http://localhost");
  if (url.pathname !== pathname) return false;
  return url.search ? url.searchParams.toString() === query : !query;
}

export default function WorkbenchTopNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { lang, t } = useLanguage();
  const { canView, canViewWorkflow, canViewTemplate, canViewAdmin } = usePermission();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toolSearch, setToolSearch] = useState(searchParams.get("q") ?? "");
  const closeTimerRef = useRef<number | null>(null);
  const isGeneral = pathname === "/workbench/home" || pathname.startsWith("/workbench/tools");
  const isEn = lang === "en";
  const query = searchParams.toString();

  useEffect(() => {
    setPortalRoot(document.getElementById("workbench-top-navigation-root"));
  }, []);

  useEffect(() => {
    setOpenMenu(null);
    setMobileOpen(false);
  }, [pathname, query]);

  useEffect(() => {
    setToolSearch(searchParams.get("q") ?? "");
  }, [searchParams]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const open = (menu: string) => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    setOpenMenu(menu);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpenMenu(null), 140);
  };

  const submitToolSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = toolSearch.trim();
    router.push(keyword ? `/workbench/tools?q=${encodeURIComponent(keyword)}` : "/workbench/tools");
    setOpenMenu(null);
    setMobileOpen(false);
  };

  const operationsMenus = useMemo<OperationsMenu[]>(() => {
    const taskChildren: MenuLink[] = canView("tasks")
      ? [
          ["expression", "表情制作", "/workbench/workflows/expression"],
          ["activity", "活动图生产", "/workbench/workflows/activity"],
          ["daily_post", "日常互动图", "/workbench/workflows/daily-post"],
          ["share", "转发图生产", "/workbench/workflows/share"],
          ["background", "背景图生成", "/workbench/workflows/background"],
          ["multi_fusion", "多图融合", "/workbench/workflows/multi-fusion"],
          ["trending", "热点借势图", "/workbench/workflows/trending"],
          ["trending_news", "热点借势·新闻", "/workbench/workflows/trending-news"],
          ["logo", "Logo 水印", "/workbench/workflows/logo"],
          ["video", "视频工作台", "/workbench/videos"],
        ].filter(([key]) => canViewWorkflow(key)).map(([, label, href]) => ({ label, href }))
      : [];
    if (canView("tasks")) taskChildren.unshift({ label: "任务列表", href: "/workbench/workflows" });
    if (canView("review")) taskChildren.push({ label: "审核中心", href: "/workbench/review" });

    const templateChildren: MenuLink[] = canView("templates")
      ? [
          ["instructions", "指令库", "/workbench/instructions"],
          ["prompts", "Prompt 模版", "/workbench/prompts"],
          ["activity_templates", "活动图模版", "/workbench/admin/activity-templates"],
          ["daily_post_templates", "日常互动图模版", "/workbench/admin/daily-post-templates"],
          ["share_instructions", "转发图指令库", "/workbench/admin/share-instructions"],
        ].filter(([key]) => canViewTemplate(key)).map(([, label, href]) => ({ label, href }))
      : [];

    const assetChildren: MenuLink[] = [
      ...(canView("assets") ? [{ label: "素材库", href: "/workbench/assets" }, { label: "素材标签管理", href: "/workbench/assets/tags" }] : []),
      ...(canView("gallery") ? [{ label: "成品图库", href: "/workbench/gallery" }, { label: "成品图标签管理", href: "/workbench/gallery/tags" }] : []),
      ...(canView("video_gallery") ? [{ label: "视频成品库", href: "/workbench/gallery/video" }] : []),
    ];

    const adminChildren: MenuLink[] = [
      { label: "自定义配置", href: "/workbench/custom-config" },
      ...(
        canView("admin")
          ? [
              ["users", "用户管理", "/workbench/admin/users"],
              ["models", "模型配置", "/workbench/admin/models"],
              ["api_keys", "API Keys", "/workbench/admin/api-keys"],
              ["hotspot_import", "热点导入管理", "/workbench/admin/hotspot-import"],
              ["logs", "系统日志", "/workbench/admin/logs"],
              ["logs", "调用统计", "/workbench/admin/usage-stats"],
            ].filter(([key]) => canViewAdmin(key)).map(([, label, href]) => ({ label, href }))
          : []
      ),
    ];

    return [
      { label: "概览", labelEn: "Overview", href: "/workbench/operations" },
      ...(taskChildren.length ? [{ label: "任务协同", labelEn: "Tasks", children: taskChildren }] : []),
      ...(templateChildren.length ? [{ label: "模板与内容", labelEn: "Templates", children: templateChildren }] : []),
      ...(assetChildren.length ? [{ label: "素材资产", labelEn: "Assets", children: assetChildren }] : []),
      ...(canView("stats") ? [{ label: "数据分析", labelEn: "Analytics", href: "/workbench/stats" }] : []),
      { label: "系统管理", labelEn: "System", children: adminChildren },
    ];
  }, [canView, canViewAdmin, canViewTemplate, canViewWorkflow]);

  if (!portalRoot) return null;

  const generalLinks: MenuLink[] = [
    { label: "首页", labelEn: "Home", href: "/workbench/home" },
    { label: "视频", labelEn: "Video", href: "/workbench/tools?category=video" },
    { label: "图片", labelEn: "Images", href: "/workbench/tools?category=image" },
    { label: "音频", labelEn: "Audio", href: "/workbench/tools?category=audio" },
    { label: "我的收藏", labelEn: "Favorites", href: "/workbench/tools?group=favorites" },
  ];

  const linkClasses = (href: string) => `group relative flex h-full items-center rounded-lg px-3.5 text-sm font-medium tracking-[0.02em] transition-all duration-300 after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-t-full after:bg-gradient-to-r after:from-cyan-300 after:to-emerald-200 after:transition-all after:duration-300 hover:-translate-y-px hover:bg-white/[0.055] hover:text-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_8px_22px_rgba(0,0,0,.16)] hover:after:scale-x-100 hover:after:opacity-60 active:translate-y-0 active:scale-[.98] motion-reduce:transform-none motion-reduce:transition-none ${
    isHrefActive(pathname, query, href)
      ? "text-white after:scale-x-100 after:opacity-100"
      : "text-white/50 after:scale-x-0 after:opacity-0"
  }`;

  const operationSection = (label: string) => operationsMenus.find((item) => item.label === label);

  const renderOperationShortcut = (item: OperationsMenu | undefined, description: string, descriptionEn: string) => {
    if (!item?.href) return null;
    return (
      <Link href={item.href} className="group/ops block rounded-xl border border-white/[0.075] bg-[linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.015))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)] transition-colors hover:border-[#9ef5d8]/20 hover:bg-[#9ef5d8]/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/60">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-100 group-hover/ops:text-[#9ef5d8]">
          <span>{isEn ? item.labelEn : t(item.label)}</span>
          <ArrowRight className="h-3.5 w-3.5 text-slate-600 transition-all group-hover/ops:translate-x-0.5 group-hover/ops:text-[#9ef5d8]" />
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500">{isEn ? descriptionEn : description}</p>
      </Link>
    );
  };

  const renderOperationGroup = (item: OperationsMenu | undefined, split = false) => {
    if (!item?.children?.length) return null;
    return (
      <section className="rounded-xl border border-white/[0.075] bg-[linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.01))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.02)]">
        <div className="text-sm font-semibold text-slate-100">{isEn ? item.labelEn : t(item.label)}</div>
        <div className={`mt-3 border-t border-white/[0.07] pt-3 ${split ? "grid grid-cols-2 gap-x-4 gap-y-1" : "space-y-1"}`}>
          {item.children.map((child) => (
            <Link key={child.href} href={child.href} className="group/child flex min-w-0 items-center justify-between gap-2 rounded-md px-1 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/[0.025] hover:text-[#9ef5d8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/60">
              <span className="flex min-w-0 items-center gap-2"><span className="h-1 w-1 shrink-0 rounded-full bg-slate-600 transition-colors group-hover/child:bg-[#9ef5d8]" /><span className="truncate">{t(child.label)}</span></span>
              <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-all group-hover/child:translate-x-0.5 group-hover/child:opacity-60" />
            </Link>
          ))}
        </div>
      </section>
    );
  };

  const operationsMegaMenu = (
    <div className="h-full" onMouseEnter={() => open("operations-mega")} onMouseLeave={scheduleClose}>
      <button
        type="button"
        onClick={() => setOpenMenu((current) => current === "operations-mega" ? null : "operations-mega")}
        aria-expanded={openMenu === "operations-mega"}
        className={`group relative flex h-full items-center gap-2 rounded-lg px-5 text-sm font-medium tracking-[0.02em] transition-all duration-300 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-[2px] after:origin-center after:rounded-t-full after:bg-gradient-to-r after:from-cyan-300 after:to-emerald-200 after:transition-all after:duration-300 hover:-translate-y-px hover:bg-white/[0.055] hover:text-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_8px_22px_rgba(0,0,0,.16)] hover:after:scale-x-100 hover:after:opacity-60 active:translate-y-0 active:scale-[.98] motion-reduce:transform-none motion-reduce:transition-none ${openMenu === "operations-mega" ? "text-white after:scale-x-100 after:opacity-100" : "text-white/50 after:scale-x-0 after:opacity-0"}`}
      >
        {isEn ? "Operations" : "运营部"}
        <ChevronDown className={`h-3.5 w-3.5 text-white/35 transition-all duration-300 group-hover:translate-y-0.5 group-hover:text-white/80 ${openMenu === "operations-mega" ? "rotate-180 text-white/80" : ""}`} />
      </button>
      {openMenu === "operations-mega" ? (
        <div className="absolute left-1/2 top-[calc(100%-2px)] z-[100] w-[min(900px,calc(100vw-3rem))] -translate-x-1/2 pt-3" onMouseEnter={() => open("operations-mega")} onMouseLeave={scheduleClose}>
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(16,17,22,.985),rgba(6,8,12,.99))] shadow-[0_32px_100px_rgba(0,0,0,.68),inset_0_1px_0_rgba(255,255,255,.045)] backdrop-blur-2xl">
            <div className="pointer-events-none absolute -left-20 -top-32 h-64 w-72 rounded-full bg-emerald-400/[0.055] blur-[80px]" />
            <div className="pointer-events-none absolute -right-20 top-10 h-52 w-64 rounded-full bg-cyan-400/[0.035] blur-[90px]" />
            <div className="relative flex items-center justify-between border-b border-white/[0.07] bg-white/[0.012] px-5 py-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><Clapperboard className="h-4 w-4 text-[#9ef5d8]" />{isEn ? "Operations Workspace" : "运营部工作台"}</div>
              </div>
              <Link href="/workbench/operations" className="flex items-center gap-1 text-sm font-medium text-[#9ef5d8]/80 hover:text-[#9ef5d8]">{isEn ? "Open overview" : "进入概览"}<ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
            <div className="relative grid max-h-[min(560px,calc(100vh-8rem))] grid-cols-1 gap-3 overflow-y-auto overscroll-contain p-4 lg:grid-cols-[1.12fr_1fr_1fr]">
              <div className="flex min-w-0 flex-col gap-3">
                {renderOperationShortcut(operationSection("概览"), "模型调用与团队使用概览", "Model usage and team activity overview")}
                {renderOperationGroup(operationSection("任务协同"), true)}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {renderOperationGroup(operationSection("模板与内容"))}
                {renderOperationShortcut(operationSection("数据分析"), "调用、成本与产出数据统计", "Usage, cost, and output analytics")}
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {renderOperationGroup(operationSection("素材资产"))}
                {renderOperationGroup(operationSection("系统管理"), true)}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  const generalDesktop = (
    <nav aria-label={isEn ? "General workspace navigation" : "通用型导航"} className="hidden h-full min-w-0 flex-1 items-stretch justify-center gap-1 xl:flex">
      <Link href={generalLinks[0].href} className={linkClasses(generalLinks[0].href)}>{isEn ? generalLinks[0].labelEn : generalLinks[0].label}</Link>
      {operationsMegaMenu}
      <div className="relative h-full" onMouseEnter={() => open("creative")} onMouseLeave={scheduleClose}>
        <button
          type="button"
          onClick={() => setOpenMenu((current) => current === "creative" ? null : "creative")}
          aria-expanded={openMenu === "creative"}
          className={`group relative flex h-full items-center gap-2 rounded-lg px-3.5 text-sm font-medium tracking-[0.02em] transition-all duration-300 after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-t-full after:bg-gradient-to-r after:from-cyan-300 after:to-emerald-200 after:transition-all after:duration-300 hover:-translate-y-px hover:bg-white/[0.055] hover:text-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_8px_22px_rgba(0,0,0,.16)] hover:after:scale-x-100 hover:after:opacity-60 active:translate-y-0 active:scale-[.98] motion-reduce:transform-none motion-reduce:transition-none ${openMenu === "creative" || (pathname === "/workbench/tools" && (!query || searchParams.has("sku") || searchParams.has("q"))) ? "text-white after:scale-x-100 after:opacity-100" : "text-white/50 after:scale-x-0 after:opacity-0"}`}
        >
          {isEn ? "Creative Hub" : "创作中心"}<ChevronDown className={`h-3.5 w-3.5 text-white/35 transition-all duration-300 group-hover:translate-y-0.5 group-hover:text-white/80 ${openMenu === "creative" ? "rotate-180 text-white/80" : ""}`} />
        </button>
        {openMenu === "creative" ? (
          <div className="fixed left-1/2 top-[calc(5rem-2px)] z-[100] w-[min(1180px,calc(100vw-3rem))] -translate-x-1/2 pt-3" onMouseEnter={() => open("creative")} onMouseLeave={scheduleClose}>
            <div className="workbench-creative-menu relative max-h-[calc(100vh-6rem)] overflow-x-hidden overflow-y-auto rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(16,17,22,.995),rgba(6,8,12,.998))] shadow-[0_32px_100px_rgba(0,0,0,.68),inset_0_1px_0_rgba(255,255,255,.045)]">
              <div className="pointer-events-none absolute -left-20 -top-32 h-64 w-72 rounded-full bg-cyan-400/[0.055] blur-[85px]" />
              <div className="pointer-events-none absolute -right-16 top-8 h-52 w-64 rounded-full bg-violet-500/[0.045] blur-[90px]" />
              <div className="relative flex items-center justify-between border-b border-white/[0.07] bg-white/[0.012] px-5 py-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-white"><Sparkles className="h-4 w-4 text-cyan-300" />{isEn ? "Creative Hub" : "创作中心"}</div>
                </div>
                <Link href="/workbench/tools" className="flex items-center gap-2 text-sm font-medium text-cyan-300 hover:text-cyan-200"><span className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-0.5 text-[10px] tracking-[0.08em] text-cyan-200/70">30 {isEn ? "TOOLS" : "个工具"}</span>{isEn ? "All tools" : "全部工具"}<ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="relative grid grid-cols-2 gap-px bg-white/[0.055] xl:grid-cols-4">
                {GENERAL_COLUMNS.map((column) => {
                  const Icon = column.icon;
                  return (
                    <div key={column.label} className="group bg-[rgba(9,11,15,.94)] p-5 transition-colors hover:bg-white/[0.025]">
                      <Link href={column.href} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                        <div className={`mb-4 flex h-9 w-9 items-center justify-center rounded-xl ${column.accent}`}><Icon className="h-4.5 w-4.5" /></div>
                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-100 hover:text-white">{isEn ? column.labelEn : column.label}<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" /></div>
                        <p className="mt-1.5 min-h-9 text-sm leading-[1.5] text-slate-500">{isEn ? column.descriptionEn : column.description}</p>
                      </Link>
                      <div className="mt-4 grid grid-cols-1 gap-x-3 gap-y-1.5 border-t border-white/[0.07] pt-3 xl:grid-cols-2">
                        {column.tools.map((tool) => (
                          <Link key={tool.href} href={tool.href} className="group/tool flex min-h-7 items-start justify-between gap-1.5 rounded-md px-1 py-1 text-xs leading-[1.45] text-slate-400 transition-colors hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                            <span className="flex min-w-0 items-start gap-2"><span className="mt-[0.42rem] h-1 w-1 shrink-0 rounded-full bg-slate-600 transition-colors group-hover/tool:bg-cyan-400" /><span>{isEn ? tool.labelEn : tool.label}</span></span>
                            <ArrowRight className="h-3 w-3 shrink-0 opacity-0 transition-all group-hover/tool:translate-x-0.5 group-hover/tool:opacity-60" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {generalLinks.slice(1).map((item) => <Link key={item.href} href={item.href} className={linkClasses(item.href)}>{isEn ? item.labelEn : item.label}</Link>)}
    </nav>
  );

  const operationsDesktop = (
    <nav aria-label={isEn ? "Operations workspace navigation" : "运营部导航"} className="hidden h-full w-full max-w-[900px] min-w-0 items-stretch justify-between xl:flex">
      {operationsMenus.map((item) => {
        if (item.href) return <Link key={item.href} href={item.href} className={linkClasses(item.href)}>{isEn ? item.labelEn : t(item.label)}</Link>;
        const menuKey = `ops-${item.label}`;
        const active = item.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`));
        return (
          <div key={item.label} className="relative h-full" onMouseEnter={() => open(menuKey)} onMouseLeave={scheduleClose}>
            <button type="button" onClick={() => setOpenMenu((current) => current === menuKey ? null : menuKey)} className={`group relative flex h-full items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-all after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-t-full after:bg-gradient-to-r after:from-cyan-300 after:to-emerald-200 after:transition-all hover:-translate-y-px hover:bg-white/[0.05] hover:text-white hover:after:scale-x-100 hover:after:opacity-60 ${active || openMenu === menuKey ? "text-white after:scale-x-100 after:opacity-100" : "text-white/50 after:scale-x-0 after:opacity-0"}`}>
              {isEn ? item.labelEn : t(item.label)}<ChevronDown className={`h-3.5 w-3.5 text-white/35 transition-all group-hover:text-white/75 ${openMenu === menuKey ? "rotate-180 text-white/80" : ""}`} />
            </button>
            {openMenu === menuKey ? (
              <div className="absolute left-1/2 top-[calc(100%-2px)] z-[100] w-56 -translate-x-1/2 pt-3" onMouseEnter={() => open(menuKey)} onMouseLeave={scheduleClose}>
                <div className="rounded-xl border border-white/[0.09] bg-[rgba(9,11,15,.98)] p-2 shadow-[0_24px_70px_rgba(0,0,0,.62),inset_0_1px_0_rgba(255,255,255,.035)] backdrop-blur-2xl">
                  {item.children?.map((child) => <Link key={child.href} href={child.href} className={`block rounded-lg px-3 py-2.5 text-sm transition-colors ${pathname === child.href ? "bg-[#9ef5d8]/[0.08] text-[#9ef5d8]" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}>{t(child.label)}</Link>)}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  const mobileItems = isGeneral
    ? [
        generalLinks[0],
        { label: "运营部", labelEn: "Operations", href: "/workbench/operations" },
        { label: "创作中心", labelEn: "Creative Hub", href: "/workbench/tools" },
        ...generalLinks.slice(1),
      ]
    : operationsMenus.flatMap((item) => item.href ? [{ label: item.label, labelEn: item.labelEn, href: item.href }] : (item.children ?? []).map((child) => ({ ...child, labelEn: child.label })));

  return createPortal(
    <div className="relative flex h-full min-w-0 flex-1 items-center justify-center gap-4 px-3">
      {isGeneral ? generalDesktop : operationsDesktop}
      {isGeneral ? (
        <form onSubmit={submitToolSearch} role="search" className="relative hidden w-[260px] shrink-0 xl:block 2xl:w-[300px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={toolSearch}
            onChange={(event) => setToolSearch(event.target.value)}
            placeholder={isEn ? "Search tools" : "搜索工具"}
            aria-label={isEn ? "Search creative tools" : "搜索创作工具"}
            className="h-11 w-full rounded-2xl border border-white/[0.11] bg-white/[0.045] pl-11 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-white/30 hover:border-white/[0.18] hover:bg-white/[0.06] focus:border-cyan-300/45 focus:bg-white/[0.075] focus:ring-2 focus:ring-cyan-300/10"
          />
        </form>
      ) : null}
      <button type="button" onClick={() => setMobileOpen((current) => !current)} aria-expanded={mobileOpen} aria-label={isEn ? "Open navigation" : "打开导航"} className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/5 xl:hidden">
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {mobileOpen ? (
        <div className="fixed inset-x-3 top-[5.15rem] z-[100] max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-white/[0.09] bg-[linear-gradient(145deg,rgba(16,17,22,.985),rgba(6,8,12,.99))] p-3 shadow-[0_28px_90px_rgba(0,0,0,.68)] backdrop-blur-2xl xl:hidden">
          {isGeneral ? (
            <form onSubmit={submitToolSearch} role="search" className="relative mb-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input value={toolSearch} onChange={(event) => setToolSearch(event.target.value)} placeholder={isEn ? "Search tools" : "搜索工具"} className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-300/40" />
            </form>
          ) : null}
          <div className="mb-2 flex items-center gap-2 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            {isGeneral ? <LayoutGrid className="h-3.5 w-3.5" /> : <Clapperboard className="h-3.5 w-3.5" />}
            {isGeneral ? (isEn ? "General workspace" : "通用型工作空间") : (isEn ? "Operations workspace" : "运营部工作空间")}
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {mobileItems.map((item) => <Link key={`${item.href}-${item.label}`} href={item.href} className="flex items-center justify-between rounded-xl px-3 py-3 text-sm text-slate-300 hover:bg-white/[0.06] hover:text-white"><span>{isEn ? item.labelEn : t(item.label)}</span>{item.label === "我的收藏" ? <Star className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5 text-slate-600" />}</Link>)}
          </div>
        </div>
      ) : null}
    </div>,
    portalRoot,
  );
}
