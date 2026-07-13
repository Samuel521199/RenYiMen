"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import { DAILY_POST_BACKGROUNDS, DAILY_POST_BULL_ACTIONS } from "@/lib/constants";

type DailyPostTemplateType = "emotion" | "game" | "choice" | "meme" | "local" | "character";
type DailyPostStyle = "3d_cartoon" | "social";
type DailyPostColorMood = "warm" | "fresh" | "night" | "rainy";
type DailyPostBrandWeight = "light" | "medium";

interface DailyPostTemplate {
  id: number;
  name: string;
  template_type: DailyPostTemplateType;
  title_copy?: string | null;
  interaction_copy?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  bull_action?: string | null;
  background?: string | null;
  style?: string | null;
  color_mood?: string | null;
  brand_weight?: string | null;
  is_enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

interface DailyPostTemplateFormState {
  name: string;
  template_type: DailyPostTemplateType | "";
  title_copy: string;
  interaction_copy: string;
  option_a: string;
  option_b: string;
  option_c: string;
  bull_action: string;
  background: string;
  style: DailyPostStyle | "";
  color_mood: DailyPostColorMood | "";
  brand_weight: DailyPostBrandWeight | "";
  sort_order: string;
}

interface DailyPostTemplateEditorProps {
  form: DailyPostTemplateFormState;
  mode: "create" | "edit";
  saving: boolean;
  onChange: (next: DailyPostTemplateFormState) => void;
  onCancel: () => void;
  onSave: () => void;
}

const TEMPLATE_TYPE_OPTIONS: Array<{ value: DailyPostTemplateType; label: string }> = [
  { value: "emotion", label: "情绪共鸣" },
  { value: "game", label: "游戏情绪" },
  { value: "choice", label: "选择互动" },
  { value: "meme", label: "梗图" },
  { value: "local", label: "本地生活" },
  { value: "character", label: "牛角色日常" },
];

const STYLE_OPTIONS: Array<{ value: DailyPostStyle; label: string }> = [
  { value: "3d_cartoon", label: "3D卡通" },
  { value: "social", label: "社媒风" },
];

const COLOR_OPTIONS: Array<{ value: DailyPostColorMood; label: string }> = [
  { value: "warm", label: "暖" },
  { value: "fresh", label: "清爽" },
  { value: "night", label: "夜晚" },
  { value: "rainy", label: "雨天" },
];

const BRAND_WEIGHT_OPTIONS: Array<{ value: DailyPostBrandWeight; label: string }> = [
  { value: "light", label: "轻" },
  { value: "medium", label: "中" },
];

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
const textareaClass =
  "mt-1 min-h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
const primaryButtonClass =
  "rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300";
const secondaryButtonClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

function emptyForm(): DailyPostTemplateFormState {
  return {
    name: "",
    template_type: "emotion",
    title_copy: "",
    interaction_copy: "",
    option_a: "",
    option_b: "",
    option_c: "",
    bull_action: DAILY_POST_BULL_ACTIONS[0]?.value || "happy",
    background: DAILY_POST_BACKGROUNDS[0]?.value || "rain",
    style: "3d_cartoon",
    color_mood: "warm",
    brand_weight: "light",
    sort_order: "0",
  };
}

function templateToForm(template: DailyPostTemplate): DailyPostTemplateFormState {
  return {
    name: template.name || "",
    template_type: template.template_type || "emotion",
    title_copy: template.title_copy || "",
    interaction_copy: template.interaction_copy || "",
    option_a: template.option_a || "",
    option_b: template.option_b || "",
    option_c: template.option_c || "",
    bull_action: template.bull_action || DAILY_POST_BULL_ACTIONS[0]?.value || "happy",
    background: template.background || DAILY_POST_BACKGROUNDS[0]?.value || "rain",
    style: (template.style as DailyPostStyle) || "3d_cartoon",
    color_mood: (template.color_mood as DailyPostColorMood) || "warm",
    brand_weight: (template.brand_weight as DailyPostBrandWeight) || "light",
    sort_order: String(template.sort_order ?? 0),
  };
}

function formatTemplateType(value?: string | null) {
  return TEMPLATE_TYPE_OPTIONS.find((item) => item.value === value)?.label || value || "-";
}

function formatDisplay(value?: string | null) {
  const text = value?.trim();
  return text ? text : "-";
}

function DailyPostTemplateEditor({
  form,
  mode,
  saving,
  onChange,
  onCancel,
  onSave,
}: DailyPostTemplateEditorProps) {
  const { t } = useLanguage();

  function update<K extends keyof DailyPostTemplateFormState>(key: K, value: DailyPostTemplateFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {mode === "create" ? t("新建模板") : t("编辑模板")}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t("左侧维护文案，右侧维护画面配置。")}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">{t("基础信息")}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("模板名称")}</span>
              <input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("模板类型")}</span>
              <select
                value={form.template_type}
                onChange={(event) => update("template_type", event.target.value as DailyPostTemplateType)}
                className={inputClass}
                required
              >
                <option value="">{t("请选择类型")}</option>
                {TEMPLATE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("排序")}</span>
              <input
                type="number"
                min={0}
                value={form.sort_order}
                onChange={(event) => update("sort_order", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("标题文案")}</span>
              <textarea
                value={form.title_copy}
                onChange={(event) => update("title_copy", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("互动文案")}</span>
              <textarea
                value={form.interaction_copy}
                onChange={(event) => update("interaction_copy", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("选项 A")}</span>
              <input
                value={form.option_a}
                onChange={(event) => update("option_a", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("选项 B")}</span>
              <input
                value={form.option_b}
                onChange={(event) => update("option_b", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("选项 C")}</span>
              <input
                value={form.option_c}
                onChange={(event) => update("option_c", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">{t("画面配置")}</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("牛动作")}</span>
              <select
                value={form.bull_action}
                onChange={(event) => update("bull_action", event.target.value)}
                className={inputClass}
              >
                {DAILY_POST_BULL_ACTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("背景")}</span>
              <select
                value={form.background}
                onChange={(event) => update("background", event.target.value)}
                className={inputClass}
              >
                {DAILY_POST_BACKGROUNDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("风格")}</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {STYLE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      form.style === option.value
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={form.style === option.value}
                      onChange={() => update("style", option.value)}
                    />
                    {t(option.label)}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("颜色")}</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {COLOR_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      form.color_mood === option.value
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={form.color_mood === option.value}
                      onChange={() => update("color_mood", option.value)}
                    />
                    {t(option.label)}
                  </label>
                ))}
              </div>
            </div>
            <div className="md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("品牌感")}</span>
              <div className="mt-2 flex flex-wrap gap-3">
                {BRAND_WEIGHT_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      form.brand_weight === option.value
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-white text-gray-700"
                    }`}
                  >
                    <input
                      type="radio"
                      checked={form.brand_weight === option.value}
                      onChange={() => update("brand_weight", option.value)}
                    />
                    {t(option.label)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          {t("取消")}
        </button>
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? t("保存中...") : t("保存")}
        </button>
      </div>
    </form>
  );
}

export default function AdminDailyPostTemplatesPage() {
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<DailyPostTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<DailyPostTemplateFormState>(emptyForm());
  const [dirty, setDirty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DailyPostTemplate | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [busyTemplateId, setBusyTemplateId] = useState<number | null>(null);

  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingId) || null,
    [editingId, templates],
  );

  const sortedTemplates = useMemo(() => {
    return [...templates].sort((left, right) => {
      const sortDelta = (left.sort_order ?? 0) - (right.sort_order ?? 0);
      if (sortDelta !== 0) return sortDelta;
      return left.id - right.id;
    });
  }, [templates]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<DailyPostTemplate[]>("/api/daily-post/templates");
      if (res.code !== 0) {
        setError(res.msg || t("模板列表加载失败"));
        return;
      }
      setTemplates(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现日常互动图模板接口"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  function startCreate() {
    setEditorMode("create");
    setEditingId(null);
    setForm(emptyForm());
    setDirty(false);
    setError("");
    setNotice("");
  }

  function startEdit(template: DailyPostTemplate) {
    setEditorMode("edit");
    setEditingId(template.id);
    setForm(templateToForm(template));
    setDirty(false);
    setError("");
    setNotice("");
  }

  function closeEditor() {
    setEditorMode(null);
    setEditingId(null);
    setForm(emptyForm());
    setDirty(false);
  }

  function handleCancel() {
    if (dirty && !window.confirm(t("确认取消？未保存的内容将会丢失。"))) {
      return;
    }
    closeEditor();
    setError("");
    setNotice("");
  }

  function buildPayload() {
    const isEnabled = editorMode === "edit" ? editingTemplate?.is_enabled ?? true : true;
    return {
      name: form.name.trim(),
      template_type: form.template_type,
      title_copy: form.title_copy.trim(),
      interaction_copy: form.interaction_copy.trim(),
      option_a: form.option_a.trim(),
      option_b: form.option_b.trim(),
      option_c: form.option_c.trim(),
      bull_action: form.bull_action,
      background: form.background,
      style: form.style,
      color_mood: form.color_mood,
      brand_weight: form.brand_weight,
      sort_order: Number(form.sort_order) || 0,
      is_enabled: isEnabled,
    };
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError(t("请输入模板名称"));
      return;
    }
    if (!form.template_type) {
      setError(t("请选择模板类型"));
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = buildPayload();
      const res =
        editorMode === "edit" && editingId !== null
          ? await apiPut<DailyPostTemplate>(`/api/daily-post/templates/${editingId}`, payload)
          : await apiPost<DailyPostTemplate>("/api/daily-post/templates/create", payload);
      if (res.code !== 0) {
        setError(res.msg || t("保存模板失败"));
        return;
      }
      closeEditor();
      await loadTemplates();
      setNotice(editorMode === "edit" ? t("模板已更新") : t("模板已创建"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleTemplate(template: DailyPostTemplate) {
    setBusyTemplateId(template.id);
    setError("");
    setNotice("");
    try {
      const res = await apiPatch<DailyPostTemplate>(`/api/daily-post/templates/${template.id}/toggle`, {});
      if (res.code !== 0) {
        setError(res.msg || t("更新模板状态失败"));
        return;
      }
      await loadTemplates();
      setNotice(template.is_enabled ? t("模板已禁用") : t("模板已启用"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setBusyTemplateId(null);
    }
  }

  function requestDelete(template: DailyPostTemplate) {
    setDeleteTarget(template);
    setError("");
    setNotice("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await apiDelete(`/api/daily-post/templates/${deleteTarget.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除模板失败"));
        return;
      }
      if (editingId === deleteTarget.id) {
        closeEditor();
      }
      setDeleteTarget(null);
      await loadTemplates();
      setNotice(t("模板已删除"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("日常互动图模板管理")}
        description={t("管理 8 个日常互动图模板，支持文案、画面配置、启用/禁用与排序。")}
        action={
          <button type="button" onClick={startCreate} className={primaryButtonClass}>
            {t("新建模板")}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {editorMode && (
        <DailyPostTemplateEditor
          key={`${editorMode}-${editingId || "new"}`}
          mode={editorMode}
          form={form}
          saving={saving}
          onChange={(next) => {
            setForm(next);
            setDirty(true);
          }}
          onCancel={handleCancel}
          onSave={handleSave}
        />
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("序号")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("模板名称")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("类型")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("标题文案")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("互动方式")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("启用状态")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载日常互动图模板...")}
                </td>
              </tr>
            ) : sortedTemplates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无日常互动图模板")}
                </td>
              </tr>
            ) : (
              sortedTemplates.map((template, index) => (
                <tr key={template.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-semibold text-gray-900">{index + 1}</td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{template.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{formatTemplateType(template.template_type)}</td>
                  <td className="max-w-xs px-4 py-3 text-sm text-gray-700">
                    <span className="block truncate" title={formatDisplay(template.title_copy)}>
                      {formatDisplay(template.title_copy)}
                    </span>
                  </td>
                  <td className="max-w-xs px-4 py-3 text-sm text-gray-700">
                    <span className="block truncate" title={formatDisplay(template.interaction_copy)}>
                      {formatDisplay(template.interaction_copy)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        template.is_enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {template.is_enabled ? t("启用") : t("禁用")}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <button
                      type="button"
                      onClick={() => startEdit(template)}
                      className="font-medium text-blue-600 hover:text-blue-700"
                    >
                      {t("编辑")}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTemplate(template)}
                      disabled={busyTemplateId === template.id}
                      className="ml-4 font-medium text-gray-700 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {template.is_enabled ? t("禁用") : t("启用")}
                    </button>
                    <button
                      type="button"
                      onClick={() => requestDelete(template)}
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
        title={t("删除日常互动图模板")}
        description={`${t("确认删除模板")} ${deleteTarget?.name || ""}？${t("删除后不可恢复。")}`}
        onCancel={() => {
          if (!deleteLoading) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
