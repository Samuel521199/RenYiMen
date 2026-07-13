"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import LanguageToggle from "@/components/common/LanguageToggle";
import { useLanguage } from "@/lib/LanguageContext";
import { removeToken } from "@/lib/auth";

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
      const token = localStorage.getItem("token") ?? "";
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
    router.push("/login");
  }

  return (
    <header className="mb-6 flex items-center justify-between border-b border-gray-200 bg-gray-50 pb-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-900">
            {username || t("未登录")}
          </p>
          <p className="text-xs text-gray-500">{role}</p>
        </div>
        <LanguageToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
        >
          {t("退出登录")}
        </button>
      </div>
    </header>
  );
}
