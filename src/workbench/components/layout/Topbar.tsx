"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LanguageToggle from "@workbench/components/common/LanguageToggle";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { removeToken } from "@workbench/lib/auth";

interface TopbarProps {
  title: string;
}

export default function Topbar({ title }: TopbarProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("viewer");

  useEffect(() => {
    try {
      const token = localStorage.getItem("workbench_token") ?? "";
      if (!token) return;
      const payload = JSON.parse(
        atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
      ) as { username?: string; sub?: string; role?: string };
      setUsername(payload.username ?? payload.sub ?? "");
      setRole(payload.role ?? "viewer");
    } catch {
      setUsername("");
      setRole("viewer");
    }
  }, []);

  function handleLogout() {
    removeToken();
    router.push("/auth/signin");
  }

  return (
    <header className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-slate-200">
            {username || t("未登录")}
          </p>
          <p className="text-xs text-slate-500">{role}</p>
        </div>
        <LanguageToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5"
        >
          {t("退出登录")}
        </button>
      </div>
    </header>
  );
}
