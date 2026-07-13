"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { UserCredits } from "@/components/Sidebar/UserCredits";
import { DiskUsageIndicator } from "@/components/platform/DiskUsageIndicator";
import { useLanguage, useT } from "@/i18n";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const t = useT();
  const { locale, toggleLocale } = useLanguage();

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0f1e] text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0f1728]/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link
            href="/workbench/dashboard"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tracking-wide text-white"
          >
            <span aria-hidden className="text-indigo-300">
              ◈
            </span>
            {t.navWorkbench}
          </Link>

          <div className="flex flex-1 items-center justify-end gap-2">
            <button
              type="button"
              onClick={toggleLocale}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
            >
              {locale === "en" ? "中文" : "EN"}
            </button>

            {session?.user ? (
              <>
                <DiskUsageIndicator />
                <UserCredits refreshKey={0} />
                <span className="hidden max-w-[120px] truncate text-xs text-slate-400 sm:inline">
                  {session.user.email}
                </span>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                  className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
                >
                  {t.signOutBtn}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => signIn()}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                {t.signIn}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1">{children}</div>
    </div>
  );
}
