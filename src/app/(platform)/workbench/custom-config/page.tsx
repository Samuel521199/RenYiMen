"use client";

import { FormEvent, useEffect, useState } from "react";

import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPut } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";

interface UserModelApiKeyItem {
  model_config_id: number;
  name: string;
  provider: string;
  model_name: string;
  api_key_last4: string;
  has_custom_key: boolean;
  updated_at: string | null;
}

function MaskedKey({ last4 }: { last4: string }) {
  return (
    <span
      className="inline-block select-none font-mono text-sm tracking-widest text-slate-300"
      onCopy={(event) => event.preventDefault()}
      aria-label={`Key ending in ${last4}`}
    >
      ••••{last4}
    </span>
  );
}

export default function CustomConfigPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<UserModelApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadItems() {
    setLoading(true);
    setError("");
    try {
      const res = await apiGet<UserModelApiKeyItem[]>("/api/user-model-api-keys");
      if (res.code !== 0) {
        setError(res.msg || t("配置列表加载失败"));
        return;
      }
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("配置列表加载失败"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  function startEdit(item: UserModelApiKeyItem) {
    setEditingId(item.model_config_id);
    setDraftKey("");
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftKey("");
  }

  async function handleSave(event: FormEvent<HTMLFormElement>, modelConfigId: number) {
    event.preventDefault();
    const trimmed = draftKey.trim();
    if (!trimmed) {
      setError(t("请输入完整 API Key"));
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPut<UserModelApiKeyItem>(
        `/api/user-model-api-keys/${modelConfigId}`,
        { api_key: trimmed },
      );
      if (res.code !== 0) {
        setError(res.msg || t("保存 Key 失败"));
        return;
      }
      setMessage(t("Key 已保存"));
      setEditingId(null);
      setDraftKey("");
      await loadItems();
    } catch {
      setError(t("保存 Key 失败"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRestoreDefault(modelConfigId: number) {
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const res = await apiDelete<UserModelApiKeyItem>(
        `/api/user-model-api-keys/${modelConfigId}`,
      );
      if (res.code !== 0) {
        setError(res.msg || t("恢复默认失败"));
        return;
      }
      setMessage(t("已恢复为系统默认 Key"));
      if (editingId === modelConfigId) {
        cancelEdit();
      }
      await loadItems();
    } catch {
      setError(t("恢复默认失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("自定义配置")}
        description={t("为各模型配置个人 API Key，留空则使用系统默认 Key")}
      />

      {error && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-700/70 bg-slate-900/40 shadow-sm">
        <table className="min-w-full divide-y divide-slate-700/60">
          <thead className="bg-slate-800/60">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("模型名称")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("供应商")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("Key 后四位")}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("来源")}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-slate-400">
                {t("操作")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  {t("正在加载配置...")}
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                  —
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.model_config_id} className="hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-slate-100">{item.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">{item.model_name}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">{item.provider}</td>
                  <td className="px-4 py-3">
                    <MaskedKey last4={item.api_key_last4} />
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        item.has_custom_key
                          ? "bg-indigo-500/20 text-indigo-200"
                          : "bg-slate-700/60 text-slate-300"
                      }`}
                    >
                      {item.has_custom_key ? t("个人 Key") : t("系统默认")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === item.model_config_id ? (
                      <form
                        className="flex flex-col items-end gap-2 sm:flex-row sm:items-center"
                        onSubmit={(event) => handleSave(event, item.model_config_id)}
                      >
                        <input
                          type="password"
                          autoComplete="off"
                          value={draftKey}
                          onChange={(event) => setDraftKey(event.target.value)}
                          placeholder={t("请输入完整 API Key")}
                          className="w-full min-w-[220px] rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 sm:w-72"
                          required
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
                          >
                            {t("取消")}
                          </button>
                          <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {submitting ? t("保存中...") : t("保存 Key")}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(item)}
                          className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
                        >
                          {t("编辑 Key")}
                        </button>
                        {item.has_custom_key && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleRestoreDefault(item.model_config_id)}
                            className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm text-rose-200 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {t("恢复默认")}
                          </button>
                        )}
                      </div>
                    )}
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
