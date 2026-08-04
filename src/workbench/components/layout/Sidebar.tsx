"use client";

// frontend/components/layout/Sidebar.tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { NAV_GROUPS } from "@workbench/lib/constants";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { usePermission } from "@workbench/lib/PermissionContext";
import { getSidebarChildLinkClasses, isSidebarItemActive } from "@workbench/lib/sidebar-nav";

const TEMPLATE_CENTER_EXTRA_CHILD = { label: "日常互动图模版", href: "/workbench/admin/daily-post-templates" };
const TASK_CENTER_EXTRA_CHILD = { label: "热点借势图", href: "/workbench/workflows/trending" };
const TASK_CENTER_NEWS_EXTRA_CHILD = { label: "热点借势·新闻", href: "/workbench/workflows/trending-news" };
const TASK_CENTER_LOGO_CHILD = { href: "/workbench/workflows/logo", label: "Logo水印" };
const ADMIN_HOTSPOT_IMPORT_CHILD = { label: "热点导入管理", href: "/workbench/admin/hotspot-import" };
const DEFAULT_SIDEBAR_WIDTH = 224;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 420;
const SIDEBAR_WIDTH_STORAGE_KEY = "workbench-sidebar-width";

function clampSidebarWidth(width: number): number {
  const viewportLimit = typeof window === "undefined"
    ? MAX_SIDEBAR_WIDTH
    : Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - 480);
  return Math.round(Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), Math.min(MAX_SIDEBAR_WIDTH, viewportLimit)));
}
const MODULE_PERMISSION_BY_HREF: Record<string, string> = {
  "/": "dashboard",
  "/workbench/assets": "assets",
  "/workbench/review": "review",
  "/workbench/gallery": "gallery",
  "/workbench/stats": "stats",
  "/workbench/gallery/video": "video_gallery",
};
const WORKFLOW_PERMISSION_BY_HREF: Record<string, string> = {
  "/workbench/workflows/expression": "expression",
  "/workbench/workflows/activity": "activity",
  "/workbench/workflows/background": "background",
  "/workbench/workflows/multi-fusion": "multi_fusion",
  "/workbench/workflows/daily-post": "daily_post",
  "/workbench/workflows/share": "share",
  "/workbench/workflows/trending": "trending",
  "/workbench/workflows/trending-news": "trending_news",
  "/workbench/workflows/video": "video",
  "/workbench/videos": "video",
  "/workbench/workflows/logo": "logo",
};
const TEMPLATE_PERMISSION_BY_HREF: Record<string, string> = {
  "/workbench/instructions": "instructions",
  "/workbench/prompts": "prompts",
  "/workbench/admin/activity-templates": "activity_templates",
  "/workbench/admin/daily-post-templates": "daily_post_templates",
};
const ADMIN_PERMISSION_BY_HREF: Record<string, string> = {
  "/workbench/admin/users": "users",
  "/workbench/admin/api-keys": "api_keys",
  "/workbench/admin/logs": "logs",
  "/workbench/admin/models": "models",
  "/workbench/admin/hotspot-import": "hotspot_import",
  "/workbench/admin/share-instructions": "share_instructions",
  "/workbench/admin/usage-stats": "logs",
};
const SIDEBAR_NAV_GROUPS = (Array.isArray(NAV_GROUPS) ? NAV_GROUPS : []).map((item) => {
  const children = Array.isArray(item.children) ? item.children : [];

  if (item.label === "任务中心") {
    return {
      ...item,
      children: [
        ...children,
        TASK_CENTER_EXTRA_CHILD,
        TASK_CENTER_NEWS_EXTRA_CHILD,
        TASK_CENTER_LOGO_CHILD,
        { label: "视频工作台", href: "/workbench/videos" },
      ],
    };
  }

  if (item.label === "模版中心") {
    return {
      ...item,
      children: [...children, TEMPLATE_CENTER_EXTRA_CHILD],
    };
  }

  if (children.some((child) => child.href.startsWith("/admin"))) {
    const nextChildren: Array<{ label: string; href: string }> = [];
    let inserted = false;
    children.forEach((child) => {
      nextChildren.push(child);
      if (!inserted && child.href === "/workbench/admin/daily-post-templates") {
        nextChildren.push(ADMIN_HOTSPOT_IMPORT_CHILD);
        inserted = true;
      }
    });
    if (!inserted) {
      nextChildren.push(ADMIN_HOTSPOT_IMPORT_CHILD);
    }
    return {
      ...item,
      children: nextChildren,
    };
  }

  return item;
});

export default function Sidebar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { canView, canViewWorkflow, canViewTemplate, canViewAdmin } = usePermission();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const widthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const previousBodyStylesRef = useRef<{ cursor: string; userSelect: string } | null>(null);
  const isGeneralWorkspace = pathname.startsWith("/workbench/tools");
  const workspaceNavGroups = SIDEBAR_NAV_GROUPS.filter((item) =>
    isGeneralWorkspace
      ? item.href === "/workbench/tools"
      : item.href !== "/workbench/tools",
  );

  const applySidebarWidth = (width: number, persist = false) => {
    const nextWidth = clampSidebarWidth(width);
    widthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    if (persist) window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
  };

  const finishResize = () => {
    if (!resizeStartRef.current) return;
    resizeStartRef.current = null;
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(widthRef.current));
    const previous = previousBodyStylesRef.current;
    if (previous) {
      document.body.style.cursor = previous.cursor;
      document.body.style.userSelect = previous.userSelect;
      previousBodyStylesRef.current = null;
    }
  };

  useEffect(() => {
    const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
    if (Number.isFinite(storedWidth) && storedWidth > 0) applySidebarWidth(storedWidth);

    const handleWindowResize = () => applySidebarWidth(widthRef.current);
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (previousBodyStylesRef.current) {
        document.body.style.cursor = previousBodyStylesRef.current.cursor;
        document.body.style.userSelect = previousBodyStylesRef.current.userSelect;
      }
    };
  }, []);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = { pointerX: event.clientX, width: widthRef.current };
    previousBodyStylesRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = resizeStartRef.current;
    if (!start) return;
    applySidebarWidth(start.width + event.clientX - start.pointerX);
  };

  const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishResize();
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = widthRef.current - 16;
    if (event.key === "ArrowRight") nextWidth = widthRef.current + 16;
    if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH;
    if (event.key === "End") nextWidth = MAX_SIDEBAR_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    applySidebarWidth(nextWidth, true);
  };

  return (
    <aside
      className="relative z-30 flex h-full min-h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-white/10 bg-[#0f1728]"
      style={{ width: sidebarWidth }}
    >
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {workspaceNavGroups.map((item) => {
            const rawChildren = Array.isArray(item.children) ? item.children : [];
            let children = rawChildren;
            if (item.label === "任务中心") {
              if (!canView("tasks")) return null;
              children = rawChildren.filter((child) => {
                const key = WORKFLOW_PERMISSION_BY_HREF[child.href];
                return key ? canViewWorkflow(key) : false;
              });
              if (children.length === 0) return null;
            } else if (item.label === "模版中心") {
              if (!canView("templates")) return null;
              children = rawChildren.filter((child) => {
                const key = TEMPLATE_PERMISSION_BY_HREF[child.href];
                return key ? canViewTemplate(key) : false;
              });
              if (children.length === 0) return null;
            } else if (item.label === "管理后台") {
              if (!canView("admin")) return null;
              children = rawChildren.filter((child) => {
                const key = ADMIN_PERMISSION_BY_HREF[child.href];
                return key ? canViewAdmin(key) : false;
              });
              if (children.length === 0) return null;
            } else if (item.href) {
              const key = MODULE_PERMISSION_BY_HREF[item.href];
              if (key && !canView(key)) return null;
            }
            const hasChildren = children.length > 0;
            const childActive = children.some((child) => isSidebarItemActive(pathname, child.href));
            const isActive = item.href ? isSidebarItemActive(pathname, item.href) || childActive : childActive;
            const isOpen = Boolean(openGroups[item.label] || childActive);

            if (hasChildren) {
              return (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroups((current) => ({
                        ...current,
                        [item.label]: !isOpen,
                      }))
                    }
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30"
                        : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                  >
                    <span>{t(item.label)}</span>
                    <span className="text-xs">{isOpen ? "⌃" : "⌄"}</span>
                  </button>
                  {isOpen && (
                    <ul className="mt-1 space-y-1 pl-4">
                      {children.map((child) => {
                        const isChildActive = isSidebarItemActive(pathname, child.href);
                        return (
                          <li key={child.href}>
                            <Link
                              href={child.href}
                              className={getSidebarChildLinkClasses(isChildActive)}
                            >
                              {t(child.label)}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            }

            if (!item.href) {
              return null;
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-indigo-500/20 text-indigo-200 ring-1 ring-indigo-400/30"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  {t(item.label)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 px-5 py-4">
        <p className="text-xs text-slate-500">v1.0.0</p>
      </div>

      <div
        role="separator"
        aria-label={t("调整侧边栏宽度")}
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        title={t("拖动调整宽度，双击恢复默认")}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        onLostPointerCapture={finishResize}
        onKeyDown={handleResizeKeyDown}
        onDoubleClick={() => applySidebarWidth(DEFAULT_SIDEBAR_WIDTH, true)}
        className="group absolute -right-1 top-0 z-50 h-full w-2 cursor-col-resize touch-none outline-none"
      >
        <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-emerald-400/0 transition-all duration-200 group-hover:bg-emerald-400/55 group-focus-visible:w-0.5 group-focus-visible:bg-emerald-400/80 group-active:w-0.5 group-active:bg-emerald-300" />
      </div>
    </aside>
  );
}

