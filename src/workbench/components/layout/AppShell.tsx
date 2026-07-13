"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import Topbar from "@workbench/components/layout/Topbar";
import Sidebar from "@workbench/components/layout/Sidebar";
import { useLanguage } from "@workbench/lib/LanguageContext";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { lang } = useLanguage();
  const pathname = usePathname();
  const isLoginPage = pathname === "/auth/signin";

  if (isLoginPage) {
    return <main className="min-h-screen bg-gray-50">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar title={lang === "zh" ? "AI 社媒图片生产工作台" : "AI Social Media Workbench"} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
