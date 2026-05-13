import type { Metadata } from "next";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "管理后台",
  description: "Workflow 平台运营与监控",
};

/** `/admin/*` 根布局：含登录页；具体鉴权与导航在 `(mgmt)/layout`。 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "dark min-h-screen bg-background text-foreground",
        "bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.35_0.12_264/0.35),transparent)]"
      )}
    >
      {children}
    </div>
  );
}
