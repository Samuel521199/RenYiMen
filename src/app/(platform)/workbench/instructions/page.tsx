// @ts-nocheck
"use client";

import { FormEvent, useEffect, useState } from "react";

import ConfirmDialog from "@workbench/components/common/ConfirmDialog";
import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";

interface WorkflowType {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  active: boolean;
  created_at: string;
}

interface Instruction {
  id: number;
  workflow_type_id: number;
  name: string;
  content: string;
  tags?: string | null;
  active: boolean;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

interface InstructionFormState {
  workflow_type_id: string;
  name: string;
  content: string;
  tags: string;
}

const emptyForm: InstructionFormState = {
  workflow_type_id: "",
  name: "",
  content: "",
  tags: "",
};

function previewContent(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 90) return normalized;
  return `${normalized.slice(0, 90)}...`;
}

function splitTags(tags?: string | null) {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export default function InstructionsPage() {
  const { t } = useLanguage();
  const [workflowTypes, setWorkflowTypes] = useState<WorkflowType[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<InstructionFormState>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<Instruction | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const safeWorkflowTypes = Array.isArray(workflowTypes) ? workflowTypes : [];
  const safeInstructions = Array.isArray(instructions) ? instructions : [];

  async function loadWorkflowTypes() {
    setError("");

    try {
      const res = await apiGet<WorkflowType[]>("/api/workflow-types");
      if (res.code !== 0) {
        setError(res.msg || t("工作流类型加载失败"));
        return;
      }
      const nextWorkflowTypes = Array.isArray(res.data) ? res.data : [];
      setWorkflowTypes(nextWorkflowTypes);
      setSelectedWorkflowId((current) => current || String(nextWorkflowTypes[0]?.id || ""));
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function loadInstructions(workflowTypeId = selectedWorkflowId) {
    if (!workflowTypeId) {
      setInstructions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await apiGet<Instruction[]>(
        `/api/instructions?workflow_type_id=${encodeURIComponent(workflowTypeId)}`
      );
      if (res.code !== 0) {
        setError(res.msg || t("指令列表加载失败"));
        return;
      }
      setInstructions(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkflowTypes();
  }, []);

  useEffect(() => {
    loadInstructions(selectedWorkflowId);
  }, [selectedWorkflowId]);

  function startCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      workflow_type_id: selectedWorkflowId,
    });
    setShowForm(true);
  }

  function startEdit(instruction: Instruction) {
    setEditingId(instruction.id);
    setForm({
      workflow_type_id: String(instruction.workflow_type_id),
      name: instruction.name,
      content: instruction.content,
      tags: instruction.tags || "",
    });
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const payload = {
        workflow_type_id: Number(form.workflow_type_id || selectedWorkflowId),
        name: form.name.trim(),
        content: form.content.trim(),
        tags: form.tags.trim() || null,
      };
      const res = editingId
        ? await apiPut<Instruction>(`/api/instructions/${editingId}`, payload)
        : await apiPost<Instruction>("/api/instructions/create", payload);

      if (res.code !== 0) {
        setError(res.msg || t("保存指令失败"));
        return;
      }

      const nextWorkflowId = String(payload.workflow_type_id);
      cancelForm();
      if (nextWorkflowId !== selectedWorkflowId) {
        setSelectedWorkflowId(nextWorkflowId);
      } else {
        await loadInstructions(selectedWorkflowId);
      }
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleInstruction(instruction: Instruction) {
    setError("");

    try {
      const res = await apiPatch<Instruction>(`/api/instructions/${instruction.id}/toggle`, {});
      if (res.code !== 0) {
        setError(res.msg || t("更新指令状态失败"));
        return;
      }
      const updated = res.data ?? instruction;
      setInstructions((current) =>
        (Array.isArray(current) ? current : []).map((item) =>
          item.id === instruction.id ? { ...item, active: updated.active } : item
        )
      );
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError("");

    try {
      const res = await apiDelete<{ deleted: number }>(`/api/instructions/${deleteTarget.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除指令失败"));
        return;
      }
      setDeleteTarget(null);
      await loadInstructions(selectedWorkflowId);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  return (
    <div>
      <PageHeader
        title={t("指令库")}
        description={t("按工作流管理可复用固定提示词")}
        action={
          <button
            type="button"
            onClick={startCreate}
            disabled={safeWorkflowTypes.length === 0}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("新建指令")}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {safeWorkflowTypes.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            onClick={() => setSelectedWorkflowId(String(workflow.id))}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              selectedWorkflowId === String(workflow.id)
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(workflow.name)}
          </button>
        ))}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="workflow-type">
              {t("工作流类型")}
              </label>
              <select
                id="workflow-type"
                value={form.workflow_type_id}
                onChange={(event) =>
                  setForm((current) => ({ ...current, workflow_type_id: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              >
                {safeWorkflowTypes.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="instruction-name">
              {t("名称")}
              </label>
              <input
                id="instruction-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="instruction-tags">
              {t("标签")}
              </label>
              <input
                id="instruction-tags"
                value={form.tags}
                onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                placeholder={t("高兴,表情")}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="instruction-content">
              {t("指令内容")}
            </label>
            <textarea
              id="instruction-content"
              value={form.content}
              onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))}
              rows={6}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              required
            />
          </div>

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
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? t("保存中...") : editingId ? t("保存修改") : t("创建指令")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("名称")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("内容预览")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("标签")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("状态")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载指令...")}
                </td>
              </tr>
            ) : safeInstructions.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("当前工作流暂无指令")}
                </td>
              </tr>
            ) : (
              safeInstructions.map((instruction) => (
                <tr key={instruction.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {instruction.name}
                  </td>
                  <td className="max-w-md px-4 py-3 text-sm leading-6 text-gray-600">
                    {previewContent(instruction.content)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {splitTags(instruction.tags).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        instruction.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {instruction.active ? t("启用") : t("停用")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => toggleInstruction(instruction)}
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                      >
                        {instruction.active ? t("禁用") : t("启用")}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(instruction)}
                        className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                      >
                        {t("编辑")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(instruction)}
                        className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                      >
                        {t("删除")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("删除指令")}
        description={`${t("确认删除指令")}「${deleteTarget?.name || ""}」？${t("此操作不可恢复。")}`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
