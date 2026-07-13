"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEventHandler } from "react";
import type { Session } from "next-auth";
import Link from "next/link";
import { signIn, signOut, useSession } from "next-auth/react";
import { HistoryFilmstrip } from "@/components/TaskStatusViewer/HistoryFilmstrip";
import { TaskStatusViewer } from "@/components/TaskStatusViewer/TaskStatusViewer";
import { UserCredits } from "@/components/Sidebar/UserCredits";
import { DynamicForm } from "@/components/WorkflowForm/DynamicForm";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import {
  buildTaskViewerModel,
  inferMediaTypeFromResultUrl,
  resolveExpectedDurationMsForSku,
} from "@/lib/task-status-view";
import { autoSaveGeneratedResultsToWorkbenchAssets } from "@/lib/workbench-asset-autosave";
import { getAtPath, iterateLeafFields } from "@/lib/workflow-utils";
import { BAILIAN_VIDEO_CREDITS_PER_SECOND } from "@/services/providers/BailianAdapter";
import type { TaskStatusViewModel } from "@/types/task-status";
import type { ImageFieldValue, MultiImageFieldValue } from "@/types/workflow";
import { fetchSkus } from "@/services/sku-api";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type { SkuCategory, SkuDefinition } from "@/types/sku-catalog";
import { useLanguage, useT } from "@/i18n";

// ─── View type ──────────────────────────────────────────────────────────────

type View = "gallery" | "studio";

// ─── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_ICON: Record<SkuCategory, string> = {
  prompt: "✦",
  image: "◈",
  video: "▶",
};

const CATEGORY_BG: Record<SkuCategory, string> = {
  prompt: "from-violet-950/80 via-indigo-950/60 to-[#0a0f1e]",
  image: "from-teal-950/80 via-cyan-950/50 to-[#0a0f1e]",
  video: "from-rose-950/80 via-orange-950/50 to-[#0a0f1e]",
};

// ─── WorkflowStudio ──────────────────────────────────────────────────────────

/**
 * 工作流工作室：画廊封面选择 → 进入工作室填参数并发起生成。
 */
export function WorkflowStudio({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: session, status: sessionStatus } = useSession();
  const t = useT();
  const { locale, toggleLocale } = useLanguage();

  const [view, setView] = useState<View>("gallery");
  const [showErrors, setShowErrors] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoSaveToAssetLibrary, setAutoSaveToAssetLibrary] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [autoSaveNotice, setAutoSaveNotice] = useState<string | null>(null);

  const [skus, setSkus] = useState<SkuDefinition[]>([]);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<SkuCategory>("prompt");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  const bumpProfileBalance = useCallback(() => setProfileRefreshKey((k) => k + 1), []);

  const validate = useWorkflowStore((s) => s.validate);
  const buildPayload = useWorkflowStore((s) => s.buildPayload);
  const reset = useWorkflowStore((s) => s.reset);
  const parameters = useWorkflowStore((s) => s.parameters);
  const schema = useWorkflowStore((s) => s.schema);
  const hydrateSchema = useWorkflowStore((s) => s.hydrateSchema);
  const setGatewaySelection = useWorkflowStore((s) => s.setGatewaySelection);
  const gatewayProviderCode = useWorkflowStore((s) => s.gatewayProviderCode);
  const fieldPaths = useWorkflowStore((s) => s.fieldPaths);
  const setViewingHistoryId = useWorkflowStore((s) => s.setViewingHistoryId);
  const viewingHistoryId = useWorkflowStore((s) => s.viewingHistoryId);
  const cloudHistory = useWorkflowStore((s) => s.cloudHistory);
  const fetchCloudHistory = useWorkflowStore((s) => s.fetchCloudHistory);

  const selectedSku = useMemo(
    () => skus.find((s) => s.skuId === selectedSkuId) ?? null,
    [skus, selectedSkuId]
  );

  const hasImageUploadInFlight = useMemo(() => {
    if (!schema) return false;
    for (const field of iterateLeafFields(schema.fields)) {
      const p = fieldPaths[field.id];
      const raw = p ? getAtPath(parameters, p) : undefined;
      if (field.kind === "imageUpload" || field.kind === "videoUpload") {
        if ((raw as ImageFieldValue | undefined)?.status === "uploading") return true;
      } else if (field.kind === "multiImageUpload") {
        const items = (raw as MultiImageFieldValue | undefined)?.items ?? [];
        if (items.some((it) => it.status === "uploading")) return true;
      }
    }
    return false;
  }, [schema, parameters, fieldPaths]);

  // ── Load SKU catalog ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void (async () => {
      try {
        const res = await fetchSkus();
        if (cancelled) return;
        setSkus(res.skus);
      } catch (e) {
        if (!cancelled) setCatalogError(e instanceof Error ? e.message : t.catalogLoading);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errors = showErrors ? validate() : {};

  // ── Task polling ─────────────────────────────────────────────────────────
  const {
    data: pollData,
    isPolling,
    transportError,
    consecutiveErrors,
    elapsedMs,
    reset: resetPoll,
  } = useTaskPolling({
    taskId: activeTaskId,
    enabled: Boolean(activeTaskId),
    providerCode: gatewayProviderCode,
    initialDelayMs: 200,
    pendingPollBaseMs: 1800,
    pendingPollMaxMs: 8000,
    pendingBackoffFactor: 1.45,
    errorRetryInitialMs: 800,
    errorRetryMaxMs: 20_000,
    maxConsecutiveErrors: 0,
    onTerminal: bumpProfileBalance,
  });

  // ── SKU switch ───────────────────────────────────────────────────────────
  const applySku = useCallback(
    (sku: SkuDefinition) => {
      resetPoll();
      setActiveTaskId(null);
      setViewingHistoryId(null);
      setSelectedSkuId(sku.skuId);
      setGatewaySelection(sku.skuId, sku.providerCode);
      hydrateSchema(sku.uiSchema);
      setShowErrors(false);
      setSubmitError(null);
    },
    [hydrateSchema, setGatewaySelection, setViewingHistoryId, resetPoll]
  );

  const enterStudio = useCallback(
    (sku: SkuDefinition) => {
      if (sku.href) {
        window.location.assign(sku.href);
        return;
      }
      applySku(sku);
      setActiveCategory(sku.category);
      setView("studio");
    },
    [applySku]
  );

  const backToGallery = useCallback(() => {
    setView("gallery");
  }, []);

  // ── Expected duration / viewer model ────────────────────────────────────
  const expectedDurationMs = useMemo(
    () => resolveExpectedDurationMsForSku(selectedSku),
    [selectedSku]
  );

  const viewerModel = useMemo(() => {
    if (!activeTaskId) return null;
    return buildTaskViewerModel(pollData, {
      isPolling,
      transportError,
      consecutiveErrors,
      elapsedMs,
      expectedDurationMs,
    });
  }, [activeTaskId, pollData, isPolling, transportError, consecutiveErrors, elapsedMs, expectedDurationMs]);

  const displayViewerModel = useMemo((): TaskStatusViewModel | null => {
    if (viewingHistoryId) {
      const item = cloudHistory.find((h) => h.taskId === viewingHistoryId);
      if (!item) return viewerModel;
      const url = item.resultUrl?.trim();
      if (url) {
        const mediaType =
          item.mediaType === "image" || item.mediaType === "video"
            ? item.mediaType
            : inferMediaTypeFromResultUrl(url);
        return { phase: "success", videoUrl: url, mediaType, hints: [] };
      }
    }
    return viewerModel;
  }, [viewingHistoryId, cloudHistory, viewerModel]);

  useEffect(() => {
    void useWorkflowStore.getState().fetchCloudHistory();
  }, []);

  const lastSyncedSucceededTask = useRef<string | null>(null);
  const autoSavedTaskIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    lastSyncedSucceededTask.current = null;
  }, [activeTaskId]);

  useEffect(() => {
    if (viewingHistoryId) return;
    if (pollData?.status !== "succeeded" || !activeTaskId) return;
    if (lastSyncedSucceededTask.current === activeTaskId) return;
    lastSyncedSucceededTask.current = activeTaskId;
    void fetchCloudHistory();
  }, [viewingHistoryId, pollData?.status, activeTaskId, fetchCloudHistory]);

  useEffect(() => {
    if (!autoSaveToAssetLibrary || !selectedSku || !activeTaskId) return;
    if (pollData?.status !== "succeeded") return;
    if (autoSavedTaskIdsRef.current.has(activeTaskId)) return;

    const rawUrls = Array.isArray(pollData.resultUrls) && pollData.resultUrls.length > 0
      ? pollData.resultUrls
      : typeof pollData.resultUrl === "string" && pollData.resultUrl.trim()
        ? [pollData.resultUrl.trim()]
        : [];

    const explicitType =
      pollData.resultMediaType === "image" || pollData.resultMediaType === "video"
        ? pollData.resultMediaType
        : undefined;
    const items = rawUrls
      .map((url) => {
        const mediaType = explicitType ?? inferMediaTypeFromResultUrl(url);
        return mediaType === "image" || mediaType === "video" ? { url, mediaType } : null;
      })
      .filter((item): item is { url: string; mediaType: "image" | "video" } => item !== null);

    autoSavedTaskIdsRef.current.add(activeTaskId);
    if (items.length === 0) {
      setAutoSaveNotice(t.autoSaveNoResult);
      return;
    }

    setIsAutoSaving(true);
    setAutoSaveNotice(null);
    void (async () => {
      const summary = await autoSaveGeneratedResultsToWorkbenchAssets({
        taskId: activeTaskId,
        skuId: selectedSku.skuId,
        skuCategory: selectedSku.category,
        items,
      });
      if (summary.saved > 0 && summary.failed === 0) {
        setAutoSaveNotice(t.autoSaveDone(summary.saved));
      } else if (summary.saved > 0) {
        setAutoSaveNotice(t.autoSavePartial(summary.saved, summary.failed));
      } else {
        setAutoSaveNotice(t.autoSaveFailed(summary.errors[0] ?? "unknown error"));
      }
      setIsAutoSaving(false);
    })();
  }, [autoSaveToAssetLibrary, selectedSku, activeTaskId, pollData, t]);

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSubmitToGateway = useCallback(async () => {
    setViewingHistoryId(null);
    if (!selectedSku) { setSubmitError(t.errSelectSku); return; }
    // 轮询进行中或已有提交在途，禁止重复提交
    if (isSubmitting || isPolling) return;

    setShowErrors(true);
    const errs = validate();
    if (Object.keys(errs).length > 0) { setSubmitError(null); return; }

    const built = buildPayload();
    if (!built) { setSubmitError(t.errIncomplete); return; }
    if (!built.skuId || !built.providerCode) { setSubmitError(t.errMissingSku); return; }

    setSubmitError(null);
    setAutoSaveNotice(null);
    setIsSubmitting(true);
    resetPoll();
    setActiveTaskId(null);
    try {
      const res = await fetch("/api/gateway/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(built),
      });
      let json: unknown;
      try { json = await res.json(); } catch { setSubmitError(t.errServerAbnormal); return; }

      const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!res.ok || !rec || rec.ok !== true) {
        const code = rec && typeof rec.code === "string" ? rec.code : "";
        const baseMsg =
          rec && typeof rec.error === "string" ? rec.error : t.errHttpFail(res.status);
        const msg =
          res.status === 401 || code === "UNAUTHORIZED" || baseMsg === t.errUnauthorized
            ? t.errLoginRequired(baseMsg)
            : code === "CONCURRENT_LIMIT_EXCEEDED"
              ? t.errConcurrentLimit
              : code === "DB_WRITE_FAILED"
                ? t.errDbWriteFailed(rec && typeof rec.taskId === "string" ? rec.taskId : "unknown")
                : baseMsg;
        setSubmitError(msg);
        return;
      }
      const tid = rec.taskId;
      if (typeof tid !== "string" || !tid.trim()) { setSubmitError(t.errNoTaskId); return; }
      setActiveTaskId(tid.trim());
    } catch (e) {
      console.error("[WorkflowStudio] 提单网络异常", e);
      setSubmitError(e instanceof Error ? e.message : t.errNetwork);
    } finally {
      setIsSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, validate, buildPayload, resetPoll, setViewingHistoryId]);

  const onStudioFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    (e) => { e.preventDefault(); void handleSubmitToGateway(); },
    [handleSubmitToGateway]
  );

  const handleRegenerate = useCallback(() => {
    resetPoll();
    setActiveTaskId(null);
    setSubmitError(null);
    setAutoSaveNotice(null);
  }, [resetPoll]);

  const bailianEstimate = useMemo(() => {
    if (!selectedSku || selectedSku.skuId !== "BAILIAN_WANX_I2V" || !schema) return null;
    const p = fieldPaths.duration;
    const raw = p ? getAtPath(parameters, p) : undefined;
    let sec = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 5;
    sec = Math.min(15, Math.max(3, sec));
    const credits = sec * BAILIAN_VIDEO_CREDITS_PER_SECOND;
    return { sec, credits };
  }, [selectedSku, schema, fieldPaths, parameters]);

  const submitPrimaryLabel = hasImageUploadInFlight
    ? t.submitBtnUploading
    : isSubmitting
      ? t.submitBtnSubmitting
      : isPolling
        ? t.submitBtnSubmitting
        : t.submitBtn;

  const CATEGORY_TABS: { key: SkuCategory; label: string }[] = [
    { key: "prompt", label: t.categoryPrompt },
    { key: "image", label: t.categoryImage },
    { key: "video", label: t.categoryVideo },
  ];

  const visibleSkus = skus.filter((s) => s.category === activeCategory);
  const selectedSkuName = selectedSku
    ? (locale === "en" && selectedSku.displayNameEn ? selectedSku.displayNameEn : selectedSku.displayName)
    : "";

  // ──────────────────────────────────────────────────────────────────────────
  // Shared nav (renders differently for gallery vs studio)
  // ──────────────────────────────────────────────────────────────────────────
  const renderNav = embedded ? null : (
    <nav className="sticky top-0 z-50 border-b border-[#1a2540]/80 bg-[#07101f]/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        {/* Left: brand OR back button + breadcrumb */}
        <div className="flex min-w-0 items-center gap-3">
          {view === "studio" ? (
            <>
              <button
                type="button"
                onClick={backToGallery}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#2a3d5e] px-3 py-1.5 text-xs font-medium text-slate-400 transition-all hover:border-[#3f5880] hover:text-slate-200"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                {t.backToGallery}
              </button>
              {selectedSkuName && (
                <>
                  <span className="hidden h-4 w-px shrink-0 bg-slate-700 sm:block" />
                  <span className="hidden min-w-0 truncate text-sm font-medium text-slate-300 sm:block">
                    {selectedSkuName}
                  </span>
                </>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/20">
                <span className="text-[11px] font-black tracking-tighter text-white">AI</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-sm font-semibold tracking-tight text-slate-200">{t.brandName}</span>
                <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  {t.brandBadge}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: lang toggle + auth */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleLocale}
            title={locale === "zh" ? "Switch to English" : "切换为中文"}
            className="flex items-center gap-1.5 rounded-lg border border-[#2a3d5e] px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-all hover:border-[#3f5880] hover:text-slate-200"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {locale === "zh" ? "EN" : "中文"}
          </button>
          <NavAuthZone
            session={session}
            sessionStatus={sessionStatus}
            profileRefreshKey={profileRefreshKey}
            onSignIn={() => void signIn(undefined, { callbackUrl: "/" })}
            onSignOut={() => void signOut({ callbackUrl: "/" })}
          />
        </div>
      </div>
    </nav>
  );

  // ──────────────────────────────────────────────────────────────────────────
  // GALLERY VIEW
  // ──────────────────────────────────────────────────────────────────────────
  if (view === "gallery") {
    return (
      <div className="flex min-h-screen flex-col bg-[#07101f]">
        {renderNav}

        {/* Hero section */}
        <div className="border-b border-[#1a2540]/60 bg-gradient-to-b from-[#0c1a30] to-[#07101f] px-4 pb-8 pt-10 sm:px-6">
          <div className="mx-auto max-w-[1400px]">
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t.pageTitle}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
              {t.pageSubtitle}
            </p>

            {/* Category tabs */}
            <div className="mt-6 flex flex-wrap items-center gap-2">
              {CATEGORY_TABS.map((tab) => {
                const count = skus.filter((s) => s.category === tab.key).length;
                const isActive = activeCategory === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveCategory(tab.key)}
                    className={[
                      "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                        : "bg-[#1a2844] text-slate-400 hover:bg-[#243560] hover:text-slate-200",
                    ].join(" ")}
                  >
                    <span className="text-xs leading-none">{CATEGORY_ICON[tab.key]}</span>
                    <span>{tab.label}</span>
                    {!catalogLoading && (
                      <span className={[
                        "rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums",
                        isActive ? "bg-white/20 text-white" : "bg-[#0d1929] text-slate-500",
                      ].join(" ")}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card grid */}
        <div className="flex-1 px-4 py-8 sm:px-6">
          <div className="mx-auto max-w-[1400px]">

            {/* Loading skeletons */}
            {catalogLoading && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl bg-[#111e34]">
                    <div className="aspect-video animate-pulse bg-[#1a2844]" />
                    <div className="space-y-2 bg-[#0e1929] px-4 py-3">
                      <div className="h-4 w-2/3 animate-pulse rounded-full bg-[#1a2844]" />
                      <div className="h-3 w-1/3 animate-pulse rounded-full bg-[#1a2844]" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {!catalogLoading && catalogError && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-900/20">
                  <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-sm text-red-400">{catalogError}</p>
              </div>
            )}

            {/* Empty */}
            {!catalogLoading && !catalogError && visibleSkus.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-20 text-center">
                <p className="text-sm text-slate-500">{t.categoryEmpty}</p>
              </div>
            )}

            {/* Cards */}
            {!catalogLoading && !catalogError && visibleSkus.length > 0 && (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleSkus.map((sku) => (
                  <WorkflowCard
                    key={sku.skuId}
                    sku={sku}
                    locale={locale}
                    categoryLabel={CATEGORY_TABS.find((c) => c.key === sku.category)?.label ?? ""}
                    creditsLabel={t.credits}
                    startLabel={t.startCreating}
                    onClick={() => enterStudio(sku)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STUDIO VIEW
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen flex-col bg-[#0f1728]">
      {renderNav}

      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-4 py-6 lg:px-6 lg:py-8">
        {/* Two-column layout */}
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">

          {/* ── Left: form only ── */}
          <aside className="lg:col-span-5 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:[scrollbar-width:thin] lg:[scrollbar-color:rgba(100,130,180,0.25)_transparent] lg:[&::-webkit-scrollbar]:w-1 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-slate-600/40">

            {/* Parameter form */}
            <div className="overflow-hidden rounded-2xl border border-[#1e2d4a] bg-[#152035] shadow-lg shadow-black/20">
              {schema ? (
                <DynamicForm
                  schema={schema}
                  errors={errors}
                  locale={locale}
                  onSubmit={onStudioFormSubmit}
                  formFooter={
                    <div className="space-y-4 border-t border-[#1e2d4a] pt-4">
                      {showErrors && Object.keys(errors).length > 0 && (
                        <div className="rounded-xl border border-red-500/25 bg-red-900/20 p-3.5 text-sm">
                          <p className="font-semibold text-red-400">{t.errFixFields}</p>
                          <ul className="mt-2 list-inside list-disc space-y-0.5 text-red-400/80">
                            {Object.entries(errors).map(([id, msg]) => (
                              <li key={id} className="text-xs">
                                <span className="text-slate-500">「{id}」</span> {msg}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {submitError && (
                        <div className="rounded-xl border border-amber-500/25 bg-amber-900/20 px-4 py-3 text-sm text-amber-400">
                          {submitError}
                        </div>
                      )}

                      {selectedSku && !hasImageUploadInFlight && !isSubmitting && (
                        <p className="text-[11px] text-[#4a6880]">
                          {bailianEstimate ? (
                            <>{t.estimateCreditsDynamic(bailianEstimate.credits, bailianEstimate.sec, BAILIAN_VIDEO_CREDITS_PER_SECOND)}</>
                          ) : (
                            <>{t.estimateCreditsFixed(selectedSku.sellCredits)}</>
                          )}
                        </p>
                      )}

                      <div className="rounded-xl border border-[#2a3d5e] bg-[#12233c] px-3.5 py-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={autoSaveToAssetLibrary}
                            onChange={(e) => setAutoSaveToAssetLibrary(e.target.checked)}
                            className="h-4 w-4 rounded border-[#3a5070] bg-[#0f1728] text-emerald-500 focus:ring-emerald-500/30"
                          />
                          {t.autoSaveToAssetToggle}
                        </label>
                        <p className="mt-1 text-[11px] text-[#6f8ba5]">{t.autoSaveToAssetHint}</p>
                      </div>

                      {(isAutoSaving || autoSaveNotice) && (
                        <div className="rounded-xl border border-[#2a3d5e] bg-[#13253f] px-3.5 py-2.5 text-xs text-slate-300">
                          {isAutoSaving ? t.autoSaveSaving : autoSaveNotice}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="submit"
                          disabled={isSubmitting || isPolling || hasImageUploadInFlight || !selectedSku || sessionStatus !== "authenticated"}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                        >
                          {isSubmitting ? (
                            <>
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              {t.submitBtnSubmitting}
                            </>
                          ) : hasImageUploadInFlight ? (
                            <>
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              {t.submitBtnUploading}
                            </>
                          ) : (
                            <>
                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                              {submitPrimaryLabel}
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowErrors(false); setSubmitError(null); reset(); }}
                          className="rounded-xl border border-[#3a5070] bg-[#1e3050] px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-[#4a6888] hover:bg-[#243860] hover:text-slate-100"
                        >
                          {t.resetBtn}
                        </button>
                        {activeTaskId && (
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            className="rounded-xl border border-[#3a5070] bg-[#1e3050] px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-[#4a6888] hover:bg-[#243860] hover:text-slate-100"
                          >
                            {t.closeTaskBtn}
                          </button>
                        )}
                      </div>
                    </div>
                  }
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-12">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#9bbdd8]/40">
                    <svg className="h-5 w-5 text-[#4a7a9b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                    </svg>
                  </div>
                  <p className="text-center text-sm text-[#4a6880]">{t.selectFunctionHint}</p>
                </div>
              )}
            </div>
          </aside>

          {/* ── Right: viewer + history ── */}
          <div className="flex min-h-[min(640px,calc(100vh-8rem))] flex-col overflow-hidden rounded-2xl border border-[#1e2d4a] bg-[#0d1a2e] shadow-xl shadow-black/25 lg:col-span-7 lg:min-h-[calc(100vh-7rem)]">
            <div className="flex-1">
              <TaskStatusViewer
                model={displayViewerModel}
                onRegenerate={handleRegenerate}
                downloadFileName="workflow-studio.mp4"
                className="h-full w-full"
              />
            </div>
            {cloudHistory.length > 0 && (
              <div className="shrink-0 border-t border-[#1e2d4a] bg-[#0f1728]/80 px-2">
                <HistoryFilmstrip
                  history={cloudHistory}
                  activeId={viewingHistoryId}
                  onSelect={setViewingHistoryId}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WorkflowCard ────────────────────────────────────────────────────────────

interface WorkflowCardProps {
  sku: SkuDefinition;
  locale: string;
  categoryLabel: string;
  creditsLabel: string;
  startLabel: string;
  onClick: () => void;
}

function WorkflowCard({ sku, locale, categoryLabel, creditsLabel, startLabel, onClick }: WorkflowCardProps) {
  const name = locale === "en" && sku.displayNameEn ? sku.displayNameEn : sku.displayName;
  const desc = locale === "en" && sku.descriptionEn ? sku.descriptionEn : sku.description;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl bg-[#111e34] shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-black/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07101f]"
    >
      {/* Cover image */}
      <div className="relative aspect-video w-full overflow-hidden">
        {sku.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sku.cover}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
          />
        ) : (
          <div className={`h-full w-full bg-gradient-to-br ${CATEGORY_BG[sku.category]}`}>
            <div className="flex h-full items-center justify-center">
              <span className="text-5xl opacity-20 select-none">{CATEGORY_ICON[sku.category]}</span>
            </div>
          </div>
        )}

        {/* Persistent bottom gradient overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#07101f]/85 via-[#07101f]/10 to-transparent" />

        {/* Badges row */}
        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
          <span className="rounded-full border border-white/10 bg-black/50 px-2.5 py-0.5 text-[11px] font-medium text-slate-300 backdrop-blur-sm">
            {categoryLabel}
          </span>
          <span className="rounded-full border border-emerald-500/25 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400 backdrop-blur-sm">
            {sku.sellCredits} {creditsLabel}
          </span>
        </div>

        {/* Description on hover */}
        {desc && (
          <div className="absolute bottom-0 left-0 right-0 translate-y-2 p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <p className="line-clamp-3 text-xs leading-relaxed text-slate-300">{desc}</p>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between bg-[#0e1929] px-4 py-3">
        <span className="truncate text-sm font-semibold text-slate-200">{name}</span>
        <span className="ml-3 flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-400 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {startLabel}
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </span>
      </div>
    </button>
  );
}

// ─── NavAuthZone ──────────────────────────────────────────────────────────────

function NavAuthZone({
  session,
  sessionStatus,
  profileRefreshKey,
  onSignIn,
  onSignOut,
}: {
  session: Session | null;
  sessionStatus: "loading" | "authenticated" | "unauthenticated";
  profileRefreshKey?: number;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const t = useT();

  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-slate-400" />
        {t.loading}
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="flex items-center gap-2.5">
        <span className="hidden text-xs text-slate-500 sm:block">{t.loginHint}</span>
        <Link
          href="/auth/register?callbackUrl=%2F"
          className="hidden rounded-lg border border-[#2a3d5e] px-3.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-[#3a5070] hover:text-slate-200 sm:inline-flex"
        >
          {t.registerBtn}
        </Link>
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-900/30 transition-all hover:bg-emerald-400"
        >
          {t.loginBtn}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <UserCredits refreshKey={profileRefreshKey ?? 0} />
      <div className="hidden h-4 w-px bg-slate-700 sm:block" />
      <span className="hidden max-w-[160px] truncate text-xs text-slate-400 sm:block">
        {session?.user?.email ?? session?.user?.name ?? t.defaultUserName}
      </span>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-lg border border-[#2a3d5e] px-3 py-1.5 text-xs font-medium text-slate-400 transition-all hover:border-[#3a5070] hover:text-slate-200"
      >
        {t.signOutBtn}
      </button>
    </div>
  );
}
