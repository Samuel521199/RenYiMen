"use client";

import { useCallback, useMemo } from "react";

import { useLanguage as useAppLanguage } from "@/i18n";
import { t as translateWorkbench, type Language } from "@workbench/lib/i18n";

type LanguageContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (value: string) => string;
};

/** Workbench 语言与全站 @/i18n 共用同一 locale 状态 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useLanguage(): LanguageContextValue {
  const { locale, setLocale, toggleLocale } = useAppLanguage();
  const lang = (locale === "en" ? "en" : "zh") as Language;

  const setLang = useCallback(
    (next: Language) => {
      setLocale(next);
    },
    [setLocale],
  );

  return useMemo(
    () => ({
      lang,
      setLang,
      toggleLang: toggleLocale,
      t: (value: string) => translateWorkbench(value, lang),
    }),
    [lang, setLang, toggleLocale],
  );
}
