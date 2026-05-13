import Link from "next/link";
import { redirect } from "next/navigation";
import { getAdminAccess } from "@/lib/admin-access";
import { AdminMgmtLogoutButton } from "@/components/admin/AdminMgmtLogoutButton";
import { AdminSideNav } from "@/components/admin/AdminSideNav";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export default async function AdminMgmtLayout({ children }: { children: React.ReactNode }) {
  const access = await getAdminAccess();
  if (!access.ok) {
    redirect("/admin/login");
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
              W
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-tight">Workflow 控制台</p>
              <p className="text-[11px] text-muted-foreground">Billing & API 运营中心</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline" title={access.via === "panel" ? "管理端独立登录" : undefined}>
              {access.label}
              {access.via === "panel" ? (
                <span className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  panel
                </span>
              ) : null}
            </span>
            <Separator orientation="vertical" className="h-4" />
            <AdminMgmtLogoutButton />
            <Separator orientation="vertical" className="h-4" />
            <Link href="/" className="font-medium text-foreground/90 underline-offset-4 hover:underline">
              返回站点
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-0 md:flex-row md:gap-0">
        <aside className="shrink-0 border-border/60 px-4 pt-2 md:w-52 md:border-r md:px-0 md:pt-0 md:pl-4">
          <AdminSideNav />
        </aside>
        <div className={cn("min-w-0 flex-1 px-4 py-6 sm:px-6 md:py-8")}>{children}</div>
      </div>
    </>
  );
}
