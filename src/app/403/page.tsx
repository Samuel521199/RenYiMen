import Link from "next/link";

export const metadata = {
  title: "无权访问",
};

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">403</p>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">无权访问管理后台</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        当前账号不具备管理员权限。若你认为这是错误，请联系平台管理员。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/admin/login"
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground ring-1 ring-foreground/10 transition hover:bg-muted/50"
        >
          管理端账号登录
        </Link>
        <Link
          href="/"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-1 ring-foreground/10 transition hover:opacity-90"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
