"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const MIN_PASSWORD = 8;

export function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => {
    const value = searchParams.get("callbackUrl");
    return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
  }, [searchParams]);

  const [email, setEmail] = useState(searchParams.get("email")?.trim() ?? "");
  const [resetKey, setResetKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const signInUrl = `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword.length < MIN_PASSWORD) {
      setError(`新密码至少 ${MIN_PASSWORD} 位`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          reset_key: resetKey,
          new_password: newPassword,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !data.ok) {
        setError(typeof data.error === "string" ? data.error : "密码重置失败，请稍后重试");
        return;
      }

      setMessage(data.message ?? "重置成功");
      setResetKey("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setPending(false);
    }
  }, [confirmPassword, email, newPassword, resetKey]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-neutral-900">重置密码</h1>
        <p className="mt-2 text-center text-sm text-neutral-600">
          填写账号邮箱和管理员预先设置的重置密钥。
        </p>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-900">
            {error}
          </p>
        )}
        {message && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-center text-sm text-emerald-900">
            <p>{message}</p>
            <Link href={signInUrl} className="mt-2 inline-block font-medium underline underline-offset-2">
              返回登录
            </Link>
          </div>
        )}

        {!message && (
          <form className="mt-6 space-y-4" onSubmit={(event) => void submit(event)}>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-neutral-800">邮箱</label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="reset-master-key" className="block text-sm font-medium text-neutral-800">重置密钥</label>
              <input
                id="reset-master-key"
                type="password"
                autoComplete="off"
                required
                value={resetKey}
                onChange={(event) => setResetKey(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="reset-new-password" className="block text-sm font-medium text-neutral-800">新密码</label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
              />
              <p className="mt-1 text-xs text-neutral-500">至少 {MIN_PASSWORD} 位</p>
            </div>
            <div>
              <label htmlFor="reset-confirm-password" className="block text-sm font-medium text-neutral-800">确认新密码</label>
              <input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-emerald-700 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {pending ? "重置中…" : "确认重置密码"}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-neutral-500">
        <Link href={signInUrl} className="hover:text-neutral-800 hover:underline">返回登录</Link>
      </p>
    </div>
  );
}
