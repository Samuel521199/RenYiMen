"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { LanguageProvider } from "@workbench/lib/LanguageContext";
import { PermissionProvider, usePermission } from "@workbench/lib/PermissionContext";
import WorkbenchSidebar from "@workbench/components/layout/Sidebar";
import { syncWorkbenchTokenFromSession } from "@workbench/lib/auth";

function WorkbenchAuthSync({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { status } = useSession();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const doSync = async () => {
    const result = await syncWorkbenchTokenFromSession();
    if (!result.ok) {
      setError(result.reason ?? "Workbench SSO 失败，请检查服务端配置");
    } else {
      setError(null);
    }
    setReady(true);
    setRetrying(false);
  };

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.replace("/auth/signin?callbackUrl=/workbench/dashboard");
      return;
    }
    void doSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, router]);

  const handleRetry = () => {
    setReady(false);
    setRetrying(true);
    void doSync();
  };

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
        {retrying ? "正在重新连接…" : "Loading workbench…"}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200 space-y-3">
          <p className="font-semibold text-red-300">⚠ Workbench 登录失败</p>
          <p className="break-all">{error}</p>
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleRetry}
              className="rounded-lg bg-red-700/40 px-4 py-1.5 text-xs font-medium text-red-100 hover:bg-red-700/60 transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => router.replace("/auth/signin")}
              className="rounded-lg border border-red-500/30 px-4 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/30 transition-colors"
            >
              重新登录
            </button>
          </div>
          <p className="text-[11px] text-red-400/70">
            如问题持续请联系管理员，并提供以上错误信息。
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * 权限守卫：检查用户是否有任何工作台模块权限。
 * - 工具页（/workbench/tools）始终放行，无论权限如何
 * - 管理员始终放行
 * - 权限加载中时不拦截（等待 PermissionContext 就绪）
 * - 无任何权限时显示"联系管理员授权"提示，但保留侧边栏和工具入口
 */
function WorkbenchPermissionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { permissions, isAdmin } = usePermission();

  // 工具页始终放行
  const isTools = pathname.startsWith("/workbench/tools");
  if (isTools) return <>{children}</>;

  // 管理员无限制
  if (isAdmin) return <>{children}</>;

  // 权限尚未加载完成（null = 还在请求中），显示加载占位而不是放行内容
  if (permissions === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
        正在验证权限…
      </div>
    );
  }

  // 判断是否拥有至少一个模块权限
  const modules = permissions.modules;
  const hasAnyPermission =
    modules.dashboard ||
    modules.assets ||
    modules.review ||
    modules.gallery ||
    modules.stats ||
    modules.video_gallery ||
    modules.tasks?.visible ||
    modules.templates?.visible ||
    modules.admin?.visible;

  if (!hasAnyPermission) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-800">
          <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-100">暂无工作台权限</h2>
          <p className="max-w-sm text-sm text-slate-400">
            您的账号尚未获得工作台功能授权，请联系管理员开通相应权限后再使用。
          </p>
        </div>
        <a
          href="/workbench/tools"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          前往工具页使用工作流
        </a>
        <p className="text-xs text-slate-500">
          工具页的所有 AI 工作流无需额外权限，可直接使用。
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

export default function WorkbenchProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isTools = pathname.startsWith("/workbench/tools");

  return (
    <LanguageProvider>
      <PermissionProvider>
        <WorkbenchAuthSync>
          <div className="relative z-0 flex min-h-[calc(100vh-3.5rem)] w-full bg-[#0a0f1e]">
            <WorkbenchSidebar />
            <div className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden bg-[#0a0f1e] text-slate-100">
              <main
                className={`workbench-content ${isTools ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto p-6"}`}
              >
                <WorkbenchPermissionGuard>
                  {children}
                </WorkbenchPermissionGuard>
              </main>
            </div>
          </div>
        </WorkbenchAuthSync>
      </PermissionProvider>
    </LanguageProvider>
  );
}
