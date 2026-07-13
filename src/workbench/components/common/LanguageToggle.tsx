"use client";

import { useLanguage } from "@workbench/lib/LanguageContext";

export default function LanguageToggle() {
  const { lang, toggleLang } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLang}
      className="rounded-md border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5"
    >
      {lang === "zh" ? "EN" : "中文"}
    </button>
  );
}
