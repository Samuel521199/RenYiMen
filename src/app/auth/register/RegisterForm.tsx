"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

const MIN_PASSWORD = 8;

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => {
    const c = searchParams.get("callbackUrl");
    if (c?.startsWith("/") && !c.startsWith("//")) return c;
    return "/";
  }, [searchParams]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (password !== confirm) {
        setError("两次输入的密码不一致");
        return;
      }
      if (password.length < MIN_PASSWORD) {
        setError(`密码至少 ${MIN_PASSWORD} 位`);
        return;
      }

      setPending(true);
      try {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password,
            name: name.trim() || undefined,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };

        if (!res.ok || !data.ok) {
          setError(typeof data.error === "string" ? data.error : "注册失败");
          return;
        }

        const sign = await signIn("credentials", {
          email: email.trim().toLowerCase(),
          password,
          redirect: false,
          callbackUrl,
        });
        if (sign?.error) {
          router.push(`/auth/signin?registered=1&callbackUrl=${encodeURIComponent(callbackUrl)}`);
          return;
        }
        if (sign?.ok && sign.url) {
          router.push(sign.url);
        } else {
          router.push(callbackUrl);
        }
        router.refresh();
      } catch {
        setError("网络异常，请稍后重试");
      } finally {
        setPending(false);
      }
    },
    [email, password, confirm, name, callbackUrl, router]
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-neutral-900">注册账号</h1>
        <p className="mt-2 text-center text-sm text-neutral-600">
          已有账号？{" "}
          <Link
            href={`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-medium text-emerald-700 underline-offset-2 hover:underline"
          >
            去登录
          </Link>
        </p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-900">
            {error}
          </p>
        )}

        <form className="mt-6 space-y-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label htmlFor="reg-name" className="block text-sm font-medium text-neutral-800">
              昵称（可选）
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="nickname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="reg-email" className="block text-sm font-medium text-neutral-800">
              邮箱
            </label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="reg-password" className="block text-sm font-medium text-neutral-800">
              密码（至少 {MIN_PASSWORD} 位）
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="reg-confirm" className="block text-sm font-medium text-neutral-800">
              确认密码
            </label>
            <input
              id="reg-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-emerald-700 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {pending ? "提交中…" : "注册并登录"}
          </button>
        </form>
      </div>
      <p className="mt-6 text-center text-xs text-neutral-500">
        <Link href="/" className="hover:text-neutral-800 hover:underline">
          返回首页
        </Link>
      </p>
    </div>
  );
}
