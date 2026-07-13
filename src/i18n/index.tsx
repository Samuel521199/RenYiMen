"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { translations, type Locale, type TranslationDict } from "./translations";
import { readStoredLocale, writeStoredLocale } from "@/lib/locale-preference";

interface LanguageContextValue {
  locale: Locale;
  t: TranslationDict;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: "zh",
  t: translations.zh,
  setLocale: () => undefined,
  toggleLocale: () => undefined,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("zh");

  // 首次挂载时从 localStorage 恢复偏好（兼容旧 workbench `language` 键）
  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writeStoredLocale(l);
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === "zh" ? "en" : "zh");
  }, [locale, setLocale]);

  return (
    <LanguageContext.Provider
      value={{ locale, t: translations[locale], setLocale, toggleLocale }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

/** 获取当前翻译字典及语言操作 */
export function useLanguage() {
  return useContext(LanguageContext);
}

/** 仅需翻译字典时的简写 hook */
export function useT() {
  return useContext(LanguageContext).t;
}
