"use client";

import { SessionProvider } from "next-auth/react";
import { LanguageProvider } from "@/i18n";

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LanguageProvider>{children}</LanguageProvider>
    </SessionProvider>
  );
}
