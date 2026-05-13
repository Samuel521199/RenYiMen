"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fieldClass = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors",
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
  "disabled:cursor-not-allowed disabled:opacity-50"
);

export function AdminLoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/admin/panel/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `登录失败（${res.status}）`);
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 rounded-xl border border-border/80 bg-card/80 p-6 shadow-lg ring-1 ring-border/50 backdrop-blur">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">管理端登录</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          使用控制台专用账号登录。默认开发账号为 <span className="font-mono">admin</span> /{" "}
          <span className="font-mono">admin</span>，生产环境请配置环境变量覆盖。
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="wf-admin-user" className="text-sm font-medium leading-none">
            用户名
          </label>
          <input
            id="wf-admin-user"
            name="username"
            autoComplete="username"
            className={fieldClass}
            value={username}
            onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setUsername(ev.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="wf-admin-pass" className="text-sm font-medium leading-none">
            密码
          </label>
          <input
            id="wf-admin-pass"
            name="password"
            type="password"
            autoComplete="current-password"
            className={fieldClass}
            value={password}
            onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setPassword(ev.target.value)}
            disabled={pending}
            required
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "登录中…" : "登录"}
        </Button>
      </form>
    </div>
  );
}
