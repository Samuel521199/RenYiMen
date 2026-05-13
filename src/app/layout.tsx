import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { AppSessionProvider } from "@/app/providers";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Workflow",
  description: "AI workflow SaaS — schema-driven ComfyUI / RunningHub front end",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen antialiased">
        <AppSessionProvider>{children}</AppSessionProvider>
      </body>
    </html>
  );
}
