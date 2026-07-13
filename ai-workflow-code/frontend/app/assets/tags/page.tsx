"use client";

import { useEffect, useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import { ASSET_CATEGORIES } from "@/lib/constants";
import type { AssetCategory } from "@/lib/types";

type BackgroundTagGroup = "purpose" | "scene" | "mood" | "color_style";

interface ManagedAssetTag {
  id: number;
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  category: AssetCategory | string;
  tag_group?: BackgroundTagGroup | null;
  image_count: number;
  created_at?: string | null;
}

const defaultCategory = "bull_reference" as AssetCategory;
const BACKGROUND_TAG_GROUP_OPTIONS: Array<{ value: BackgroundTagGroup; label: string }> = [
  { value: "purpose", label: "用途" },
  { value: "scene", label: "场景" },
  { value: "mood", label: "氛围" },
  { value: "color_style", label: "颜色风格" },
];

export default function AssetTagsPage() {
  const { t } = useLanguage();
  const [category, setCategory] = useState<AssetCategory>(defaultCategory);
  const [tags, setTags] = useState<ManagedAssetTag[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNameEn, setEditingNameEn] = useState("");
  const [editingNameZh, setEditingNameZh] = useState("");
  const [editingGroup, setEditingGroup] = useState<BackgroundTagGroup | "">("");
  const [creatingNameEn, setCreatingNameEn] = useState("");
  const [creatingNameZh, setCreatingNameZh] = useState("");
  const [creatingGroup, setCreatingGroup] = useState<BackgroundTagGroup | "">("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedAssetTag | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeTags = Array.isArray(tags) ? tags : [];
  const safeAssetCategories = Array.isArray(ASSET_CATEGORIES) ? ASSET_CATEGORIES : [];
  const isBackgroundCategory = category === "background";
  const categoryLabel = (value: string) => {
    const item = safeAssetCategories.find((current) => current.value === value);
    return item ? t(item.label) : value;
  };
  const tagGroupLabel = (value?: BackgroundTagGroup | null) => {
    if (!value) return "-";
    const item = BACKGROUND_TAG_GROUP_OPTIONS.find((option) => option.value === value);
    return item ? t(item.label) : value;
  };

  async function loadTags(nextCategory = category) {
    setLoading(true);
    setError("");

    try {
      const res = await apiGet<ManagedAssetTag[]>(
        `/api/assets/tags/manage?category=${encodeURIComponent(nextCategory)}`,
      );
      if (res.code !== 0) {
        setError(res.msg || t("标签列表加载失败"));
        return;
      }
      setTags(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCreatingNameEn("");
    setCreatingGroup("");
    setEditingId(null);
    setEditingNameEn("");
    setEditingNameZh("");
    setEditingGroup("");
    setMessage("");
    loadTags(category);
  }, [category]);

  function startRename(tag: ManagedAssetTag) {
    setEditingId(tag.id);
    setEditingNameEn(tag.name_en || tag.name || "");
    setEditingNameZh(tag.name_zh || "");
    setEditingGroup(tag.tag_group || "");
    setError("");
    setMessage("");
  }

  async function submitRename(tag: ManagedAssetTag) {
    const nameEn = editingNameEn.trim();
    const nameZh = editingNameZh.trim();
    if (!nameEn) return;
    if (tag.category === "background" && !editingGroup) {
      setError(t("请选择背景标签分组"));
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const res = await apiPatch<ManagedAssetTag>(`/api/assets/tags/${tag.id}`, {
        name_en: nameEn,
        name_zh: nameZh || null,
        tag_group: tag.category === "background" ? editingGroup : null,
      });
      if (res.code !== 0) {
        setError(res.msg || t("标签更新失败"));
        return;
      }
      setEditingId(null);
      setEditingNameEn("");
      setEditingNameZh("");
      setEditingGroup("");
      setMessage(t("标签已更新"));
      await loadTags(category);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  async function createTag() {
    const nameEn = creatingNameEn.trim();
    const nameZh = creatingNameZh.trim();
    if (!nameEn) {
      setError(t("请输入英文名称"));
      return;
    }
    if (isBackgroundCategory && !creatingGroup) {
      setError(t("请选择标签分组"));
      return;
    }

    setSubmitting(true);
    setError("");
    setMessage("");

    try {
      const res = await apiPost<ManagedAssetTag>("/api/assets/tags/create", {
        category,
        name_en: nameEn,
        name_zh: nameZh || null,
        tag_group: isBackgroundCategory ? creatingGroup : null,
      });
      if (res.code !== 0) {
        setError(res.msg || t("创建标签失败"));
        return;
      }
      setCreatingNameEn("");
      setCreatingNameZh("");
      setCreatingGroup("");
      setMessage(t("标签已创建"));
      await loadTags(category);
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
    setMessage("");

    try {
      const res = await apiDelete<{ deleted: number; image_count: number }>(
        `/api/assets/tags/${deleteTarget.id}`,
      );
      if (res.code !== 0) {
        setError(res.msg || t("删除标签失败"));
        return;
      }
      setDeleteTarget(null);
      setMessage(t("标签已删除"));
      await loadTags(category);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("标签管理")} description={t("按素材分类创建、编辑和维护可复用标签")} />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {message && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {safeAssetCategories.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setCategory(item.value as AssetCategory)}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              category === item.value
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("英文名称")}</label>
            <input
              value={creatingNameEn}
              onChange={(event) => setCreatingNameEn(event.target.value)}
              placeholder={t("输入英文标签名")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("中文名称（可选）")}</label>
            <input
              value={creatingNameZh}
              onChange={(event) => setCreatingNameZh(event.target.value)}
              placeholder={t("输入中文标签名")}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("标签分组")}</label>
            {isBackgroundCategory ? (
              <select
                value={creatingGroup}
                onChange={(event) => setCreatingGroup(event.target.value as BackgroundTagGroup | "")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              >
                <option value="">{t("请选择标签分组")}</option>
                {BACKGROUND_TAG_GROUP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.label)}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-md border border-dashed border-gray-200 px-3 py-2 text-sm text-gray-400">
                {t("当前分类无需设置分组")}
              </div>
            )}
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={createTag}
            disabled={submitting}
            className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-400 md:w-auto"
          >
              {t("新建标签")}
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("英文名")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("中文名")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("分类")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("分组")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("图片数量")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载标签...")}
                </td>
              </tr>
            ) : safeTags.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("当前分类暂无标签")}
                </td>
              </tr>
            ) : (
              safeTags.map((tag) => (
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
                  <td className="px-4 py-3 text-sm text-gray-600">{categoryLabel(tag.category)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {editingId === tag.id && tag.category === "background" ? (
                      <select
                        value={editingGroup}
                        onChange={(event) => setEditingGroup(event.target.value as BackgroundTagGroup | "")}
                        className="w-full max-w-[12rem] rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                      >
                        <option value="">{t("请选择标签分组")}</option>
                        {BACKGROUND_TAG_GROUP_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {t(option.label)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      tagGroupLabel(tag.tag_group)
                    )}
                  </td>
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
                            setEditingGroup("");
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
                          {t("编辑")}
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
        description={`${t("该标签下有")} ${deleteTarget?.image_count || 0} ${t("张图片，删除标签不会删除图片。确认删除")}「${deleteTarget?.name_zh || deleteTarget?.name_en || deleteTarget?.name || ""}」？`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
