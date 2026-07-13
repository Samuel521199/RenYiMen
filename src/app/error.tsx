"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#0a0f1e] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-xl border border-red-500/30 bg-red-950/20 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-red-300">页面发生错误</h2>
          <div className="rounded-lg bg-black/30 p-4 font-mono text-xs text-red-300 break-all whitespace-pre-wrap">
            {error.message || "未知错误"}
            {error.digest && (
              <span className="block mt-2 text-red-500/60">digest: {error.digest}</span>
            )}
          </div>
          <p className="text-xs text-slate-400">
            请截图此页面发给管理员，或尝试以下操作：
          </p>
          <div className="flex gap-3">
            <button
              onClick={reset}
              className="rounded-lg bg-red-700/40 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-700/60 transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => { window.location.href = "/"; }}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-900/30 transition-colors"
            >
              返回首页
            </button>
            <button
              onClick={() => {
                window.localStorage.clear();
                window.location.href = "/auth/signin";
              }}
              className="rounded-lg border border-slate-600/40 px-4 py-2 text-sm font-medium text-slate-400 hover:bg-slate-800/50 transition-colors"
            >
              清除缓存并重新登录
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
