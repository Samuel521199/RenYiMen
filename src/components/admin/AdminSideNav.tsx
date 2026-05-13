"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LayoutDashboard, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "运营仪表盘", icon: LayoutDashboard },
  { href: "/admin/stats", label: "经营分析", icon: BarChart3 },
  { href: "/admin/users", label: "用户与充值", icon: Users },
] as const;

export function AdminSideNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-16 space-y-0.5 border-b border-border/50 pb-6 md:border-b-0 md:pb-0">
      <p className="mb-2 hidden px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">
        导航
      </p>
      {items.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/admin"
            ? pathname === "/admin" || pathname === "/admin/"
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0 opacity-80" aria-hidden />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
