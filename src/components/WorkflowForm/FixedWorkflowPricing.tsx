"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function FixedWorkflowPricing({
  name,
  credits,
  locale,
}: {
  name: string;
  credits: number;
  locale: "zh" | "en";
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-workflow-pricing-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#345071] bg-[#101c30] shadow-2xl shadow-black/60"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#263b59] px-5 py-4">
          <h3 id="fixed-workflow-pricing-title" className="text-base font-semibold text-slate-100">
            {locale === "en" ? `${name} pricing` : `${name}价格明细`}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={locale === "en" ? "Close pricing" : "关闭价格明细"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 text-lg text-slate-400 transition-colors hover:border-slate-400 hover:text-white"
          >
            ×
          </button>
        </header>
        <div className="space-y-3 bg-[#0c1729] p-5">
          <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-4 py-4 text-amber-300">
            <span className="block text-xs text-slate-400">
              {locale === "en" ? "Price per generation" : "每次生成价格"}
            </span>
            <strong className="mt-1 block text-lg">
              {credits.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {locale === "en" ? "credits" : "积分"}
            </strong>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            {locale === "en" ? "The final charge is based on the actual completed task." : "最终扣费以任务实际完成后的结算结果为准。"}
          </p>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 inline-flex h-7 items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 text-xs font-medium text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/35"
      >
        <span aria-hidden>¥</span>
        {locale === "en" ? "Pricing" : "价格"}
      </button>
      {dialog}
    </>
  );
}
