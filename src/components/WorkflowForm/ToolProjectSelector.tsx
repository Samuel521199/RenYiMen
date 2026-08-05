"use client";

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
        <select
          aria-label={locale === "en" ? "Select project" : "选择项目"}
          value={selectedProjectId ?? ""}
          disabled={loading || projects.length === 0}
          onChange={(event) => onSelect(event.target.value)}
          className="min-h-10 min-w-[12rem] flex-1 rounded-xl border border-white/10 bg-[#0b1526] px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/15 disabled:cursor-wait disabled:opacity-60"
        >
          {loading && <option value="">{locale === "en" ? "Loading projects…" : "正在加载项目…"}</option>}
          {!loading && projects.length === 0 && <option value="">{locale === "en" ? "No project available" : "暂无可用项目"}</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button type="button" onClick={onCreate} disabled={loading} className="min-h-10 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50">
          {locale === "en" ? "+ New" : "+ 新建"}
        </button>
        <button type="button" onClick={onRename} disabled={disabled} className="min-h-10 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-slate-300 transition hover:bg-white/[0.07] disabled:opacity-40">
          {locale === "en" ? "Rename" : "重命名"}
        </button>
        <button type="button" onClick={onDelete} disabled={disabled} className="min-h-10 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-slate-400 transition hover:border-red-400/25 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40">
          {locale === "en" ? "Delete" : "删除"}
        </button>
      </div>
    </section>
  );
}
