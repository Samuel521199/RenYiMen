"use client";

import { FormEvent, useEffect, useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageHeader from "@/components/common/PageHeader";
import PromptEditor from "@/components/prompt/PromptEditor";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import { PROMPT_MODES } from "@/lib/constants";
import type { PromptMode, PromptTemplate } from "@/lib/types";

interface PromptFormState {
  name: string;
  mode: PromptMode;
  content: string;
  active: boolean;
}

const emptyForm: PromptFormState = {
  name: "",
  mode: "draft",
  content: "Theme: {{theme}}. Scene: {{scene}}. Target size: {{size}}.",
  active: true,
};

export default function PromptsPage() {
  const { t } = useLanguage();
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<PromptFormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const safePrompts = Array.isArray(prompts) ? prompts : [];
  const safePromptModes = Array.isArray(PROMPT_MODES) ? PROMPT_MODES : [];

  async function loadPrompts() {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<PromptTemplate[]>("/api/prompts");
      if (res.code !== 0) {
        setError(res.msg || t("模板列表加载失败"));
        return;
      }
      setPrompts(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPrompts();
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowCreate(true);
  }

  function startEdit(prompt: PromptTemplate) {
    setShowCreate(true);
    setEditingId(prompt.id);
    setForm({
      name: prompt.name,
      mode: prompt.mode,
      content: prompt.content,
      active: prompt.active,
    });
  }

  function cancelForm() {
    setShowCreate(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        name: form.name.trim(),
        mode: form.mode,
        content: form.content,
        active: form.active,
      };
      const res = editingId
        ? await apiPut<PromptTemplate>(`/api/prompts/${editingId}`, payload)
        : await apiPost<PromptTemplate>("/api/prompts/create", payload);

      if (res.code !== 0) {
        setError(res.msg || t("保存模板失败"));
        return;
      }

      cancelForm();
      await loadPrompts();
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError("");

    try {
      const res = await apiDelete<{ deleted: number }>(`/api/prompts/${deleteTarget.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除模板失败"));
        return;
      }
      setDeleteTarget(null);
      await loadPrompts();
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  return (
    <div>
      <PageHeader
        title={t("Prompt 模板")}
        description={t("管理草图探索和定稿生成使用的 Prompt 模板")}
        action={
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            {t("新建模板")}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-name">
                {t("名称")}
              </label>
              <input
                id="prompt-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="prompt-mode">
                {t("类型")}
              </label>
              <select
                id="prompt-mode"
                value={form.mode}
                onChange={(event) =>
                  setForm((current) => ({ ...current, mode: event.target.value as PromptMode }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              >
                {safePromptModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {t(mode.label)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-end gap-2 pb-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) =>
                  setForm((current) => ({ ...current, active: event.target.checked }))
                }
                className="h-4 w-4 rounded border-gray-300"
              />
              {t("启用模板")}
            </label>
          </div>

          <PromptEditor
            value={form.content}
            onChange={(content) => setForm((current) => ({ ...current, content }))}
            variables={["theme", "scene", "size"]}
          />

          <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
              <button
              type="button"
              onClick={cancelForm}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
              {t("取消")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? t("保存中...") : editingId ? t("保存修改") : t("创建模板")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("名称")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("类型")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("启用状态")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载模板...")}
                </td>
              </tr>
            ) : safePrompts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无模板")}
                </td>
              </tr>
            ) : (
              safePrompts.map((prompt) => (
                <tr key={prompt.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{prompt.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{prompt.mode}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        prompt.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {prompt.active ? t("已启用") : t("已停用")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm">
                    <button
                      type="button"
                      onClick={() => startEdit(prompt)}
                      className="font-medium text-gray-900 hover:text-gray-600"
                    >
                      {t("编辑")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(prompt)}
                      className="ml-4 font-medium text-red-600 hover:text-red-700"
                    >
                      {t("删除")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("删除模板")}
        description={`${t("确认删除模板")}「${deleteTarget?.name || ""}」？${t("此操作不可恢复。")}`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
