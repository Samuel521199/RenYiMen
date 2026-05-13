"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export function SignInForm({ showGitHub }: { showGitHub: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(() => {
    const c = searchParams.get("callbackUrl");
    if (c?.startsWith("/") && !c.startsWith("//")) return c;
    return "/";
  }, [searchParams]);

  const registered = searchParams.get("registered") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submitCredentials = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setPending(true);
      try {
        const res = await signIn("credentials", {
          email: email.trim(),
          password,
          redirect: false,
          callbackUrl,
        });
        if (res?.error) {
          setError("邮箱或密码不正确，或该账号尚未设置密码登录。");
          return;
        }
        if (res?.ok && res.url) {
          router.push(res.url);
          router.refresh();
          return;
        }
        router.push(callbackUrl);
        router.refresh();
      } finally {
        setPending(false);
      }
    },
    [email, password, callbackUrl, router]
  );

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-xl font-semibold text-neutral-900">登录</h1>
        <p className="mt-2 text-center text-sm text-neutral-600">
          还没有账号？{" "}
          <Link href="/auth/register" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
            免费注册
          </Link>
        </p>

        {registered && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-sm text-emerald-900">
            注册成功，请使用刚才的邮箱与密码登录。
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-center text-sm text-red-900">
            {error}
          </p>
        )}

        <form className="mt-6 space-y-4" onSubmit={(e) => void submitCredentials(e)}>
          <div>
            <label htmlFor="signin-email" className="block text-sm font-medium text-neutral-800">
              邮箱
            </label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="signin-password" className="block text-sm font-medium text-neutral-800">
              密码
            </label>
            <input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none ring-emerald-600/30 focus:border-emerald-600 focus:ring-2"
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
          >
            {pending ? "登录中…" : "使用邮箱密码登录"}
          </button>
        </form>

        {showGitHub && (
          <div className="mt-6">
            <p className="mb-2 text-center text-xs text-neutral-500">或使用</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void signIn("github", { callbackUrl })}
              className="w-full rounded-md border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-900 hover:bg-neutral-50 disabled:opacity-60"
            >
              GitHub 登录
            </button>
          </div>
        )}
      </div>
      <p className="mt-6 text-center text-xs text-neutral-500">
        <Link href="/" className="hover:text-neutral-800 hover:underline">
          返回首页
        </Link>
      </p>
    </div>
  );
}
