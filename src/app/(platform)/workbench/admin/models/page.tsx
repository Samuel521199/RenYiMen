// @ts-nocheck
"use client";

import { Fragment, FormEvent, useEffect, useState } from "react";

import ConfirmDialog from "@workbench/components/common/ConfirmDialog";
import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { MODEL_PROVIDERS } from "@workbench/lib/constants";
import {
  buildModelConfigCreatePayload,
  buildModelConfigUpdatePayload,
  emptyModelConfigForm,
  modelConfigToFormState,
  type ModelConfigFormState,
  type ModelUsageType,
} from "@workbench/lib/model-config-form";
import type { ModelProvider } from "@workbench/lib/types";

const MODEL_USAGE_OPTIONS: Array<{ value: ModelUsageType; label: string }> = [
  { value: "draft", label: "低价探索" },
  { value: "final", label: "高价定稿" },
  { value: "both", label: "通用" },
];

const MODEL_PURPOSE_OPTIONS = [
  { value: "image", zh: "图片生成", en: "Image" },
  { value: "video_draft", zh: "视频草稿探索", en: "Video Draft" },
  { value: "video_final", zh: "视频精品生成", en: "Video Final" },
  { value: "video_analysis", zh: "视频分析", en: "Video Analysis" },
] as const;

interface ModelConfig {
  id: number;
  name: string;
  provider: ModelProvider | string;
  model_name: string;
  purpose?: string | null;
  usage_type?: ModelUsageType | string | null;
  api_key: string;
  base_url?: string | null;
  price_per_image: number | string;
  daily_limit: number | string;
  used_today: number | string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function normalizeModels(payload: ModelConfig[] | undefined): ModelConfig[] {
  return Array.isArray(payload) ? payload : [];
}

function maskKey(value?: string) {
  if (!value) return "****";
  if (value.includes("****")) return value;
  return `****${value.slice(-4)}`;
}

function formatNumber(value: number | string | undefined, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatUsageType(value?: string | null) {
  return MODEL_USAGE_OPTIONS.find((option) => option.value === value)?.label || "通用";
}

type ExtendedModelConfigFormState = ModelConfigFormState & {
  purpose: string;
};

const DEFAULT_MODEL_PURPOSE = "image";

function withPurpose(form: ModelConfigFormState): ExtendedModelConfigFormState {
  return { ...form, purpose: DEFAULT_MODEL_PURPOSE };
}

function toExtendedModelConfigFormState(model: ModelConfig): ExtendedModelConfigFormState {
  return { ...modelConfigToFormState(model), purpose: model.purpose || DEFAULT_MODEL_PURPOSE };
}

interface ModelConfigFormFieldsProps {
  formIdPrefix: string;
  form: ExtendedModelConfigFormState;
  providers: typeof MODEL_PROVIDERS;
  apiKeyRequired?: boolean;
  apiKeyPlaceholder?: string;
  onChange: (form: ExtendedModelConfigFormState) => void;
}

function ModelConfigFormFields({
  formIdPrefix,
  form,
  providers,
  apiKeyRequired = false,
  apiKeyPlaceholder,
  onChange,
}: ModelConfigFormFieldsProps) {
  const { t, lang } = useLanguage();

  function update<K extends keyof ExtendedModelConfigFormState>(key: K, value: ExtendedModelConfigFormState[K]) {
    onChange({ ...form, [key]: value });
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor={`${formIdPrefix}-name`}>
          {t("名称")}
        </label>
        <input
          id={`${formIdPrefix}-name`}
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          placeholder="GPT Image 1"
          required
        />
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-provider`}
        >
          {t("供应商")}
        </label>
        <select
          id={`${formIdPrefix}-provider`}
          value={form.provider}
          onChange={(event) => update("provider", event.target.value as ModelProvider)}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        >
          {providers.map((provider) => (
            <option key={provider.value} value={provider.value}>
              {t(provider.label)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700" htmlFor={`${formIdPrefix}-model`}>
          {t("模型")}
        </label>
        <input
          id={`${formIdPrefix}-model`}
          value={form.model_name}
          onChange={(event) => update("model_name", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          required
        />
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-purpose`}
        >
          {t("用途")}
        </label>
        <select
          id={`${formIdPrefix}-purpose`}
          value={form.purpose}
          onChange={(event) => update("purpose", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        >
          {MODEL_PURPOSE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {lang === "zh" ? option.zh : option.en}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-usage-type`}
        >
          {t("使用类型")}
        </label>
        <select
          id={`${formIdPrefix}-usage-type`}
          value={form.usage_type}
          onChange={(event) => update("usage_type", event.target.value as ModelUsageType)}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        >
          {MODEL_USAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-price-per-image`}
        >
          {t("每张成本")}
        </label>
        <input
          id={`${formIdPrefix}-price-per-image`}
          type="number"
          min="0"
          step="0.000001"
          value={form.price_per_image}
          onChange={(event) => update("price_per_image", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />
      </div>
      <div className="md:col-span-2">
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-api-key`}
        >
          API Key
        </label>
        <input
          id={`${formIdPrefix}-api-key`}
          value={form.api_key}
          onChange={(event) => update("api_key", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          placeholder={apiKeyPlaceholder}
          required={apiKeyRequired}
        />
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-daily-limit`}
        >
          {t("每日限额")}
        </label>
        <input
          id={`${formIdPrefix}-daily-limit`}
          type="number"
          min="0"
          step="0.01"
          value={form.daily_limit}
          onChange={(event) => update("daily_limit", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />
      </div>
      <div>
        <label
          className="block text-sm font-medium text-gray-700"
          htmlFor={`${formIdPrefix}-base-url`}
        >
          Base URL
        </label>
        <input
          id={`${formIdPrefix}-base-url`}
          value={form.base_url}
          onChange={(event) => update("base_url", event.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          placeholder="https://..."
        />
      </div>
    </div>
  );
}

export default function AdminModelsPage() {
  const { t } = useLanguage();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ExtendedModelConfigFormState>(withPurpose(emptyModelConfigForm));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ExtendedModelConfigFormState>(withPurpose(emptyModelConfigForm));
  const [deleteTarget, setDeleteTarget] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const safeModels = Array.isArray(models) ? models : [];
  const safeModelProviders = Array.isArray(MODEL_PROVIDERS) ? MODEL_PROVIDERS : [];

  async function loadModels() {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<ModelConfig[]>("/api/model-configs");
      if (res.code !== 0) {
        setError(res.msg || t("模型配置加载失败"));
        return;
      }
      setModels(normalizeModels(res.data));
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现 /api/model-configs"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadModels();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await apiPost<ModelConfig>(
        "/api/model-configs/create",
        { ...buildModelConfigCreatePayload(form), purpose: form.purpose },
      );

      if (res.code !== 0) {
        setError(res.msg || t("添加模型失败"));
        return;
      }

      setForm(withPurpose(emptyModelConfigForm));
      setShowCreate(false);
      await loadModels();
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现 /api/model-configs/create"));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(model: ModelConfig) {
    setShowCreate(false);
    setEditingId(model.id);
    setEditForm(toExtendedModelConfigFormState(model));
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(withPurpose(emptyModelConfigForm));
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingId === null) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await apiPut<ModelConfig>(
        `/api/model-configs/${editingId}`,
        { ...buildModelConfigUpdatePayload(editForm), purpose: editForm.purpose },
      );

      if (res.code !== 0) {
        setError(res.msg || t("更新模型失败"));
        return;
      }

      cancelEdit();
      await loadModels();
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现 /api/model-configs/{id}"));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleModel(model: ModelConfig) {
    setError("");

    try {
      const res = await apiPatch<ModelConfig>(`/api/model-configs/${model.id}/toggle`, {});
      if (res.code !== 0) {
        setError(res.msg || t("更新模型状态失败"));
        return;
      }

      const updated = res.data ?? model;
      setModels((current) =>
        (Array.isArray(current) ? current : []).map((item) =>
          item.id === model.id ? { ...item, active: updated.active } : item,
        ),
      );
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError("");

    try {
      const res = await apiDelete<{ deleted: number }>(`/api/model-configs/${deleteTarget.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除模型配置失败"));
        return;
      }
      setDeleteTarget(null);
      await loadModels();
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  return (
    <div>
      <PageHeader
        title={t("模型配置")}
        description={t("管理图片生成模型、成本、限额和可用状态")}
        action={
          <button
            type="button"
            onClick={() => {
              setShowCreate((value) => !value);
              cancelEdit();
            }}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            {t("添加模型")}
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
          onSubmit={handleCreate}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <ModelConfigFormFields
            formIdPrefix="model-create"
            form={form}
            providers={safeModelProviders}
            apiKeyRequired
            onChange={setForm}
          />
          <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setForm(withPurpose(emptyModelConfigForm));
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {t("取消")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {submitting ? t("添加中...") : t("添加模型")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("名称")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("供应商")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("模型")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("用途")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Key</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("每张成本")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("每日限额")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("状态")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载模型配置...")}
                </td>
              </tr>
            ) : safeModels.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无模型配置")}
                </td>
              </tr>
            ) : (
              safeModels.map((model) => (
                <Fragment key={model.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{model.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{model.provider}</td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-700">{model.model_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {t(formatUsageType(model.usage_type))}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-700">
                      {maskKey(model.api_key)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">
                      ${formatNumber(model.price_per_image, 6)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-700">
                      {Number(model.daily_limit || 0) === 0
                        ? t("不限")
                        : `$${formatNumber(model.daily_limit)}`}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          model.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {model.active ? t("启用") : t("停用")}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <button
                        type="button"
                        onClick={() => startEdit(model)}
                        className="font-medium text-blue-600 hover:text-blue-700"
                      >
                        {t("编辑")}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleModel(model)}
                        className="ml-4 font-medium text-gray-900 hover:text-gray-600"
                      >
                        {model.active ? t("停用") : t("启用")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(model)}
                        className="ml-4 font-medium text-red-600 hover:text-red-700"
                      >
                        {t("删除")}
                      </button>
                    </td>
                  </tr>
                  {editingId === model.id && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-4 py-4">
                        <form
                          onSubmit={handleUpdate}
                          className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
                        >
                          <ModelConfigFormFields
                            formIdPrefix={`model-edit-${model.id}`}
                            form={editForm}
                            providers={safeModelProviders}
                            apiKeyPlaceholder="sk-****"
                            onChange={setEditForm}
                          />
                          <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                            >
                              {t("取消")}
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                            >
                              {submitting ? t("保存中...") : t("保存修改")}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("删除模型配置")}
        description={`${t("确认删除模型")}「${deleteTarget?.name || ""}」？${t("此操作不可恢复。")}`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
