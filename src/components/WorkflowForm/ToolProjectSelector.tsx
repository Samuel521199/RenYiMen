"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { ToolProjectRecord } from "@/types/tool-project";

interface ToolProjectSelectorProps {
  projects: ToolProjectRecord[];
  selectedProjectId: string | null;
  loading: boolean;
  saving: boolean;
  locale: "zh" | "en";
  onSelect: (projectId: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export function ToolProjectSelector({
  projects,
  selectedProjectId,
  loading,
  saving,
  locale,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ToolProjectSelectorProps) {
  const disabled = loading || !selectedProjectId;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (loading || projects.length === 0) setMenuOpen(false);
  }, [loading, projects.length]);

  return (
    <section className="rounded-2xl border border-emerald-400/15 bg-gradient-to-r from-emerald-500/[0.07] to-cyan-500/[0.035] p-3.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
            {locale === "en" ? "Project" : "项目"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {locale === "en" ? "Inputs and tasks are saved automatically" : "素材、参数与任务会自动保存"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className={`h-1.5 w-1.5 rounded-full ${saving ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
          {saving ? (locale === "en" ? "Saving" : "保存中") : (locale === "en" ? "Saved" : "已保存")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div ref={menuRef} className="relative min-w-[12rem] flex-1">
          <button
            type="button"
            aria-label={locale === "en" ? "Select project" : "选择项目"}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            disabled={loading || projects.length === 0}
            onClick={() => setMenuOpen((open) => !open)}
            className="group flex min-h-10 w-full items-center gap-2.5 rounded-xl border border-white/[0.1] bg-[#08121d]/90 px-3.5 text-left text-sm text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] outline-none transition-all hover:border-[#9ef5d8]/30 hover:bg-[#0a1722] focus-visible:border-[#9ef5d8]/45 focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/10 disabled:cursor-wait disabled:opacity-55"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-[#9ef5d8]/15 bg-[#9ef5d8]/[0.07] text-[#9ef5d8]/80">
              <FolderOpen className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {loading
                ? (locale === "en" ? "Loading projects…" : "正在加载项目…")
                : selectedProject?.name ?? (locale === "en" ? "No project available" : "暂无可用项目")}
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-white/35 transition-transform duration-200 group-hover:text-[#9ef5d8]/70 ${menuOpen ? "rotate-180" : ""}`} />
          </button>

          {menuOpen && (
            <div
              role="listbox"
              aria-label={locale === "en" ? "Projects" : "项目列表"}
              className="hover-reveal-scrollbar absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 max-h-56 overflow-y-auto rounded-xl border border-[#9ef5d8]/20 bg-[#071018]/[0.98] p-1.5 shadow-[0_18px_48px_-18px_rgba(0,0,0,0.95),0_0_0_1px_rgba(158,245,216,0.025),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur-xl"
            >
              {projects.map((project) => {
                const selected = project.id === selectedProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onSelect(project.id);
                      setMenuOpen(false);
                    }}
                    className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm transition-all ${selected
                      ? "bg-gradient-to-r from-[#9ef5d8]/[0.14] to-[#6bd8c2]/[0.06] text-[#dffdf4] shadow-[inset_0_0_0_1px_rgba(158,245,216,0.12)]"
                      : "text-slate-400 hover:bg-white/[0.055] hover:text-slate-100"
                    }`}
                  >
                    <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-[#9ef5d8]" : "text-white/25"}`} />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-[#9ef5d8]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" onClick={onCreate} disabled={loading} className="min-h-10 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50">
          {locale === "en" ? "+ New" : "+ 新建"}
        </button>
        <button
          type="button"
          onClick={onRename}
          disabled={disabled}
          aria-label={locale === "en" ? "Rename project" : "重命名项目"}
          title={locale === "en" ? "Rename project" : "重命名项目"}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-slate-400 transition hover:border-[#9ef5d8]/25 hover:bg-[#9ef5d8]/[0.08] hover:text-[#9ef5d8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9ef5d8]/20 disabled:opacity-40"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label={locale === "en" ? "Delete project" : "删除项目"}
          title={locale === "en" ? "Delete project" : "删除项目"}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-slate-500 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/20 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
