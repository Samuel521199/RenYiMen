"use client";

import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@/components/common/ConfirmDialog";
import PageHeader from "@/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiUpload } from "@/lib/api";
import { useLanguage } from "@/lib/LanguageContext";
import { usePermission } from "@/lib/PermissionContext";
import {
  ASSET_GRID_SIZE_OPTIONS,
  buildAssetCardMetaText,
  buildAssetCategoryButtonLabel,
  getAllAssetIds,
  getAssetGridDisplayConfig,
  toggleAssetSelection,
  type AssetGridSize,
} from "@/lib/asset-grid";
import { ASSET_CATEGORIES } from "@/lib/constants";
import { getTagLabel } from "@/lib/tag-display";
import type { Asset, AssetCategory, AssetStats } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const BACKGROUND_ASSET_CATEGORY = "background";

interface AssetTagOption {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  group?: string | null;
}

function assetImageSrc(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

function splitTags(tags?: string) {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeAssetTagOptions(rawTags: AssetTagOption[]) {
  return (Array.isArray(rawTags) ? rawTags : [])
    .filter((tag) => String(tag?.name || "").trim())
    .map((tag) => ({
      ...tag,
      name: String(tag.name || "").trim(),
    }));
}

interface TagMultiSelectProps {
  t: (value: string) => string;
  lang: "zh" | "en";
  label: string;
  options: AssetTagOption[];
  selected: string[];
  placeholder: string;
  emptyText: string;
  maxVisibleSelected?: number;
  showRemoveButtons?: boolean;
  clearLabel?: string;
  customInput?: string;
  customPlaceholder?: string;
  alwaysShowCustomInput?: boolean;
  onToggle: (tag: string) => void;
  onClear?: () => void;
  onCustomInputChange?: (value: string) => void;
  onCustomSubmit?: () => void;
}

function TagMultiSelect({
  t,
  lang,
  label,
  options,
  selected,
  placeholder,
  emptyText,
  maxVisibleSelected = 3,
  showRemoveButtons = false,
  clearLabel,
  customInput,
  customPlaceholder,
  alwaysShowCustomInput = false,
  onToggle,
  onClear,
  onCustomInputChange,
  onCustomSubmit,
}: TagMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const safeOptions = Array.isArray(options) ? options : [];
  const optionByName = new Map(safeOptions.map((tag) => [tag.name, tag] as const));
  const safeSelected = Array.isArray(selected) ? selected : [];
  const visibleSelected = safeSelected.slice(0, maxVisibleSelected);
  const hiddenSelectedCount = Math.max(safeSelected.length - visibleSelected.length, 0);
  const canCreateCustom = Boolean(onCustomInputChange && onCustomSubmit);

  function handleCustomKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && onCustomSubmit) {
      event.preventDefault();
      onCustomSubmit();
    }
  }

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        className="flex min-h-10 w-full items-start justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-gray-400 focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
      >
        <span className="flex max-h-[4.25rem] min-w-0 flex-1 flex-wrap gap-1.5 overflow-hidden">
          {safeSelected.length === 0 ? (
            <span className="leading-6 text-gray-400">{placeholder}</span>
          ) : (
            <>
              {visibleSelected.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium leading-4 text-emerald-700"
                >
                  <span className="truncate">{getTagLabel(optionByName.get(tag) || tag, lang)}</span>
                  {showRemoveButtons && (
                    <button
                      type="button"
                      aria-label={`${t("移除标签")} ${tag}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(tag);
                      }}
                      className="shrink-0 text-emerald-500 transition hover:text-emerald-800"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {hiddenSelectedCount > 0 && (
                <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium leading-4 text-gray-600">
                +{hiddenSelectedCount} {t("个")}
                </span>
              )}
            </>
          )}
        </span>
        <span className="mt-1 shrink-0 text-gray-400">⌄</span>
      </div>

      {open && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="max-h-56 overflow-y-auto p-3">
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="mb-2 inline-flex rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
              >
                {clearLabel || t("清除筛选")}
              </button>
            )}
            {safeOptions.length === 0 ? (
              <div className="py-2 text-sm text-gray-400">{emptyText}</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {safeOptions.map((tag) => {
                  const active = safeSelected.includes(tag.name);
                  return (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => onToggle(tag.name)}
                      className={`inline-flex max-w-[8rem] items-center rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        active
                          ? "bg-gray-900 text-white"
                          : "border border-gray-200 bg-white text-gray-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                      }`}
                    >
                      <span className="truncate">{getTagLabel(tag, lang)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {canCreateCustom && !alwaysShowCustomInput && (
            <div className="border-t border-gray-100 p-2">
              <input
                value={customInput || ""}
                onChange={(event) => onCustomInputChange?.(event.target.value)}
                onKeyDown={handleCustomKeyDown}
                placeholder={customPlaceholder || t("新增自定义标签，回车添加")}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              />
            </div>
          )}
        </div>
      )}
      {canCreateCustom && alwaysShowCustomInput && (
        <input
          value={customInput || ""}
          onChange={(event) => onCustomInputChange?.(event.target.value)}
          onKeyDown={handleCustomKeyDown}
          placeholder={customPlaceholder || t("新增自定义标签，回车添加")}
          className="mt-2 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        />
      )}
    </div>
  );
}

export default function AssetsPage() {
  const { t, lang } = useLanguage();
  const { canDelete } = usePermission();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetStats, setAssetStats] = useState<AssetStats>({ total: 0, by_category: {} });
  const [filterTags, setFilterTags] = useState<AssetTagOption[]>([]);
  const [uploadTagOptions, setUploadTagOptions] = useState<AssetTagOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [uploadTags, setUploadTags] = useState<string[]>([]);
  const [customUploadTag, setCustomUploadTag] = useState("");
  const [editingTagAssetId, setEditingTagAssetId] = useState<number | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editTagOptions, setEditTagOptions] = useState<AssetTagOption[]>([]);
  const [customEditTag, setCustomEditTag] = useState("");
  const [savingTagAssetId, setSavingTagAssetId] = useState<number | null>(null);
  const [category, setCategory] = useState<"all" | AssetCategory>("all");
  const [gridSize, setGridSize] = useState<AssetGridSize>("large");
  const [migrationMode, setMigrationMode] = useState(false);
  const [migrationAssetIds, setMigrationAssetIds] = useState<number[]>([]);
  const [targetMigrationCategory, setTargetMigrationCategory] = useState<AssetCategory>("expression");
  const [movingAssets, setMovingAssets] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeAssets = Array.isArray(assets) ? assets : [];
  const safeFilterTags = Array.isArray(filterTags) ? filterTags : [];
  const safeUploadTagOptions = Array.isArray(uploadTagOptions) ? uploadTagOptions : [];
  const safeEditTagOptions = Array.isArray(editTagOptions) ? editTagOptions : [];
  const safeSelectedTags = Array.isArray(selectedTags) ? selectedTags : [];
  const safeUploadTags = Array.isArray(uploadTags) ? uploadTags : [];
  const safeEditTags = Array.isArray(editTags) ? editTags : [];
  const safeAssetCategories = Array.isArray(ASSET_CATEGORIES) ? ASSET_CATEGORIES : [];
  const assetGridConfig = getAssetGridDisplayConfig(gridSize);
  const loadedTagOptionsByName = useMemo(() => {
    return new Map(
      [...safeFilterTags, ...safeUploadTagOptions, ...safeEditTagOptions].map((tag) => [tag.name, tag] as const),
    );
  }, [safeEditTagOptions, safeFilterTags, safeUploadTagOptions]);

  function getCategoryLabel(value: string) {
    const cat = safeAssetCategories.find((category) => category.value === value);
    return cat ? t(cat.label) : value;
  }

  const uploadCategory = useMemo<AssetCategory>(() => {
    if (category !== "all") return category;
    return safeAssetCategories[0]?.value as AssetCategory;
  }, [category, safeAssetCategories]);

  async function loadAssets(nextCategory = category, nextTags = selectedTags) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (nextCategory !== "all") params.set("category", nextCategory);
      if (nextTags.length > 0) params.set("tags", nextTags.join(","));
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await apiGet<Asset[]>(`/api/assets${query}`);
      if (res.code !== 0) {
        setError(res.msg || t("素材列表加载失败"));
        return;
      }
      setAssets(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setLoading(false);
    }
  }

  async function loadAssetStats() {
    try {
      const res = await apiGet<AssetStats>("/api/assets/stats");
      if (res.code === 0 && res.data) {
        setAssetStats({
          total: Number(res.data.total || 0),
          by_category: res.data.by_category || {},
        });
      }
    } catch {
      setAssetStats({ total: 0, by_category: {} });
    }
  }

  async function loadFilterTags(nextCategory = category) {
    if (nextCategory === "all") {
      setFilterTags([]);
      return;
    }

    try {
      const res = await apiGet<AssetTagOption[]>(
        `/api/assets/tags?category=${encodeURIComponent(nextCategory)}`
      );
      if (res.code === 0) {
        setFilterTags(normalizeAssetTagOptions(Array.isArray(res.data) ? res.data : []));
      }
    } catch {
      setFilterTags([]);
    }
  }

  async function loadUploadTagOptions(nextCategory = uploadCategory) {
    try {
      const res = await apiGet<AssetTagOption[]>(
        `/api/assets/tags?category=${encodeURIComponent(nextCategory)}`
      );
      if (res.code === 0) {
        setUploadTagOptions(normalizeAssetTagOptions(Array.isArray(res.data) ? res.data : []));
      }
    } catch {
      setUploadTagOptions([]);
    }
  }

  async function loadEditTagOptions(nextCategory: string) {
    try {
      const res = await apiGet<AssetTagOption[]>(
        `/api/assets/tags?category=${encodeURIComponent(nextCategory)}`
      );
      if (res.code === 0) {
        setEditTagOptions(normalizeAssetTagOptions(Array.isArray(res.data) ? res.data : []));
      } else {
        setEditTagOptions([]);
      }
    } catch {
      setEditTagOptions([]);
    }
  }

  useEffect(() => {
    loadAssets(category, selectedTags);
  }, [category, selectedTags]);

  useEffect(() => {
    loadAssetStats();
  }, []);

  useEffect(() => {
    loadFilterTags(category);
  }, [category]);

  useEffect(() => {
    loadUploadTagOptions(uploadCategory);
  }, [uploadCategory]);

  function addCustomUploadTag() {
    const tag = customUploadTag.trim();
    if (!tag) return;
    setUploadTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setCustomUploadTag("");
  }

  function toggleUploadTag(tag: string) {
    setUploadTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  function addCustomEditTag() {
    const tag = customEditTag.trim();
    if (!tag) return;
    setEditTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setEditTagOptions((current) =>
      current.some((item) => item.name === tag) ? current : [...current, { name: tag }]
    );
    setCustomEditTag("");
  }

  function toggleEditTag(tag: string) {
    setEditTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  function toggleSelectedTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  function handleCategoryChange(nextCategory: "all" | AssetCategory) {
    setCategory(nextCategory);
    setSelectedTags([]);
    setUploadTags([]);
    setCustomUploadTag("");
    setMigrationAssetIds([]);
  }

  function clearSelectedTags() {
    setSelectedTags([]);
  }

  async function startEditingTags(asset: Asset) {
    if (editingTagAssetId === asset.id) {
      setEditingTagAssetId(null);
      return;
    }
    setEditingTagAssetId(asset.id);
    setEditTags(splitTags(asset.tags));
    setCustomEditTag("");
    await loadEditTagOptions(asset.category);
  }

  function cancelEditingTags() {
    setEditingTagAssetId(null);
    setEditTags([]);
    setCustomEditTag("");
    setEditTagOptions([]);
  }

  async function saveAssetTags(asset: Asset) {
    setSavingTagAssetId(asset.id);
    setError("");
    try {
      const res = await apiPatch<Asset>(`/api/assets/${asset.id}/tags`, {
        tags: safeEditTags.join(","),
      });
      if (res.code !== 0 || !res.data) {
        setError(res.msg || t("素材标签保存失败"));
        return;
      }
      setAssets((current) =>
        current.map((item) => (item.id === asset.id ? { ...item, tags: res.data.tags } : item))
      );
      setEditingTagAssetId(null);
      setEditTags([]);
      setCustomEditTag("");
      setEditTagOptions([]);
      await loadFilterTags(category);
      await loadUploadTagOptions(uploadCategory);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSavingTagAssetId(null);
    }
  }

  function enterMigrationMode() {
    setMigrationMode(true);
    setMigrationAssetIds([]);
    setTargetMigrationCategory(uploadCategory);
    setEditingTagAssetId(null);
    setError("");
    setMessage("");
  }

  function cancelMigrationMode() {
    setMigrationMode(false);
    setMigrationAssetIds([]);
    setError("");
  }

  function selectAllVisibleAssetsForMigration() {
    setMigrationAssetIds(getAllAssetIds(safeAssets));
  }

  function toggleMigrationAsset(assetId: number) {
    setMigrationAssetIds((current) => toggleAssetSelection(current, assetId));
  }

  async function confirmBatchMove() {
    const assetIds = getAllAssetIds(migrationAssetIds.map((id) => ({ id })));
    if (assetIds.length === 0) {
      setError(t("请先选择要迁移的素材"));
      return;
    }

    setMovingAssets(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPatch<{ moved_count: number }>("/api/assets/batch-move", {
        asset_ids: assetIds,
        target_category: targetMigrationCategory,
      });
      if (res.code !== 0) {
        setError(res.msg || t("素材迁移失败"));
        return;
      }
      setMessage(`${t("已迁移")} ${res.data?.moved_count || 0} ${t("张素材")}`);
      setMigrationMode(false);
      setMigrationAssetIds([]);
      await loadAssets(category, selectedTags);
      await loadAssetStats();
      await loadFilterTags(category);
      await loadUploadTagOptions(uploadCategory);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setMovingAssets(false);
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    setUploading(true);
    setUploadProgress(`${t("正在上传")} 0/${files.length}`);
    setError("");

    try {
      const failedUploads: string[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setUploadProgress(`${t("正在上传")} ${index + 1}/${files.length}`);

        const formData = new FormData();
        formData.append("file", file);
        formData.append("filename", file.name);
        formData.append("category", uploadCategory);
        formData.append("tags", safeUploadTags.join(","));

        const res = await apiUpload<Asset>("/api/assets/upload", formData);

        if (res.code !== 0) {
          failedUploads.push(file.name);
        }
      }

      await loadAssets(category, selectedTags);
      await loadAssetStats();
      await loadFilterTags(category);
      await loadUploadTagOptions(uploadCategory);
      if (failedUploads.length > 0) {
        setError(`${t("部分素材上传失败")}：${failedUploads.join("、")}`);
      } else {
        setUploadTags([]);
      }
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      const res = await apiDelete<{ deleted: number }>(`/api/assets/${deleteTarget.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除素材失败"));
        return;
      }
      setDeleteTarget(null);
      await loadAssets(category, selectedTags);
      await loadAssetStats();
      await loadFilterTags(category);
      await loadUploadTagOptions(uploadCategory);
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  return (
    <div>
      <PageHeader
        title={t("素材库")}
        description={t("管理牛形象、表情、动作、背景和道具素材")}
      />

      <div className="mb-4 flex justify-end">
        <button
          type="button"
          onClick={enterMigrationMode}
          disabled={migrationMode}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("批量迁移")}
        </button>
      </div>

      <section className="mb-5 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-72 flex-1">
            <TagMultiSelect
              t={t}
              lang={lang}
              label={`${t("上传标签")}（${getCategoryLabel(uploadCategory)}）`}
              options={safeUploadTagOptions}
              selected={safeUploadTags}
              placeholder={t("选择或新增上传标签")}
              emptyText={t("当前分类暂无已有标签")}
              maxVisibleSelected={20}
              showRemoveButtons
              customInput={customUploadTag}
              customPlaceholder={t("新增自定义标签，回车添加")}
              onToggle={toggleUploadTag}
              onCustomInputChange={setCustomUploadTag}
              onCustomSubmit={addCustomUploadTag}
            />
          </div>
          <label className="inline-flex cursor-pointer items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700">
            {uploading ? uploadProgress || t("上传中...") : t("上传素材")}
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleUpload}
            />
          </label>
        </div>
      </section>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleCategoryChange("all")}
            className={`rounded-md px-3 py-2 text-sm font-medium transition ${
              category === "all"
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
            title={buildAssetCategoryButtonLabel(t("全部"), assetStats.total)}
          >
            <span>{t("全部")}</span>
            <span className={`ml-1 text-xs ${category === "all" ? "text-gray-300" : "text-gray-400"}`}>
              ({assetStats.total})
            </span>
          </button>
          {safeAssetCategories.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => handleCategoryChange(item.value as AssetCategory)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                category === item.value
                  ? "bg-gray-900 text-white"
                  : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
              title={buildAssetCategoryButtonLabel(t(item.label), assetStats.by_category[item.value])}
            >
              <span>{t(item.label)}</span>
              <span className={`ml-1 text-xs ${category === item.value ? "text-gray-300" : "text-gray-400"}`}>
                ({assetStats.by_category[item.value] || 0})
              </span>
            </button>
          ))}
        </div>
        <div className="inline-flex overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          {ASSET_GRID_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setGridSize(option.value)}
              className={`px-3 py-2 text-sm font-medium transition ${
                gridSize === option.value
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
              aria-pressed={gridSize === option.value}
              title={`${t(option.label)}：${option.columns}列`}
            >
              {t(option.label)}
            </button>
          ))}
        </div>
      </div>

      {category !== "all" && (
        <div className="mb-5 max-w-xl">
          <TagMultiSelect
            t={t}
            lang={lang}
            label={t("标签筛选")}
            options={safeFilterTags}
            selected={safeSelectedTags}
            placeholder={t("选择标签筛选素材")}
            emptyText={t("当前分类暂无可筛选标签")}
            clearLabel={t("清除筛选")}
            onToggle={toggleSelectedTag}
            onClear={clearSelectedTags}
          />
        </div>
      )}

      {migrationMode && (
        <section className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <p className="rounded-md bg-white px-3 py-2 text-sm font-medium text-amber-800">
              {t("已选")} {migrationAssetIds.length} {t("张")}
            </p>
            <button
              type="button"
              onClick={selectAllVisibleAssetsForMigration}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
            >
              {t("按当前标签全选")}
            </button>
            <label className="text-sm font-medium text-gray-700">
              {t("目标分类")}
              <select
                value={targetMigrationCategory}
                onChange={(event) => setTargetMigrationCategory(event.target.value as AssetCategory)}
                className="ml-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                {safeAssetCategories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={confirmBatchMove}
              disabled={movingAssets || migrationAssetIds.length === 0}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {movingAssets ? t("迁移中...") : t("确认迁移")}
            </button>
            <button
              type="button"
              onClick={cancelMigrationMode}
              disabled={movingAssets}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("取消")}
            </button>
          </div>
        </section>
      )}

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

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          {t("正在加载素材...")}
        </div>
      ) : safeAssets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {t("暂无素材")}
        </div>
      ) : (
        <div className={assetGridConfig.gridClassName}>
          {safeAssets.map((asset) => {
            const assetTags = splitTags(asset.tags);
            const assetTagLabels = assetTags.map((tag) => getTagLabel(loadedTagOptionsByName.get(tag) || tag, lang));
            const cardMetaText = buildAssetCardMetaText(getCategoryLabel(asset.category), assetTagLabels);
            return (
              <div
                key={asset.id}
                className={`relative overflow-hidden rounded-lg border bg-white shadow-sm ${
                  migrationAssetIds.includes(asset.id) ? "border-amber-400 ring-2 ring-amber-300" : "border-gray-200"
                }`}
              >
                {migrationMode && (
                  <label className="absolute left-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md bg-white/95 shadow-sm ring-1 ring-gray-200">
                    <input
                      type="checkbox"
                      checked={migrationAssetIds.includes(asset.id)}
                      onChange={() => toggleMigrationAsset(asset.id)}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900"
                      aria-label={`${t("选择素材")} ${asset.filename}`}
                    />
                  </label>
                )}
                <div className="bg-gray-100">
                  <img
                    src={assetImageSrc(asset.url)}
                    alt={asset.filename}
                    className={assetGridConfig.imageClassName}
                  />
                </div>
                <div className="flex h-8 items-center gap-1.5 border-t border-gray-100 px-2">
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700"
                    title={cardMetaText}
                  >
                    {cardMetaText}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      asset.category === BACKGROUND_ASSET_CATEGORY
                        ? "bg-violet-50 text-violet-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                    title={
                      asset.category === BACKGROUND_ASSET_CATEGORY
                        ? `${t("背景图调用")} ${asset.use_count || 0} ${t("次")}`
                        : `${t("调用")} ${asset.use_count || 0} ${t("次")}`
                    }
                  >
                    {t("调用")} {asset.use_count || 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEditingTags(asset)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                    aria-label={editingTagAssetId === asset.id ? t("收起标签编辑") : t("编辑标签")}
                    title={editingTagAssetId === asset.id ? t("收起标签") : t("编辑标签")}
                  >
                    ✏️
                  </button>
                  {canDelete("assets") && (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(asset)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-red-500 transition hover:bg-red-50 hover:text-red-700"
                      aria-label={t("删除素材")}
                      title={t("删除")}
                    >
                      🗑️
                    </button>
                  )}
                </div>
                {editingTagAssetId === asset.id && (
                  <div className="border-t border-emerald-100 bg-emerald-50/40 p-3">
                    <TagMultiSelect
                      t={t}
                      lang={lang}
                      label={t("编辑标签")}
                      options={safeEditTagOptions}
                      selected={safeEditTags}
                      placeholder={t("选择或新增素材标签")}
                      emptyText={t("当前分类暂无已有标签")}
                      maxVisibleSelected={20}
                      showRemoveButtons
                      customInput={customEditTag}
                      customPlaceholder={t("新增自定义标签，回车添加")}
                      alwaysShowCustomInput
                      onToggle={toggleEditTag}
                      onCustomInputChange={setCustomEditTag}
                      onCustomSubmit={addCustomEditTag}
                    />
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveAssetTags(asset)}
                        disabled={savingTagAssetId === asset.id}
                        className="flex-1 rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingTagAssetId === asset.id ? t("保存中...") : t("保存")}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditingTags}
                        className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        {t("取消")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("删除素材")}
        description={`${t("确认删除素材")}「${deleteTarget?.filename || ""}」？${t("此操作不可恢复。")}`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
