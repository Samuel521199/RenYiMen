"use client";

// frontend/components/layout/Sidebar.tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_GROUPS } from "@workbench/lib/constants";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { usePermission } from "@workbench/lib/PermissionContext";
import { getSidebarChildLinkClasses, isSidebarItemActive } from "@workbench/lib/sidebar-nav";

const TEMPLATE_CENTER_EXTRA_CHILD = { label: "日常互动图模版", href: "/workbench/admin/daily-post-templates" };
const TASK_CENTER_EXTRA_CHILD = { label: "热点借势图", href: "/workbench/workflows/trending" };
const TASK_CENTER_NEWS_EXTRA_CHILD = { label: "热点借势·新闻", href: "/workbench/workflows/trending-news" };
const TASK_CENTER_LOGO_CHILD = { href: "/workbench/workflows/logo", label: "Logo水印" };
const ADMIN_HOTSPOT_IMPORT_CHILD = { label: "热点导入管理", href: "/workbench/admin/hotspot-import" };
const MODULE_PERMISSION_BY_HREF: Record<string, string> = {
  "/": "dashboard",
  "/workbench/dashboard": "dashboard",
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

  return (
    <aside className="relative z-30 flex h-full min-h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col border-r border-white/10 bg-[#0f1728]">
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {SIDEBAR_NAV_GROUPS.map((item) => {
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
            const isActive = item.href ? pathname === item.href || childActive : childActive;
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
    </aside>
  );
}
