"use client";

// frontend/components/layout/Sidebar.tsx
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_GROUPS } from "@/lib/constants";
import { useLanguage } from "@/lib/LanguageContext";
import { usePermission } from "@/lib/PermissionContext";
import { getSidebarChildLinkClasses, isSidebarItemActive } from "@/lib/sidebar-nav";

const TEMPLATE_CENTER_EXTRA_CHILD = { label: "日常互动图模版", href: "/admin/daily-post-templates" };
const TASK_CENTER_EXTRA_CHILD = { label: "热点借势图", href: "/workflows/trending" };
const TASK_CENTER_NEWS_EXTRA_CHILD = { label: "热点借势·新闻", href: "/workflows/trending-news" };
const TASK_CENTER_LOGO_CHILD = { href: "/workflows/logo", label: "Logo水印" };
const ADMIN_HOTSPOT_IMPORT_CHILD = { label: "热点导入管理", href: "/admin/hotspot-import" };
const MODULE_PERMISSION_BY_HREF: Record<string, string> = {
  "/": "dashboard",
  "/dashboard": "dashboard",
  "/assets": "assets",
  "/review": "review",
  "/gallery": "gallery",
  "/stats": "stats",
  "/gallery/video": "video_gallery",
};
const WORKFLOW_PERMISSION_BY_HREF: Record<string, string> = {
  "/workflows/expression": "expression",
  "/workflows/activity": "activity",
  "/workflows/background": "background",
  "/workflows/daily-post": "daily_post",
  "/workflows/share": "share",
  "/workflows/trending": "trending",
  "/workflows/trending-news": "trending_news",
  "/workflows/video": "video",
  "/videos": "video",
  "/workflows/logo": "logo",
};
const TEMPLATE_PERMISSION_BY_HREF: Record<string, string> = {
  "/instructions": "instructions",
  "/prompts": "prompts",
  "/admin/activity-templates": "activity_templates",
  "/admin/daily-post-templates": "daily_post_templates",
};
const ADMIN_PERMISSION_BY_HREF: Record<string, string> = {
  "/admin/users": "users",
  "/admin/api-keys": "api_keys",
  "/admin/logs": "logs",
  "/admin/models": "models",
  "/admin/hotspot-import": "hotspot_import",
  "/admin/share-instructions": "share_instructions",
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
        { label: "视频工作台", href: "/videos" },
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
      if (!inserted && child.href === "/admin/daily-post-templates") {
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
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-gray-200 px-5">
        <span className="text-base font-bold text-gray-900">{t("AI 图片工作台")}</span>
      </div>

      {/* Nav */}
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
                        ? "bg-gray-900 text-white"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
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
      <div className="border-t border-gray-200 px-5 py-4">
        <p className="text-xs text-gray-400">v1.0.0</p>
      </div>
    </aside>
  );
}
