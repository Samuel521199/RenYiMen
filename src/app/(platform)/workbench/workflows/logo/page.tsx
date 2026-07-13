// @ts-nocheck
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { apiGet, apiPost } from "@workbench/lib/api";
import { parseAssetListResponse } from "@workbench/lib/asset-list";
import { useLanguage } from "@workbench/lib/LanguageContext";

const API_BASE = "/api/workbench";

type Step = 1 | 2 | 3;

interface GalleryImage {
  id: number;
  image_url: string;
  source_type: string;
  sub_category?: string;
}

interface LogoAsset {
  id: number;
  image_url?: string;
  url?: string;
  thumbnail_url?: string;
  name?: string;
}

interface LogoPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResultItem {
  original_url: string;
  result_url: string;
  filename: string;
  previewing?: boolean;
}

interface GalleryCategory {
  code: string;
  label: string;
  label_en?: string;
}

function toImageUrl(url?: string) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${API_BASE}${url}`;
}

function normalizeGalleryImages(input: unknown): GalleryImage[] {
  const list = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { items?: unknown[] }).items)
      ? (input as { items: unknown[] }).items
      : [];

  const images: GalleryImage[] = [];
  list.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    const imageUrl = typeof record.image_url === "string" ? record.image_url : "";
    const sourceType = typeof record.source_type === "string" ? record.source_type : "";
    if (!Number.isFinite(id) || !imageUrl || !sourceType) return;
    const image: GalleryImage = {
      id,
      image_url: imageUrl,
      source_type: sourceType,
    };
    if (typeof record.sub_category === "string") image.sub_category = record.sub_category;
    images.push(image);
  });
  return images;
}

function normalizeLogoAssets(input: unknown): LogoAsset[] {
  const assets: LogoAsset[] = [];
  parseAssetListResponse(input).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id = Number(record.id);
    if (!Number.isFinite(id)) return;
    const asset: LogoAsset = { id };
    if (typeof record.image_url === "string") asset.image_url = record.image_url;
    if (typeof record.url === "string") asset.url = record.url;
    if (typeof record.thumbnail_url === "string") asset.thumbnail_url = record.thumbnail_url;
    if (typeof record.name === "string") asset.name = record.name;
    assets.push(asset);
  });
  return assets;
}

function autoHeight(width: number, logoAspect: number, previewAspect: number) {
  if (!Number.isFinite(logoAspect) || logoAspect <= 0) return Math.min(80, width);
  return Math.max(5, Math.min(80, width * previewAspect / logoAspect));
}

export default function LogoWorkflowPage() {
  const { t, lang } = useLanguage();
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const [step, setStep] = useState<Step>(1);
  const [categories, setCategories] = useState<GalleryCategory[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [selectedSourceType, setSelectedSourceType] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [logoAssets, setLogoAssets] = useState<LogoAsset[]>([]);
  const [showLogoPicker, setShowLogoPicker] = useState(false);
  const [selectedLogo, setSelectedLogo] = useState<LogoAsset | null>(null);
  const [position, setPosition] = useState<LogoPosition>({ x: 10, y: 10, width: 20, height: 10 });
  const [logoAspect, setLogoAspect] = useState(1);
  const [previewAspect, setPreviewAspect] = useState(1);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loadingImages, setLoadingImages] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");

  const stepLabels = [t("选择图片"), t("配置Logo"), t("生成下载")];
  const selectedImages = useMemo(
    () => images.filter((image) => selectedIds.has(image.id)),
    [images, selectedIds],
  );
  const selectedLogoUrl = selectedLogo
    ? selectedLogo.image_url || selectedLogo.url || selectedLogo.thumbnail_url || ""
    : "";

  useEffect(() => {
    apiGet<GalleryCategory[]>("/api/gallery/categories")
      .then((res) => {
        if (res.code === 0) {
          const next = Array.isArray(res.data) ? res.data : [];
          setCategories(next);
          if (next[0]?.code) setSelectedSourceType(next[0].code);
        }
      })
      .catch(() => setError("目录结构加载失败"));
  }, []);

  useEffect(() => {
    if (!selectedSourceType) return;
    setLoadingImages(true);
    setError("");
    setSelectedTag("");

    Promise.all([
      apiGet(`/api/gallery/finals?source_type=${encodeURIComponent(selectedSourceType)}&page_size=30`),
      apiGet(`/api/gallery/tags?source_type=${encodeURIComponent(selectedSourceType)}`),
    ])
      .then(([imageRes, tagRes]) => {
        if (imageRes.code === 0) setImages(normalizeGalleryImages(imageRes.data));
        if (tagRes.code === 0) {
          setTags(
            Array.isArray(tagRes.data)
              ? tagRes.data
                  .map((item: unknown) => {
                    if (typeof item === "string") return item;
                    if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
                      return (item as { name: string }).name;
                    }
                    return "";
                  })
                  .filter(Boolean)
              : [],
          );
        }
      })
      .catch(() => setError("图片加载失败"))
      .finally(() => setLoadingImages(false));
  }, [selectedSourceType]);

  useEffect(() => {
    if (!selectedSourceType) return;
    const tagParam = selectedTag ? `&tag=${encodeURIComponent(selectedTag)}` : "";
    setLoadingImages(true);
    setError("");
    apiGet(`/api/gallery/finals?source_type=${encodeURIComponent(selectedSourceType)}${tagParam}&page_size=30`)
      .then((res) => {
        if (res.code === 0) setImages(normalizeGalleryImages(res.data));
      })
      .catch(() => setError("图片加载失败"))
      .finally(() => setLoadingImages(false));
  }, [selectedTag, selectedSourceType]);

  useEffect(() => {
    apiGet("/api/assets?category=logo&page=1&page_size=50")
      .then((res) => {
        if (res.code === 0) setLogoAssets(normalizeLogoAssets(res.data));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPosition((current) => ({
      ...current,
      height: autoHeight(current.width, logoAspect, previewAspect),
    }));
  }, [logoAspect, previewAspect]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!draggingRef.current || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      const x = ((event.clientX - rect.left - dragOffsetRef.current.x) / rect.width) * 100;
      const y = ((event.clientY - rect.top - dragOffsetRef.current.y) / rect.height) * 100;
      setPosition((current) => ({
        ...current,
        x: Math.max(-50, Math.min(150, x)),
        y: Math.max(-50, Math.min(150, y)),
      }));
    };
    const handleMouseUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const toggleImage = (id: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const goNext = () => {
    setError("");
    if (step === 1 && selectedImages.length === 0) {
      setError(t("至少选择一张图片"));
      return;
    }
    if (step === 2 && !selectedLogo) {
      setError(t("请先选择Logo"));
      return;
    }
    setStep((current) => Math.min(3, current + 1) as Step);
  };

  const handleLogoMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    draggingRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handleWidthChange = (width: number) => {
    const height = autoHeight(width, logoAspect, previewAspect);
    setPosition((current) => ({
      ...current,
      width,
      height,
      x: Math.min(current.x, 100 - width),
      y: Math.min(current.y, 100 - height),
    }));
  };

  const startProcessing = async () => {
    if (!selectedLogo) {
      setError(t("请先选择Logo"));
      return;
    }
    setStep(3);
    setProcessing(true);
    setArchived(false);
    setError("");
    try {
      const res = await apiPost<ResultItem[]>(
        "/api/logo/apply",
        {
          image_urls: selectedImages.map((image) => image.image_url),
          logo_asset_id: selectedLogo.id,
          position: {
            x: position.x / 100,
            y: position.y / 100,
            width: position.width / 100,
            height: position.height / 100,
          },
        },
        120000,
      );
      if (res.code !== 0) {
        setError(res.msg || "生成失败");
        return;
      }
      setResults(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError("生成失败");
    } finally {
      setProcessing(false);
    }
  };

  const downloadAll = async () => {
    if (results.length === 0) return;
    const token = localStorage.getItem("workbench_token") || "";
    const query = encodeURIComponent(results.map((item) => item.result_url).join(","));
    const response = await fetch(`${API_BASE}/api/logo/download-zip?urls=${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "logo_images.zip";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  };

  const downloadSingle = async (resultUrl: string, filename: string) => {
    try {
      const response = await fetch(toImageUrl(resultUrl));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "logo_image.jpg";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      alert("下载失败，请重试");
    }
  };

  const archiveResults = async () => {
    if (results.length === 0 || archiving || archived) return;
    setArchiving(true);
    setError("");
    try {
      const res = await apiPost("/api/logo/archive", {
        items: results.map((item) => ({
          result_url: item.result_url,
          original_url: item.original_url,
        })),
      });
      if (res.code !== 0) {
        setError(res.msg || "归档失败");
        return;
      }
      setArchived(true);
    } catch {
      setError("归档失败");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t("Logo水印")}</h1>
          <p className="mt-1 text-sm text-gray-500">3步完成批量水印、下载和归档</p>
        </div>
        {step === 3 && results.length > 0 && (
          <button
            onClick={downloadAll}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            {t("一键下载全部")}
          </button>
        )}
      </div>

      <div className="mb-8 flex items-center gap-1 overflow-x-auto pb-1">
        {stepLabels.map((label, index) => {
          const itemStep = (index + 1) as Step;
          const done = itemStep < step;
          const active = itemStep === step;
          return (
            <div key={label} className="flex flex-shrink-0 items-center gap-1">
              <div
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "bg-blue-600 text-white"
                    : done
                      ? "bg-green-100 text-green-700"
                      : "bg-gray-100 text-gray-400"
                }`}
              >
                <span>{done ? "✓" : itemStep}</span>
                <span>{label}</span>
              </div>
              {index < stepLabels.length - 1 && (
                <div className={`h-px w-8 flex-shrink-0 ${done ? "bg-green-300" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {step === 1 && (
        <section>
          <div className="mb-5 grid gap-3 md:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              source_type
              <select
                value={selectedSourceType}
                onChange={(event) => setSelectedSourceType(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {lang === "en" && category.label_en ? category.label_en : category.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              {t("标签")}
              <select
                value={selectedTag}
                onChange={(event) => setSelectedTag(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">{t("全部")}</option>
                {tags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loadingImages ? (
            <div className="py-16 text-center text-sm text-gray-400">{t("加载中...")}</div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {images.map((image) => {
                const selected = selectedIds.has(image.id);
                return (
                  <button
                    key={image.id}
                    onClick={() => toggleImage(image.id)}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 bg-gray-50 ${
                      selected ? "border-blue-500" : "border-gray-200 hover:border-blue-200"
                    }`}
                  >
                    <img src={toImageUrl(image.image_url)} alt="" className="h-full w-full object-cover" />
                    {selected && (
                      <span className="absolute top-2 right-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
            <div className="text-sm text-gray-500">已选 {selectedImages.length} 张</div>
            <button
              onClick={goNext}
              disabled={selectedImages.length === 0}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("下一步")}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">{t("模板图")}</div>
              {selectedImages.length > 1 && <div className="text-xs text-gray-400">共 {selectedImages.length} 张</div>}
            </div>
            <div ref={previewRef} className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
              {selectedImages[0] && (
                <img
                  src={toImageUrl(selectedImages[0].image_url)}
                  alt=""
                  className="block w-full select-none"
                  draggable={false}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalHeight > 0) setPreviewAspect(image.naturalWidth / image.naturalHeight);
                  }}
                />
              )}
              {selectedLogoUrl && (
                <div
                  onMouseDown={handleLogoMouseDown}
                  className="absolute cursor-move select-none"
                  style={{
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    width: `${position.width}%`,
                    height: `${position.height}%`,
                  }}
                >
                  <img
                    src={toImageUrl(selectedLogoUrl)}
                    alt="logo"
                    className="h-full w-full object-contain"
                    draggable={false}
                    onLoad={(event) => {
                      const image = event.currentTarget;
                      if (image.naturalHeight > 0) setLogoAspect(image.naturalWidth / image.naturalHeight);
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-5">
            <div>
              <button
                onClick={() => setShowLogoPicker(true)}
                className="w-full rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
              >
                {selectedLogo ? t("重新选择Logo") : t("从素材库选择Logo")}
              </button>
              {selectedLogoUrl && (
                <div className="mt-3 flex items-center gap-3 rounded-lg border border-gray-200 p-3">
                  <img src={toImageUrl(selectedLogoUrl)} alt="" className="h-12 w-12 object-contain" />
                  <div className="min-w-0 text-sm text-gray-600">{selectedLogo?.name || `Logo #${selectedLogo?.id}`}</div>
                </div>
              )}
            </div>

            <label className="block text-sm font-medium text-gray-700">
              大小 {Math.round(position.width)}%
              <input
                type="range"
                min={10}
                max={80}
                step={1}
                value={position.width}
                onChange={(event) => handleWidthChange(Number(event.target.value))}
                className="mt-2 w-full"
              />
            </label>

            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              X: {Math.round(position.x)}% Y: {Math.round(position.y)}%
            </div>

            <button
              onClick={startProcessing}
              disabled={!selectedLogo || processing}
              className="w-full rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("开始生成")}
            </button>
          </aside>
        </section>
      )}

      {step === 3 && (
        <section>
          {processing ? (
            <div className="py-20 text-center text-sm text-gray-500">{t("生成中")}</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {results.map((item) => (
                  <div key={item.filename} className="rounded-lg border border-gray-200 p-3">
                    <button onClick={() => setPreviewUrl(item.result_url)} className="block aspect-square w-full overflow-hidden rounded bg-gray-50">
                      <img src={toImageUrl(item.result_url)} alt="" className="h-full w-full object-cover" />
                    </button>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => setPreviewUrl(item.result_url)}
                        className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        预览
                      </button>
                      <button
                        onClick={() => downloadSingle(item.result_url, item.filename)}
                        className="flex-1 rounded-lg bg-gray-900 px-3 py-1.5 text-center text-xs text-white hover:bg-gray-800"
                      >
                        下载
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                {archived ? (
                  <div className="flex items-center gap-3 text-sm text-green-600">
                    <span>{t("归档成功")}</span>
                    <Link href="/workbench/gallery?source_type=logo" className="text-blue-600 hover:underline">
                      {t("查看成品图库")}
                    </Link>
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">共 {results.length} 张结果</span>
                )}
                <button
                  onClick={archiveResults}
                  disabled={results.length === 0 || archiving || archived}
                  className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {archiving ? "归档中..." : t("归档到成品图库")}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step > 1 && (
        <div className="mt-6 flex justify-start">
          <button
            onClick={() => setStep((current) => Math.max(1, current - 1) as Step)}
            className="rounded-lg border border-gray-200 px-5 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            {t("上一步")}
          </button>
        </div>
      )}

      {showLogoPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(event) => {
            if (event.currentTarget === event.target) setShowLogoPicker(false);
          }}
        >
          <div className="w-[520px] max-w-[95vw] rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">{t("从素材库选择Logo")}</h2>
              <button onClick={() => setShowLogoPicker(false)} className="text-xl text-gray-400 hover:text-gray-600">
                ×
              </button>
            </div>
            <div className="grid max-h-[60vh] grid-cols-4 gap-3 overflow-y-auto">
              {logoAssets.map((asset) => {
                const url = asset.image_url || asset.url || asset.thumbnail_url || "";
                return (
                  <button
                    key={asset.id}
                    onClick={() => {
                      setSelectedLogo(asset);
                      setShowLogoPicker(false);
                    }}
                    className="aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50 hover:border-blue-400"
                  >
                    <img src={toImageUrl(url)} alt="" className="h-full w-full object-contain p-1" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={(event) => {
            if (event.currentTarget === event.target) setPreviewUrl("");
          }}
        >
          <img src={toImageUrl(previewUrl)} alt="" className="max-h-full max-w-full rounded-lg bg-white" />
        </div>
      )}
    </main>
  );
}
