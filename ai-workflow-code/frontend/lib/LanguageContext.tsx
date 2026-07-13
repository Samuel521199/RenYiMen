"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { getDefaultLanguage, t, type Language } from "@/lib/i18n";

type LanguageContextValue = {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("zh");

  useEffect(() => {
    setLangState(getDefaultLanguage());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("language", lang);
      document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    }
  }, [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang: setLangState,
      toggleLang: () => setLangState((current) => (current === "zh" ? "en" : "zh")),
      t: (value: string) => t(value, lang),
    }),
    [lang],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) {
    return {
      lang: "zh" as Language,
      setLang: () => undefined,
      toggleLang: () => undefined,
      t: (text: string) => text,
    };
  }
  return value;
}

