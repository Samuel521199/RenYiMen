"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { Archive, Box, ChevronDown, Film, History, ImageIcon, Music2, Star } from "lucide-react";
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
                <div className="group/account relative hidden sm:block">
                  <button type="button" className="flex max-w-[190px] items-center gap-1.5 rounded-lg border border-transparent px-2 py-2 text-sm text-slate-400 transition hover:border-white/[0.08] hover:bg-white/[0.035] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/40">
                    <span className="truncate">{session.user.email}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover/account:rotate-180" />
                  </button>
                  <div className="invisible absolute right-0 top-full z-[120] w-[390px] translate-y-1 pt-3 opacity-0 transition-all duration-200 group-hover/account:visible group-hover/account:translate-y-0 group-hover/account:opacity-100 group-focus-within/account:visible group-focus-within/account:translate-y-0 group-focus-within/account:opacity-100">
                    <div className="overflow-hidden rounded-2xl border border-white/[0.11] bg-[linear-gradient(145deg,rgba(15,20,27,.99),rgba(6,9,14,.995))] p-3 shadow-[0_28px_80px_rgba(0,0,0,.62),inset_0_1px_0_rgba(255,255,255,.045)]">
                      <div className="flex items-center justify-between px-2 pb-3 pt-1">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Archive className="h-4 w-4 text-[#9ef5d8]" />{locale === "en" ? "Personal asset library" : "个人资产库"}</div>
                          <p className="mt-1 text-[11px] text-white/35">{locale === "en" ? "Find every successful generation" : "找回所有成功生成的内容"}</p>
                        </div>
                        <Link href="/workbench/assets/history" className="text-[11px] font-medium text-[#9ef5d8]/80 hover:text-[#b8ffe8]">{locale === "en" ? "View all" : "查看全部"}</Link>
                      </div>
                      <Link href="/workbench/assets/history" className="group/item flex items-center gap-3 rounded-xl border border-[#9ef5d8]/[0.13] bg-[#9ef5d8]/[0.055] p-3 transition hover:border-[#9ef5d8]/30 hover:bg-[#9ef5d8]/[0.09]">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9ef5d8]/10 text-[#9ef5d8]"><History className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white/90">{locale === "en" ? "Generation history" : "生成历史"}</span><span className="mt-0.5 block text-[11px] text-white/35">{locale === "en" ? "Browse earlier results by time" : "按时间查看以前的全部结果"}</span></span>
                      </Link>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          { type: "image", label: locale === "en" ? "Images" : "图片资产", icon: ImageIcon, color: "text-cyan-300 bg-cyan-300/10" },
                          { type: "video", label: locale === "en" ? "Videos" : "视频资产", icon: Film, color: "text-violet-300 bg-violet-300/10" },
                          { type: "audio", label: locale === "en" ? "Audio" : "音频资产", icon: Music2, color: "text-emerald-300 bg-emerald-300/10" },
                          { type: "model", label: locale === "en" ? "3D models" : "3D 资产", icon: Box, color: "text-amber-300 bg-amber-300/10" },
                        ].map((item) => {
                          const ItemIcon = item.icon;
                          return <Link key={item.type} href={`/workbench/assets/history?type=${item.type}`} className="flex items-center gap-2.5 rounded-xl border border-white/[0.075] bg-white/[0.018] p-2.5 text-xs text-white/55 transition hover:border-white/[0.16] hover:bg-white/[0.045] hover:text-white/85"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${item.color}`}><ItemIcon className="h-4 w-4" /></span>{item.label}</Link>;
                        })}
                      </div>
                      <div className="mt-3 border-t border-white/[0.075] pt-2">
                        <Link href="/workbench/tools?group=favorites" className="flex items-center gap-2 rounded-lg px-2 py-2 text-xs text-white/45 transition hover:bg-white/[0.035] hover:text-white/75"><Star className="h-4 w-4" />{locale === "en" ? "My favorites" : "我的收藏"}</Link>
                      </div>
                    </div>
                  </div>
                </div>
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
