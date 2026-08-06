"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { UserCredits } from "@/components/Sidebar/UserCredits";
import { DiskUsageIndicator } from "@/components/platform/DiskUsageIndicator";
import { useLanguage, useT } from "@/i18n";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const t = useT();
  const { locale, toggleLocale } = useLanguage();
  const isWorkbench = pathname.startsWith("/workbench");

  return (
    <div className={`flex flex-col bg-[#05080d] text-slate-100 ${isWorkbench ? "h-screen overflow-hidden" : "min-h-screen"}`}>
      <header className={`sticky top-0 z-40 shrink-0 border-b backdrop-blur-xl ${isWorkbench ? "border-white/[0.07] bg-[#05080d]/92" : "border-white/10 bg-[#0f1728]/95"}`}>
        <div className={`mx-auto flex max-w-[1800px] items-center gap-4 px-4 sm:px-6 ${isWorkbench ? "h-20" : "h-14"}`}>
          <Link
            href="/workbench/home"
            aria-label={locale === "en" ? "Open home" : "进入首页"}
            className={`group inline-flex shrink-0 items-center gap-2.5 rounded-md px-1.5 py-1 text-xl font-semibold text-white transition-colors hover:bg-white/5 ${isWorkbench ? "tracking-[0.01em]" : "tracking-wide"}`}
          >
              <span aria-hidden className="text-[#9ef5d8] transition-transform duration-300 group-hover:rotate-45">
              ◈
            </span>
            {t.navWorkbench}
          </Link>

          {isWorkbench ? <div id="workbench-top-navigation-root" className="flex h-full min-w-0 flex-1 items-center" /> : <div className="flex-1" />}

          <div className="flex shrink-0 items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={toggleLocale}
              className={`${isWorkbench ? "rounded-full border-white/[0.12] px-3 text-white/65" : "rounded-md border-white/10 px-2 text-slate-300"} border py-1.5 text-sm hover:bg-white/5`}
            >
              {locale === "en" ? "中文" : "EN"}
            </button>

            {session?.user ? (
              <>
                <DiskUsageIndicator size="header" />
                <UserCredits refreshKey={0} size="header" />
                <span className="hidden max-w-[150px] truncate text-sm text-slate-400 sm:inline">
                  {session.user.email}
                </span>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                  className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5"
                >
                  {t.signOutBtn}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => signIn()}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t.signIn}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className={`flex flex-1 ${isWorkbench ? "min-h-0 overflow-hidden" : ""}`}>{children}</div>
    </div>
  );
}
