"use client";

import { useEffect, useRef, useState } from "react";

import { apiPost } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { getTagHint, getTagLabel, type TagOption as DisplayTagOption } from "@workbench/lib/tag-display";

interface TagOption extends DisplayTagOption {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  tag_group?: string | null;
}

interface TagComboboxProps {
  label: string;
  options: TagOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  category: string;
  tagGroup: string;
  multiple?: boolean;
  placeholder?: string;
  emptyText?: string;
  onOptionsRefresh?: () => Promise<void> | void;
  disabled?: boolean;
}

function normalizeName(value: string) {
  return String(value || "").trim();
}

function findOptionByName(options: TagOption[], name: string) {
  return options.find((option) => normalizeName(option.name) === normalizeName(name));
}

export default function TagCombobox({
  label,
  options,
  selected,
  onChange,
  category,
  tagGroup,
  multiple = false,
  placeholder = "",
  emptyText = "",
  onOptionsRefresh,
  disabled = false,
}: TagComboboxProps) {
  const { lang, t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customNameEn, setCustomNameEn] = useState("");
  const [customNameZh, setCustomNameZh] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const safeOptions = Array.isArray(options) ? options : [];
  const safeSelected = Array.isArray(selected) ? selected : [];
  const filteredOptions = safeOptions.filter((option) =>
    [
      normalizeName(option.name),
      normalizeName(option.name_en || ""),
      normalizeName(option.name_zh || ""),
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizeName(query).toLowerCase()),
  );
  const normalizedQuery = normalizeName(query);
  const matchedOption = safeOptions.find(
    (option) =>
      normalizeName(option.name) === normalizedQuery ||
      normalizeName(option.name_en || "") === normalizedQuery ||
      normalizeName(option.name_zh || "") === normalizedQuery,
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        if (!creating) {
          setCustomMode(false);
        }
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function clearComposer() {
    setQuery("");
    setError("");
    setCustomMode(false);
    setCustomNameEn("");
    setCustomNameZh("");
  }

  function updateSelection(name: string, forceSelect = false) {
    const cleanName = normalizeName(name);
    if (!cleanName) return;
    if (multiple) {
      if (forceSelect) {
        onChange(safeSelected.includes(cleanName) ? safeSelected : [...safeSelected, cleanName]);
      } else {
        onChange(
          safeSelected.includes(cleanName)
            ? safeSelected.filter((item) => item !== cleanName)
            : [...safeSelected, cleanName],
        );
      }
    } else {
      onChange([cleanName]);
      setOpen(false);
    }
    clearComposer();
  }

  function selectTag(name: string) {
    updateSelection(name, false);
  }

  function removeTag(name: string) {
    onChange(safeSelected.filter((item) => item !== name));
  }

  function enterCustomMode() {
    if (disabled || creating) return;
    setCustomMode(true);
    setOpen(true);
    setError("");
    setCustomNameEn("");
    setCustomNameZh(normalizedQuery);
  }

  function cancelCustomMode() {
    if (creating) return;
    clearComposer();
  }

  async function submitCustomTag() {
    if (creating || disabled) return;
    const nameEn = normalizeName(customNameEn);
    const nameZh = normalizeName(customNameZh);
    if (!nameEn) {
      setError(t("请输入英文名称"));
      return;
    }
    if (!nameEn && !nameZh) {
      clearComposer();
      return;
    }
    if (
      matchedOption?.name &&
      (normalizeName(matchedOption.name_en || matchedOption.name) === nameEn ||
        normalizeName(matchedOption.name_zh || "") === nameZh)
    ) {
      updateSelection(matchedOption.name, true);
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await apiPost<TagOption>("/api/assets/tags/create-inline", {
        name_en: nameEn,
        name_zh: nameZh || null,
        category,
        tag_group: tagGroup,
      });
      if (res.code !== 0 || !res.data?.name) {
        throw new Error(res.msg || t("标签创建失败"));
      }
      if (onOptionsRefresh) {
        await onOptionsRefresh();
      }
      updateSelection(res.data.name, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("标签创建失败"));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-2 block text-sm font-medium text-gray-700">{label}</label>
      <div
        className={`rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm transition ${
          open ? "border-gray-900 ring-1 ring-gray-900" : ""
        } ${disabled ? "opacity-60" : ""}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-1 flex-wrap gap-2">
            {safeSelected.map((name) => (
              <span
                key={name}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700"
              >
                {getTagLabel(findOptionByName(safeOptions, name) || name, lang)}
                <button
                  type="button"
                  onClick={() => removeTag(name)}
                  disabled={disabled}
                  className="text-emerald-500 transition hover:text-emerald-800"
                  aria-label={`${t("移除标签")} ${name}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelCustomMode();
                  return;
                }
                if (event.key === "Enter" && customMode) {
                  event.preventDefault();
                  void submitCustomTag();
                }
              }}
              disabled={disabled}
              placeholder={
                customMode
                  ? t("填写英文/中文名称后创建")
                  : safeSelected.length === 0
                    ? placeholder || t("搜索或创建标签")
                    : t("继续搜索标签")
              }
              className="min-w-[10rem] flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {customMode ? (
              <>
                <button
                  type="button"
                  onClick={() => void submitCustomTag()}
                  disabled={creating || disabled}
                  className="text-xs font-medium text-gray-600 transition hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {creating ? t("创建中…") : t("确认")}
                </button>
                <button
                  type="button"
                  onClick={cancelCustomMode}
                  disabled={creating || disabled}
                  className="text-xs font-medium text-gray-400 transition hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("取消")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={enterCustomMode}
                disabled={disabled}
                className="text-xs font-medium text-gray-400 transition hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("自定义")}
              </button>
            )}
          </div>
        </div>
      </div>

      {open && !disabled && (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {customMode && (
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-3">
              <div className="grid gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("英文名称")}</label>
                  <input
                    value={customNameEn}
                    onChange={(event) => setCustomNameEn(event.target.value)}
                    placeholder={t("输入后按回车创建")}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{t("中文名称（可选）")}</label>
                  <input
                    value={customNameZh}
                    onChange={(event) => setCustomNameZh(event.target.value)}
                    placeholder={t("输入后按回车创建")}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-2">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">{emptyText || t("暂无可用标签")}</div>
            ) : (
              filteredOptions.map((option) => {
                const active = safeSelected.includes(option.name);
                const hint = getTagHint(option, lang);
                return (
                  <button
                    key={`${option.tag_group || "default"}-${option.name}`}
                    type="button"
                    onClick={() => selectTag(option.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                      active ? "bg-emerald-50 text-emerald-700" : "text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    <span className="flex min-w-0 flex-col text-left">
                      <span>{getTagLabel(option, lang)}</span>
                      {hint ? <span className="text-xs text-gray-400">{hint}</span> : null}
                    </span>
                    {active && <span className="text-xs font-medium">{t("已选")}</span>}
                  </button>
                );
              })
            )}
          </div>
          {error && <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>
      )}
    </div>
  );
}
