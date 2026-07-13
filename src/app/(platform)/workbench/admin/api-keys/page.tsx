// @ts-nocheck
"use client";

import { FormEvent, useEffect, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiGet, apiPost } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { MODEL_PROVIDERS } from "@workbench/lib/constants";
import type { ApiKey, ModelProvider } from "@workbench/lib/types";

interface ApiKeyRecord extends ApiKey {
  api_key?: string;
}

interface ApiKeyFormState {
  provider: ModelProvider;
  api_key: string;
  daily_limit: string;
}

const emptyForm: ApiKeyFormState = {
  provider: "openai",
  api_key: "",
  daily_limit: "0",
};

function maskKey(value?: string) {
  if (!value) return "sk-****";
  if (value.includes("****")) return value;
  if (value.length <= 4) return `****${value}`;
  if (value.length <= 7) return `${value.slice(0, 3)}-****`;
  return `${value.slice(0, 3)}-****${value.slice(-4)}`;
}

function formatNumber(value: number | string | undefined, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

export default function AdminApiKeysPage() {
  const { t } = useLanguage();
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<ApiKeyFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const safeKeys = Array.isArray(keys) ? keys : [];
  const safeModelProviders = Array.isArray(MODEL_PROVIDERS) ? MODEL_PROVIDERS : [];

  async function loadKeys() {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<ApiKeyRecord[]>("/api/api-keys");
      if (res.code !== 0) {
        setError(res.msg || t("Key 列表加载失败"));
        return;
      }
      setKeys(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现 /api/api-keys"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadKeys();
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const res = await apiPost<ApiKeyRecord>("/api/api-keys/create", {
        provider: form.provider,
        api_key: form.api_key.trim(),
        daily_limit: Number(form.daily_limit || 0),
      });

      if (res.code !== 0) {
        setError(res.msg || t("添加 Key 失败"));
        return;
      }

      setForm(emptyForm);
      setShowCreate(false);
      await loadKeys();
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现 /api/api-keys/create"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("API Key 管理")}
        description={t("管理不同模型供应商的调用额度和启用状态")}
        action={
          <button
            type="button"
            onClick={() => setShowCreate((value) => !value)}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700"
          >
            {t("添加 Key")}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          {error}
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)_180px]">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="provider">
                {t("供应商")}
              </label>
              <select
                id="provider"
                value={form.provider}
                onChange={(event) =>
                  setForm((current) => ({ ...current, provider: event.target.value as ModelProvider }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              >
                {safeModelProviders.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {t(provider.label)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="api-key">
                API Key
              </label>
              <input
                id="api-key"
                value={form.api_key}
                onChange={(event) =>
                  setForm((current) => ({ ...current, api_key: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="daily-limit">
                {t("每日限额")}
              </label>
              <input
                id="daily-limit"
                type="number"
                min="0"
                step="0.01"
                value={form.daily_limit}
                onChange={(event) =>
                  setForm((current) => ({ ...current, daily_limit: event.target.value }))
                }
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setShowCreate(false);
                setForm(emptyForm);
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
              {submitting ? t("添加中...") : t("添加 Key")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("供应商")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Key</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("每日限额")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("今日已用")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("状态")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载 Key...")}
                </td>
              </tr>
            ) : safeKeys.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无 Key")}
                </td>
              </tr>
            ) : (
              safeKeys.map((key) => (
                <tr key={key.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-700">{key.provider}</td>
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">
                    {maskKey(key.api_key)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {formatNumber(key.daily_limit)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-gray-700">
                    {formatNumber(key.used_today, 4)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        key.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {key.active ? t("启用") : t("停用")}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
