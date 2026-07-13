"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { apiPost } from "@/lib/api";
import { setToken } from "@/lib/auth";
import { useLanguage } from "@/lib/LanguageContext";

interface LoginResponse {
  token: string;
}

export default function LoginPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const res = await apiPost<LoginResponse>("/api/auth/login", {
        username,
        password,
      });

      if (res.code !== 0 || !res.data?.token) {
        setError(res.msg || t("登录失败，请检查用户名和密码"));
        return;
      }

      setToken(res.data.token);
      router.replace("/dashboard");
    } catch {
      setError(t("无法连接后端服务，请稍后重试"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">{t("登录工作台")}</h1>
          <p className="mt-1 text-sm text-gray-500">{t("进入 AI 社媒图片生产工作台")}</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="username">
              {t("用户名")}
            </label>
            <input
              id="username"
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              placeholder={t("用户名")}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              {t("密码")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              placeholder={t("密码")}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {submitting ? t("登录中...") : t("登录")}
          </button>
        </form>
      </div>
    </div>
  );
}
