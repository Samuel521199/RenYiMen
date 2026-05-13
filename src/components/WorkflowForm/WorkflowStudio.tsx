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
import type { SkuDefinition } from "@/types/sku-catalog";

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
          const first = res.skus[0];
          setSelectedSkuId(first.skuId);
          useWorkflowStore.getState().setGatewaySelection(first.skuId, first.providerCode);
          useWorkflowStore.getState().hydrateSchema(first.uiSchema);
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
      : "🚀 立即生成";

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 lg:py-10">
      <StudioAuthBar
        session={session}
        sessionStatus={sessionStatus}
        profileRefreshKey={profileRefreshKey}
        onSignIn={() => void signIn(undefined, { callbackUrl: "/" })}
        onSignOut={() => void signOut({ callbackUrl: "/" })}
      />

      <header className="mb-8 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">工作流工作室</h1>
        <p className="text-sm leading-relaxed text-neutral-600">
          在这里选择您需要的 AI 创作功能，上传素材并填写简单的描述，一键生成高质量的 AI 内容。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-8">
        <aside
          className="space-y-8 lg:col-span-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1 lg:[scrollbar-width:thin] lg:[scrollbar-color:rgba(163,163,163,0.65)_transparent] lg:[&::-webkit-scrollbar]:w-1.5 lg:[&::-webkit-scrollbar-thumb]:rounded-full lg:[&::-webkit-scrollbar-thumb]:bg-neutral-300/70 lg:[&::-webkit-scrollbar-track]:bg-transparent"
        >
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-neutral-900">选择创作功能</h2>
            {catalogLoading && <p className="text-sm text-neutral-500">正在加载功能列表…</p>}
            {catalogError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                {catalogError}
              </div>
            )}
            {!catalogLoading && !catalogError && skus.length === 0 && (
              <p className="text-sm text-amber-800">暂无可用的创作功能，请联系管理员检查配置。</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {skus.map((sku) => {
                const active = sku.skuId === selectedSkuId;
                return (
                  <button
                    key={sku.skuId}
                    type="button"
                    onClick={() => applySku(sku)}
                    className={[
                      "rounded-xl border p-4 text-left transition-shadow",
                      active
                        ? "border-emerald-600 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-600"
                        : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm",
                    ].join(" ")}
                  >
                    <p className="text-sm font-semibold text-neutral-900">{sku.displayName}</p>
                    {sku.description && (
                      <p className="mt-1 line-clamp-6 text-xs leading-relaxed text-neutral-600">{sku.description}</p>
                    )}
                    <p className="mt-2 text-xs font-medium text-emerald-800">{sku.sellCredits} 积分</p>
                  </button>
                );
              })}
            </div>
          </section>

          {schema ? (
            <DynamicForm
              schema={schema}
              errors={errors}
              onSubmit={onStudioFormSubmit}
              formFooter={
                <div className="space-y-6 pt-2">
                  {showErrors && Object.keys(errors).length > 0 && (
                    <section className="rounded-lg border border-red-200 bg-red-50/80 p-4 text-sm">
                      <p className="font-medium text-red-900">请修正以下问题</p>
                      <ul className="mt-2 list-inside list-disc text-red-800">
                        {Object.entries(errors).map(([id, msg]) => (
                          <li key={id}>
                            <span className="text-xs text-neutral-700">「{id}」</span> {msg}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="space-y-4 border-t border-neutral-200 pt-6">
                    <div>
                      <h2 className="text-lg font-semibold text-neutral-900">生成</h2>
                      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                        提交后，进度与成片会显示在右侧；底部可查看历史记录并切换预览。
                      </p>
                    </div>

                    {submitError && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        {submitError}
                      </div>
                    )}

                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <button
                        type="submit"
                        disabled={
                          isSubmitting ||
                          hasImageUploadInFlight ||
                          !selectedSku ||
                          sessionStatus !== "authenticated"
                        }
                        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitPrimaryLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowErrors(false);
                          setSubmitError(null);
                          reset();
                        }}
                        className="rounded-md border border-transparent px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                      >
                        清空内容
                      </button>
                      {activeTaskId && (
                        <button
                          type="button"
                          onClick={handleRegenerate}
                          className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                        >
                          关闭任务视图
                        </button>
                      )}
                    </div>
                    {selectedSku && !hasImageUploadInFlight && !isSubmitting && (
                      <p className="text-xs text-neutral-500">
                        {bailianEstimate ? (
                          <>
                            预计消耗约 {bailianEstimate.credits.toLocaleString("zh-CN")} 积分
                            <span className="text-neutral-400">
                              （{bailianEstimate.sec} 秒 × {BAILIAN_VIDEO_CREDITS_PER_SECOND}，未含底图存储等杂项，以实际结算为准）
                            </span>
                          </>
                        ) : (
                          <>预计消耗约 {selectedSku.sellCredits} 积分（以实际结算为准）</>
                        )}
                      </p>
                    )}
                  </section>
                </div>
              }
            />
          ) : (
            <p className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
              请先在左侧选择一项创作功能以加载表单
            </p>
          )}
        </aside>

        <div className="flex min-h-[min(600px,calc(100vh-6rem))] flex-col lg:col-span-7 lg:min-h-[calc(100vh-8rem)]">
          <TaskStatusViewer
            model={displayViewerModel}
            onRegenerate={handleRegenerate}
            downloadFileName="workflow-studio.mp4"
            className="h-full w-full flex-1"
          />
          {cloudHistory.length > 0 && (
            <div className="shrink-0 border-t border-neutral-200 bg-neutral-50/80 px-2">
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
  );
}

function StudioAuthBar({
  session,
  sessionStatus,
  profileRefreshKey,
  onSignIn,
  onSignOut,
}: {
  session: Session | null;
  sessionStatus: "loading" | "authenticated" | "unauthenticated";
  /** 任务结算等场景下递增，触发积分立即刷新 */
  profileRefreshKey?: number;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (sessionStatus === "loading") {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
        正在检查登录状态…
      </div>
    );
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-medium">需要先登录</p>
          <p className="text-xs leading-relaxed text-amber-900/90">
            使用「生成」前请先登录。可注册邮箱账号，或使用「登录」进入登录页；若管理员已开启 GitHub
            登录，也可在登录页选用。
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <Link
            href="/auth/register?callbackUrl=%2F"
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-amber-800/30 bg-white px-4 py-2 text-center text-sm font-medium text-amber-950 hover:bg-amber-100/60"
          >
            注册账号
          </Link>
          <button
            type="button"
            onClick={onSignIn}
            className="shrink-0 rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900"
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
      <p>
        已登录：<span className="font-medium">{session?.user?.email ?? session?.user?.name ?? "用户"}</span>
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <UserCredits refreshKey={profileRefreshKey ?? 0} />
        <button
          type="button"
          onClick={onSignOut}
          className="shrink-0 rounded-md border border-emerald-700/40 bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100/80"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
