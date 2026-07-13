export type AppLocale = "zh" | "en";

export const LOCALE_STORAGE_KEY = "wf-locale";
const LEGACY_LOCALE_STORAGE_KEY = "language";

export function readStoredLocale(): AppLocale {
  if (typeof window === "undefined") return "zh";
  try {
    // 只读平台专属 key，不再继承工作台的 `language` key
    // 工作台的 `language` key 可能是 workbench 内部中英切换的结果，不应影响平台语言
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // ignore
  }
  return "zh";
}

export function writeStoredLocale(locale: AppLocale): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    // 不写 LEGACY_LOCALE_STORAGE_KEY，避免影响工作台的独立语言设置
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
}
