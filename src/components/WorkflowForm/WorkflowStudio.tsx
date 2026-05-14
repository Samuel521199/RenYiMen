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
import { buildTaskViewerModel, inferMediaTypeFromResultUrl, resolveExpectedDurationMsForSku } from "@/lib/task-status-view";
import { getAtPath, iterateLeafFields } from "@/lib/workflow-utils";
import { BAILIAN_VIDEO_CREDITS_PER_SECOND } from "@/services/providers/BailianAdapter";
import type { TaskStatusViewModel } from "@/types/task-status";
import type { ImageFieldValue, MultiImageFieldValue } from "@/types/workflow";
import { fetchSkus } from "@/services/sku-api";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type { SkuCategory, SkuDefinition } from "@/types/sku-catalog";

/**
 * 工作流工作室：面向运营的功能入口，选择创作能力、填写表单并发起生成。
 */
export function WorkflowStudio() {
  const { data: session, status: sessionStatus } = useSession();
  const [showErrors, setShowErrors] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [skus, setSkus] = useState<SkuDefinition[]>([]);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<SkuCategory>("prompt");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);

  const bumpProfileBalance = useCallback(() => {
    setProfileRefreshKey((k) => k + 1);
  }, []);
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
      if (field.kind === "imageUpload") {
        if ((raw as ImageFieldValue | undefined)?.status === "uploading") return true;
      } else if (field.kind === "multiImageUpload") {
        const items = (raw as MultiImageFieldValue | undefined)?.items ?? [];
        if (items.some((it) => it.status === "uploading")) return true;
      }
    }
    return false;
  }, [schema, parameters, fieldPaths]);

  useEffect(() => {
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void (async () => {
      try {
        const res = await fetchSkus();
        if (cancelled) return;
        setSkus(res.skus);
        if (res.skus.length > 0) {
          // 默认选中第一个 prompt 类 SKU（如无则取第一个）
          const firstPrompt = res.skus.find((s) => s.category === "prompt") ?? res.skus[0];
          setActiveCategory(firstPrompt.category ?? "prompt");
          setSelectedSkuId(firstPrompt.skuId);
          useWorkflowStore.getState().setGatewaySelection(firstPrompt.skuId, firstPrompt.providerCode);
          useWorkflowStore.getState().hydrateSchema(firstPrompt.uiSchema);
        }
      } catch (e) {
        if (!cancelled) {
          setCatalogError(e instanceof Error ? e.message : "加载工作流列表失败");
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const errors = showErrors ? validate() : {};

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

  const applySku = useCallback(
    (sku: SkuDefinition) => {
      // 切换工作流时须结束上一任务的轮询；否则仍用旧 taskId + 新 providerCode 查询，易永久卡在「生成中」
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
  }, [
    activeTaskId,
    pollData,
    isPolling,
    transportError,
    consecutiveErrors,
    elapsedMs,
    expectedDurationMs,
  ]);

  const displayViewerModel = useMemo((): TaskStatusViewModel | null => {
    if (viewingHistoryId) {
      const item = cloudHistory.find((h) => h.taskId === viewingHistoryId);
      if (!item) return viewerModel;
      const url = item.resultUrl?.trim();
      if (url) {
        /** 与当前任务成功态一致：右侧画板展示成片 */
        const mediaType =
          item.mediaType === "image" || item.mediaType === "video"
            ? item.mediaType
            : inferMediaTypeFromResultUrl(url);
        return {
          phase: "success",
          videoUrl: url,
          mediaType,
          hints: [],
        };
      }
    }
    return viewerModel;
  }, [viewingHistoryId, cloudHistory, viewerModel]);

  useEffect(() => {
    void useWorkflowStore.getState().fetchCloudHistory();
  }, []);

  const lastSyncedSucceededTask = useRef<string | null>(null);
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

  const handleSubmitToGateway = useCallback(async () => {
    setViewingHistoryId(null);
    if (!selectedSku) {
      setSubmitError("请先选择一项创作功能");
      return;
    }

    setShowErrors(true);
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setSubmitError(null);
      return;
    }

    const built = buildPayload();
    if (!built) {
      setSubmitError("信息不完整，请检查必填项与图片是否已上传完成");
      return;
    }
    if (!built.skuId || !built.providerCode) {
      setSubmitError("请先在左侧重新选择一项创作功能，再点击生成");
      return;
    }

    setSubmitError(null);
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
      try {
        json = await res.json();
      } catch {
        setSubmitError("服务器返回异常，请稍后重试");
        return;
      }

      const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
      if (!res.ok || !rec || rec.ok !== true) {
        const code = rec && typeof rec.code === "string" ? rec.code : "";
        const baseMsg =
          rec && typeof rec.error === "string"
            ? rec.error
            : `提交失败（HTTP ${res.status}）`;
        const msg =
          res.status === 401 || code === "UNAUTHORIZED" || baseMsg === "未登录"
            ? `${baseMsg}：请点击页面上方「登录」后重试。`
            : baseMsg;
        setSubmitError(msg);
        return;
      }

      const tid = rec.taskId;
      if (typeof tid !== "string" || !tid.trim()) {
        setSubmitError("未收到任务编号，请稍后重试或联系管理员");
        return;
      }

      setActiveTaskId(tid.trim());
    } catch (e) {
      console.error("[WorkflowStudio] 提单网络异常", e);
      setSubmitError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedSku, validate, buildPayload, resetPoll, setViewingHistoryId]);

  const onStudioFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    (e) => {
      e.preventDefault();
      void handleSubmitToGateway();
    },
    [handleSubmitToGateway]
  );

  const handleRegenerate = useCallback(() => {
    resetPoll();
    setActiveTaskId(null);
    setSubmitError(null);
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
    ? "等待图片上传..."
    : isSubmitting
      ? "提交中…"
      : "立即生成";

  const CATEGORY_TABS: { key: SkuCategory; label: string; icon: string }[] = [
    { key: "prompt", label: "提示词", icon: "✦" },
    { key: "image",  label: "图片",   icon: "◈" },
    { key: "video",  label: "视频",   icon: "▶" },
  ];
  const visibleSkus = skus.filter((s) => s.category === activeCategory);

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1728]">
      {/* ── 顶部导航栏 ── */}
      <nav className="sticky top-0 z-50 border-b border-[#1e2d4a] bg-[#0f1728]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-3">
          {/* 品牌 */}
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 shadow-lg shadow-emerald-500/20">
              <span className="text-[11px] font-black tracking-tighter text-white">AI</span>
            </div>
            <div className="hidden sm:block">
              <span className="text-sm font-semibold text-slate-200 tracking-tight">创作工作室</span>
              <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">Beta</span>
            </div>
          </div>

          {/* 右侧 Auth 区 */}
          <NavAuthZone
            session={session}
            sessionStatus={sessionStatus}
            profileRefreshKey={profileRefreshKey}
            onSignIn={() => void signIn(undefined, { callbackUrl: "/" })}
            onSignOut={() => void signOut({ callbackUrl: "/" })}
          />
        </div>
      </nav>

      {/* ── 主内容区 ── */}
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 py-6 lg:px-6 lg:py-8">
        {/* 页面标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 lg:text-3xl">
            AI 创作工作室
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            选择创作功能，上传素材，一键生成高质量 AI 内容
          </p>
        </div>

        {/* 两栏布局 */}
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12 lg:items-start lg:gap-5">

          {/* ── 左侧：功能选择 + 参数表单 ── */}
          <aside className="lg:col-span-5 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto lg:[scrollbar-width:thin] lg:[scrollbar-color:rgba(100,130,180,0.25)_transparent] lg:[&::-webkit-scrollbar]:w-1 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-slate-600/40">
            {/* 功能选择卡 */}
            <div className="rounded-2xl border border-[#1e2d4a] bg-[#152035] p-5 shadow-lg shadow-black/20">
              <div className="mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">选择创作功能</h2>
              </div>

              {catalogLoading && (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-emerald-400" />
                  正在加载…
                </div>
              )}
              {catalogError && (
                <div className="rounded-xl border border-red-500/20 bg-red-900/20 px-4 py-3 text-sm text-red-400">
                  {catalogError}
                </div>
              )}
              {!catalogLoading && !catalogError && skus.length === 0 && (
                <p className="text-sm text-amber-400/70">暂无可用功能，请联系管理员。</p>
              )}

              {!catalogLoading && !catalogError && skus.length > 0 && (
                <div className="space-y-3">
                  {/* Category Tabs */}
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#0f1728] p-1">
                    {CATEGORY_TABS.map((tab) => {
                      const count = skus.filter((s) => s.category === tab.key).length;
                      const isActive = activeCategory === tab.key;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveCategory(tab.key)}
                          className={[
                            "flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all duration-200",
                            isActive
                              ? "bg-[#1e2d4a] text-slate-200 shadow-sm"
                              : "text-slate-500 hover:text-slate-300",
                          ].join(" ")}
                        >
                          <span className="text-[10px]">{tab.icon}</span>
                          <span>{tab.label}</span>
                          <span className={[
                            "rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none",
                            isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-700/60 text-slate-500",
                          ].join(" ")}>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* SKU 卡片列表 */}
                  <div className="space-y-2">
                    {visibleSkus.map((sku) => {
                      const active = sku.skuId === selectedSkuId;
                      return (
                        <button
                          key={sku.skuId}
                          type="button"
                          onClick={() => applySku(sku)}
                          className={[
                            "group w-full rounded-xl border p-4 text-left transition-all duration-200",
                            active
                              ? "border-emerald-500/40 bg-emerald-500/[0.07] ring-1 ring-emerald-500/20 shadow-md shadow-emerald-900/20"
                              : "border-[#1e2d4a] bg-[#0f1728]/60 hover:border-[#2a3d5e] hover:bg-[#162038]",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className={[
                              "text-sm font-semibold leading-tight",
                              active ? "text-slate-100" : "text-slate-300 group-hover:text-slate-100",
                            ].join(" ")}>{sku.displayName}</p>
                            <span className={[
                              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                              active
                                ? "bg-emerald-500/20 text-emerald-300"
                                : "bg-slate-700/50 text-slate-400",
                            ].join(" ")}>{sku.sellCredits} 积分</span>
                          </div>
                          {sku.description && (
                            <p className={[
                              "mt-1.5 line-clamp-2 text-[11px] leading-relaxed",
                              active ? "text-slate-400" : "text-slate-500",
                            ].join(" ")}>{sku.description}</p>
                          )}
                        </button>
                      );
                    })}
                    {visibleSkus.length === 0 && (
                      <p className="py-6 text-center text-sm text-slate-600">该分类暂无可用功能</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 参数表单卡 */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-[#1e2d4a] bg-[#152035] shadow-lg shadow-black/20">
              {schema ? (
                <DynamicForm
                  schema={schema}
                  errors={errors}
                  onSubmit={onStudioFormSubmit}
                  formFooter={
                    <div className="space-y-4 border-t border-[#1e2d4a] pt-4">
                      {showErrors && Object.keys(errors).length > 0 && (
                        <div className="rounded-xl border border-red-500/25 bg-red-900/20 p-3.5 text-sm">
                          <p className="font-semibold text-red-400">请修正以下问题</p>
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

                      {/* 积分预估 */}
                      {selectedSku && !hasImageUploadInFlight && !isSubmitting && (
                        <p className="text-[11px] text-[#4a6880]">
                          {bailianEstimate ? (
                            <>预计消耗约 <span className="font-semibold text-[#2c4f6a]">{bailianEstimate.credits.toLocaleString("zh-CN")}</span> 积分（{bailianEstimate.sec}s × {BAILIAN_VIDEO_CREDITS_PER_SECOND}，以实际结算为准）</>
                          ) : (
                            <>预计消耗约 <span className="font-semibold text-[#2c4f6a]">{selectedSku.sellCredits}</span> 积分（以实际结算为准）</>
                          )}
                        </p>
                      )}

                      {/* 操作按钮组 */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="submit"
                          disabled={isSubmitting || hasImageUploadInFlight || !selectedSku || sessionStatus !== "authenticated"}
                          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-teal-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                        >
                          {isSubmitting ? (
                            <>
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              提交中…
                            </>
                          ) : hasImageUploadInFlight ? (
                            <>
                              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                              上传中…
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
                          清空
                        </button>
                        {activeTaskId && (
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            className="rounded-xl border border-[#3a5070] bg-[#1e3050] px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-[#4a6888] hover:bg-[#243860] hover:text-slate-100"
                          >
                            关闭任务
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
                  <p className="text-center text-sm text-[#4a6880]">请先选择一项创作功能以加载参数表单</p>
                </div>
              )}
            </div>
          </aside>

          {/* ── 右侧：预览画板 + 历史记录 ── */}
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

/** 顶部导航栏右侧 Auth 区域 */
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
  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-slate-400" />
        加载中…
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="flex items-center gap-2.5">
        <span className="hidden text-xs text-slate-500 sm:block">请登录后开始创作</span>
        <Link
          href="/auth/register?callbackUrl=%2F"
          className="hidden rounded-lg border border-[#2a3d5e] px-3.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-[#3a5070] hover:text-slate-200 sm:inline-flex"
        >
          注册
        </Link>
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-900/30 transition-all hover:bg-emerald-400"
        >
          登录
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <UserCredits refreshKey={profileRefreshKey ?? 0} />
      <div className="hidden h-4 w-px bg-slate-700 sm:block" />
      <span className="hidden max-w-[160px] truncate text-xs text-slate-400 sm:block">
        {session?.user?.email ?? session?.user?.name ?? "用户"}
      </span>
      <button
        type="button"
        onClick={onSignOut}
        className="rounded-lg border border-[#2a3d5e] px-3 py-1.5 text-xs font-medium text-slate-400 transition-all hover:border-[#3a5070] hover:text-slate-200"
      >
        退出
      </button>
    </div>
  );
}
