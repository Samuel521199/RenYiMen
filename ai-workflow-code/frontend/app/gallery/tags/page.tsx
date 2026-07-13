"use client";

import { useEffect, useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";

const defaultSourceType = "activity";

const GALLERY_SOURCE_TYPES = [
  { code: "activity", label: "活动图" },
  { code: "share", label: "转发图" },
  { code: "daily", label: "日常互动图" },
  { code: "trending", label: "热点借势" },
  { code: "brand", label: "品牌故事" },
  { code: "game", label: "游戏感知" },
];

interface ManagedGalleryTag {
  id: number;
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  source_type: string;
  image_count: number;
}

function normalizeManagedGalleryTags(tags: ManagedGalleryTag[] | null | undefined) {
  return Array.isArray(tags) ? tags : [];
}

export default function GalleryTagsPage() {
  const { t } = useLanguage();
  const [activeSourceType, setActiveSourceType] = useState(defaultSourceType);
  const [tags, setTags] = useState<ManagedGalleryTag[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNameEn, setEditingNameEn] = useState("");
  const [editingNameZh, setEditingNameZh] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTagNameEn, setNewTagNameEn] = useState("");
  const [newTagNameZh, setNewTagNameZh] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedGalleryTag | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const sourceTypeLabel = (value: string) => {
    const item = GALLERY_SOURCE_TYPES.find((current) => current.code === value);
    return item ? t(item.label) : value;
  };

  async function loadTags(nextSourceType = activeSourceType) {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<ManagedGalleryTag[]>(
        `/api/gallery/tags/manage?source_type=${encodeURIComponent(nextSourceType)}`
      );
      if (res.code !== 0) {
        setError(res.msg || t("标签列表加载失败"));
        setTags([]);
        return;
      }
      setTags(normalizeManagedGalleryTags(res.data));
    } catch {
      setError(t("无法连接后端服务"));
      setTags([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTags(activeSourceType);
  }, [activeSourceType]);

  function startRename(tag: ManagedGalleryTag) {
    setEditingId(tag.id);
    setEditingNameEn(tag.name_en || tag.name || "");
    setEditingNameZh(tag.name_zh || "");
  }

  async function submitRename(tag: ManagedGalleryTag) {
    const nameEn = editingNameEn.trim();
    const nameZh = editingNameZh.trim();
    if (!nameEn) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await apiPatch<ManagedGalleryTag>(`/api/gallery/tags/${tag.id}`, {
        name_en: nameEn,
        name_zh: nameZh || null,
      });
      if (res.code !== 0) {
        setError(res.msg || t("重命名标签失败"));
        return;
      }
      setEditingId(null);
      setEditingNameEn("");
      setEditingNameZh("");
      await loadTags(activeSourceType);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCreate() {
    const nameEn = newTagNameEn.trim();
    const nameZh = newTagNameZh.trim();
    if (!nameEn) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await apiPost<ManagedGalleryTag>("/api/gallery/tags/create", {
        name_en: nameEn,
        name_zh: nameZh || null,
        source_type: activeSourceType,
      });
      if (res.code !== 0) {
        setError(res.msg || t("新建标签失败"));
        return;
      }
      setCreating(false);
      setNewTagNameEn("");
      setNewTagNameZh("");
      await loadTags(activeSourceType);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await apiDelete<{ deleted: number; image_count: number }>(
        `/api/gallery/tags/${deleteTarget.id}`
      );
      if (res.code !== 0) {
        setError(res.msg || t("删除标签失败"));
        return;
      }
      setDeleteTarget(null);
      await loadTags(activeSourceType);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("成品图标签管理")}
        description={t("按成品图大类管理独立标签记录，支持新建、重命名和删除")}
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {GALLERY_SOURCE_TYPES.map((item) => (
          <button
            key={item.code}
            type="button"
            onClick={() => {
              setActiveSourceType(item.code);
              setCreating(false);
              setNewTagNameEn("");
              setNewTagNameZh("");
              setEditingId(null);
              setEditingNameEn("");
              setEditingNameZh("");
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              activeSourceType === item.code
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-sm text-gray-500">
          {t("当前大类：")}<span className="font-medium text-gray-900">{sourceTypeLabel(activeSourceType)}</span>
        </div>
        {!creating ? (
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewTagNameEn("");
              setNewTagNameZh("");
            }}
            className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {t("+ 新建标签")}
          </button>
        ) : null}
      </div>

      {creating && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("英文名称")}</label>
              <input
                value={newTagNameEn}
                onChange={(event) => setNewTagNameEn(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCreate();
                  }
                }}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                placeholder={t("输入英文标签名")}
                maxLength={100}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("中文名称（可选）")}</label>
              <input
                value={newTagNameZh}
                onChange={(event) => setNewTagNameZh(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitCreate();
                  }
                }}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                placeholder={t("输入中文标签名")}
                maxLength={100}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitCreate}
                disabled={submitting}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {t("确认")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewTagNameEn("");
                  setNewTagNameZh("");
                }}
                className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
              >
                {t("取消")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("英文名")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("中文名")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("大类")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("图片数量")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载标签...")}
                </td>
              </tr>
            ) : tags.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无标签，归档图片时会自动创建")}
                </td>
              </tr>
            ) : (
              tags.map((tag) => (
                <tr key={tag.id}>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {editingId === tag.id ? (
                      <input
                        value={editingNameEn}
                        onChange={(event) => setEditingNameEn(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitRename(tag);
                          }
                        }}
                        className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                      />
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        {tag.name_en || tag.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {editingId === tag.id ? (
                      <input
                        value={editingNameZh}
                        onChange={(event) => setEditingNameZh(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitRename(tag);
                          }
                        }}
                        className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                      />
                    ) : (
                      tag.name_zh || "-"
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{sourceTypeLabel(tag.source_type)}</td>
                  <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">
                    {Number(tag.image_count || 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === tag.id ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => submitRename(tag)}
                          disabled={submitting}
                          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400"
                        >
                          {t("保存")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditingNameEn("");
                            setEditingNameZh("");
                          }}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                        >
                          {t("取消")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startRename(tag)}
                          className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                        >
                          {t("重命名")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(tag)}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          {t("删除")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("删除标签")}
        description={`${t("标签删除后不影响已归档图片，仅移除标签记录。确认删除")}「${deleteTarget?.name_zh || deleteTarget?.name_en || deleteTarget?.name || ""}」？`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
