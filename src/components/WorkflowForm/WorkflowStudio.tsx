"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Star } from "lucide-react";
import type { Session } from "next-auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, signOut, useSession } from "next-auth/react";
import { HistoryFilmstrip } from "@/components/TaskStatusViewer/HistoryFilmstrip";
import { TaskStatusViewer } from "@/components/TaskStatusViewer/TaskStatusViewer";
import { UserCredits } from "@/components/Sidebar/UserCredits";
import { DynamicForm } from "@/components/WorkflowForm/DynamicForm";
import { FixedWorkflowPricing } from "@/components/WorkflowForm/FixedWorkflowPricing";
import { ToolProjectSelector } from "@/components/WorkflowForm/ToolProjectSelector";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import {
  buildTaskViewerModel,
  inferMediaTypeFromResultUrl,
  resolveExpectedDurationMsForSku,
} from "@/lib/task-status-view";
import { autoSaveGeneratedResultsToWorkbenchAssets } from "@/lib/workbench-asset-autosave";
import { cn } from "@/lib/utils";
import {
  readWorkflowFavoriteIds,
  workflowFavoritesStorageKey,
  writeWorkflowFavoriteIds,
} from "@/lib/workflow-favorites";
import {
  clearWorkflowDraft,
  loadWorkflowDraft,
  saveWorkflowDraft,
  sanitizeWorkflowDraftParameters,
} from "@/lib/workflow-draft-storage";
import { getAtPath, isWorkflowFieldVisible, iterateLeafFields } from "@/lib/workflow-utils";
import {
  BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND,
  BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND,
  BAILIAN_S2V_480P_CREDITS_PER_SECOND,
  BAILIAN_S2V_720P_CREDITS_PER_SECOND,
  BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND,
  BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND,
  BAILIAN_VIDEO_CREDITS_PER_SECOND,
  estimateBailianTripoCredits,
} from "@/services/providers/BailianAdapter";
import type { TaskStatusViewModel } from "@/types/task-status";
import type { ImageFieldValue, MultiImageFieldValue } from "@/types/workflow";
import { fetchSkus } from "@/services/sku-api";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import type { SkuCategory, SkuDefinition } from "@/types/sku-catalog";
import type { ToolProjectOutputState, ToolProjectRecord } from "@/types/tool-project";
import { useLanguage, useT } from "@/i18n";
import {
  readWorkbenchToolGroup,
  WORKBENCH_TOOL_SECTION_EVENT,
  WORKFLOW_STUDIO_HISTORY_STATE_KEY,
  type WorkbenchToolGroup as ToolGroup,
  type WorkbenchToolSectionEventDetail,
} from "@workbench/lib/tool-section-navigation";

// ─── View type ──────────────────────────────────────────────────────────────

type View = "gallery" | "studio";
type VideoGenerationTab = "image-to-video" | "video-continuation";
type VideoEditingTab = "ai-video-edit" | "motion-replica";
type SubtitleProcessState = "idle" | "processing" | "success" | "error";

const WORKFLOW_STUDIO_HISTORY_KEY = WORKFLOW_STUDIO_HISTORY_STATE_KEY;
const STUDIO_SPLIT_STORAGE_KEY = "workflow-studio-split-percent";
const DEFAULT_STUDIO_SPLIT_PERCENT = 58;
const MIN_STUDIO_SPLIT_PERCENT = 32;
const MAX_STUDIO_SPLIT_PERCENT = 72;

function clampStudioSplit(percent: number): number {
  return Math.round(Math.min(Math.max(percent, MIN_STUDIO_SPLIT_PERCENT), MAX_STUDIO_SPLIT_PERCENT) * 10) / 10;
}

// ─── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_ICON: Record<SkuCategory, string> = {
  prompt: "✦",
  image: "◈",
  video: "▶",
  model: "◇",
};

const CATEGORY_BG: Record<SkuCategory, string> = {
  prompt: "from-violet-950/80 via-indigo-950/60 to-[#0a0f1e]",
  image: "from-teal-950/80 via-cyan-950/50 to-[#0a0f1e]",
  video: "from-rose-950/80 via-orange-950/50 to-[#0a0f1e]",
  model: "from-violet-950/80 via-fuchsia-950/50 to-[#0a0f1e]",
};

const TOOL_GROUP_LABELS: Record<ToolGroup, { zh: string; en: string }> = {
  favorites: { zh: "我的收藏", en: "My Favorites" },
  "video-generation": { zh: "视频生成", en: "Video Generation" },
  "video-editing": { zh: "视频编辑", en: "Video Editing" },
  "audio-post": { zh: "音频后期", en: "Audio Post" },
};

const IMAGE_TO_VIDEO_SKU_IDS = new Set([
  "KLING_CINEMA_PRO",
  "KLING_STD_I2V",
  "BAILIAN_WANX_I2V",
  "BAILIAN_MULTI_REF_I2V",
  "RH_SVD_IMG2VID",
]);

const VIDEO_CONTINUATION_SKU_IDS = new Set([
  "BAILIAN_WAN27_VIDEO_CONTINUATION",
]);

const AI_VIDEO_EDITING_SKU_IDS = new Set([
  "RH_VIDEO_ENHANCE",
  "BAILIAN_WAN27_VIDEO_CONTINUATION",
  "BAILIAN_HAPPYHORSE_VIDEO_EDIT",
  "BAILIAN_SCENE_LIGHT_VIDEO_EDIT",
  "BAILIAN_OVERALL_STYLE_TRANSFER",
  "BAILIAN_HIGH_DYNAMIC_REDRAW",
]);

const WAN27_VIDEO_EDIT_SKU_IDS = new Set([
  "BAILIAN_WAN27_CAMERA_REPLICATION",
  "BAILIAN_WAN27_EFFECT_REPLICATION",
]);

const MOTION_REPLICA_SKU_IDS = new Set([
  "BAILIAN_WAN22_ANIMATE_MOVE",
  ...WAN27_VIDEO_EDIT_SKU_IDS,
]);

const VIDEO_EDITING_SKU_IDS = new Set([
  ...AI_VIDEO_EDITING_SKU_IDS,
  ...MOTION_REPLICA_SKU_IDS,
]);

const AUDIO_POST_SKU_IDS = new Set([
  "BAILIAN_WAN22_S2V",
  "BAILIAN_COSYVOICE_VOICE_DESIGN",
  "BAILIAN_VOICE_CLONE",
  "BAILIAN_EMOTIONAL_TTS",
  "LOCAL_AUTO_SUBTITLES",
]);

const VIDEO_EDITING_TABS: { key: VideoEditingTab; label: string; labelEn: string }[] = [
  { key: "ai-video-edit", label: "AI视频编辑微调", labelEn: "AI Video Editing" },
  { key: "motion-replica", label: "动态复刻", labelEn: "Motion Replica" },
];

const VIDEO_GENERATION_TABS: { key: VideoGenerationTab; label: string; labelEn: string }[] = [
  { key: "image-to-video", label: "图生视频", labelEn: "Image to Video" },
  { key: "video-continuation", label: "视频续写", labelEn: "Video Continuation" },
];

function isSkuInToolGroup(sku: SkuDefinition, group: ToolGroup): boolean {
  if (sku.category !== "video") return false;
  if (group === "audio-post") return AUDIO_POST_SKU_IDS.has(sku.skuId);
  if (group === "video-editing") return VIDEO_EDITING_SKU_IDS.has(sku.skuId);
  return IMAGE_TO_VIDEO_SKU_IDS.has(sku.skuId) || VIDEO_CONTINUATION_SKU_IDS.has(sku.skuId);
}

function isSkuInVideoGenerationTab(sku: SkuDefinition, tab: VideoGenerationTab): boolean {
  if (tab === "video-continuation") return VIDEO_CONTINUATION_SKU_IDS.has(sku.skuId);
  return IMAGE_TO_VIDEO_SKU_IDS.has(sku.skuId);
}

function isSkuInVideoEditingTab(sku: SkuDefinition, tab: VideoEditingTab): boolean {
  if (tab === "motion-replica") return MOTION_REPLICA_SKU_IDS.has(sku.skuId);
  return AI_VIDEO_EDITING_SKU_IDS.has(sku.skuId);
}

// ─── WorkflowStudio ──────────────────────────────────────────────────────────

/**
 * 工作流工作室：画廊封面选择 → 进入工作室填参数并发起生成。
 */
export function WorkflowStudio({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: session, status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
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
  const [subtitleState, setSubtitleState] = useState<SubtitleProcessState>("idle");
  const [captionedVideoUrl, setCaptionedVideoUrl] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [studioSplitPercent, setStudioSplitPercent] = useState(DEFAULT_STUDIO_SPLIT_PERCENT);
  const studioSplitRef = useRef(DEFAULT_STUDIO_SPLIT_PERCENT);
  const studioColumnsRef = useRef<HTMLDivElement>(null);
  const splitResizeActiveRef = useRef(false);
  const splitPreviousBodyStylesRef = useRef<{ cursor: string; userSelect: string } | null>(null);

  const [skus, setSkus] = useState<SkuDefinition[]>([]);
  const [favoriteSkuIds, setFavoriteSkuIds] = useState<Set<string>>(() => new Set());
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [toolProjects, setToolProjects] = useState<ToolProjectRecord[]>([]);
  const [selectedToolProjectId, setSelectedToolProjectId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectLoadRevision, setProjectLoadRevision] = useState(0);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<SkuCategory>("prompt");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const historyViewRestoredRef = useRef(false);
  const suppressedDraftSaveRef = useRef<string | null>(null);
  const suppressedProjectSaveRef = useRef<string | null>(null);
  const projectRequestSequenceRef = useRef(0);
  const routeToolGroup = readWorkbenchToolGroup(searchParams.get("group"));
  const [activeToolGroup, setActiveToolGroup] = useState<ToolGroup | null>(routeToolGroup);
  const [activeVideoGenerationTab, setActiveVideoGenerationTab] = useState<VideoGenerationTab>("image-to-video");
  const [activeVideoEditingTab, setActiveVideoEditingTab] = useState<VideoEditingTab>("ai-video-edit");
  const favoritesOwnerId = session?.user?.id ?? session?.user?.email ?? null;

  useEffect(() => {
    if (sessionStatus === "loading") return;
    const storageKey = workflowFavoritesStorageKey(favoritesOwnerId);
    const syncFavorites = (event?: StorageEvent) => {
      if (event && event.key !== storageKey) return;
      setFavoriteSkuIds(readWorkflowFavoriteIds(favoritesOwnerId));
    };
    syncFavorites();
    window.addEventListener("storage", syncFavorites);
    return () => window.removeEventListener("storage", syncFavorites);
  }, [favoritesOwnerId, sessionStatus]);

  const toggleFavoriteSku = useCallback((skuId: string) => {
    setFavoriteSkuIds((current) => {
      const next = new Set(current);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      writeWorkflowFavoriteIds(favoritesOwnerId, next);
      return next;
    });
  }, [favoritesOwnerId]);

  const applyStudioSplit = (percent: number, persist = false) => {
    const nextPercent = clampStudioSplit(percent);
    studioSplitRef.current = nextPercent;
    setStudioSplitPercent(nextPercent);
    if (persist) window.localStorage.setItem(STUDIO_SPLIT_STORAGE_KEY, String(nextPercent));
  };

  const finishStudioSplitResize = () => {
    if (!splitResizeActiveRef.current) return;
    splitResizeActiveRef.current = false;
    window.localStorage.setItem(STUDIO_SPLIT_STORAGE_KEY, String(studioSplitRef.current));
    const previous = splitPreviousBodyStylesRef.current;
    if (previous) {
      document.body.style.cursor = previous.cursor;
      document.body.style.userSelect = previous.userSelect;
      splitPreviousBodyStylesRef.current = null;
    }
  };

  useEffect(() => {
    const storedPercent = Number(window.localStorage.getItem(STUDIO_SPLIT_STORAGE_KEY));
    if (Number.isFinite(storedPercent) && storedPercent > 0) applyStudioSplit(storedPercent);
    return () => {
      if (splitPreviousBodyStylesRef.current) {
        document.body.style.cursor = splitPreviousBodyStylesRef.current.cursor;
        document.body.style.userSelect = splitPreviousBodyStylesRef.current.userSelect;
      }
    };
  }, []);

  const handleSplitPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    splitResizeActiveRef.current = true;
    splitPreviousBodyStylesRef.current = {
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitResizeActiveRef.current) return;
    const bounds = studioColumnsRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    applyStudioSplit(((event.clientX - bounds.left) / bounds.width) * 100);
  };

  const handleSplitPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishStudioSplitResize();
  };

  const handleSplitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextPercent: number | null = null;
    if (event.key === "ArrowLeft") nextPercent = studioSplitRef.current - 1;
    if (event.key === "ArrowRight") nextPercent = studioSplitRef.current + 1;
    if (event.key === "Home") nextPercent = MIN_STUDIO_SPLIT_PERCENT;
    if (event.key === "End") nextPercent = MAX_STUDIO_SPLIT_PERCENT;
    if (nextPercent === null) return;
    event.preventDefault();
    applyStudioSplit(nextPercent, true);
  };

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
  const selectedToolProject = useMemo(
    () => toolProjects.find((project) => project.id === selectedToolProjectId) ?? null,
    [toolProjects, selectedToolProjectId],
  );

  const updateToolProject = useCallback(async (
    projectId: string,
    changes: Record<string, unknown>,
    showSaving = true,
  ): Promise<ToolProjectRecord | null> => {
    if (showSaving) setProjectSaving(true);
    try {
      const response = await fetch(`/api/tool-projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(changes),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      if (!response.ok || record?.ok !== true || !record.project || typeof record.project !== "object") {
        throw new Error(typeof record?.error === "string" ? record.error : "项目保存失败");
      }
      const project = record.project as ToolProjectRecord;
      setToolProjects((current) => current
        .map((item) => item.id === project.id ? project : item)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
      setProjectError(null);
      return project;
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "项目保存失败");
      return null;
    } finally {
      if (showSaving) setProjectSaving(false);
    }
  }, []);
  const isTalkingVideo = selectedSku?.skuId === "BAILIAN_WAN22_S2V";
  const isAutoSubtitleTool = selectedSku?.skuId === "LOCAL_AUTO_SUBTITLES";
  const voiceAudioUrl = useMemo(() => {
    if (!isTalkingVideo) return null;
    const path = fieldPaths.voiceAudio;
    const value = path ? getAtPath(parameters, path) as ImageFieldValue | undefined : undefined;
    return value?.status === "ready" && typeof value.remoteUrl === "string" ? value.remoteUrl : null;
  }, [isTalkingVideo, fieldPaths, parameters]);
  const standaloneSourceVideoUrl = useMemo(() => {
    if (!isAutoSubtitleTool) return null;
    const path = fieldPaths.sourceVideo;
    const value = path ? getAtPath(parameters, path) as ImageFieldValue | undefined : undefined;
    return value?.status === "ready" && typeof value.remoteUrl === "string" ? value.remoteUrl : null;
  }, [isAutoSubtitleTool, fieldPaths, parameters]);
  const draftOwnerId = session?.user?.id ?? null;

  useEffect(() => {
    if (isAutoSubtitleTool && standaloneSourceVideoUrl) setSubmitError(null);
  }, [isAutoSubtitleTool, standaloneSourceVideoUrl]);

  useEffect(() => {
    if (!draftOwnerId || !selectedSkuId || !schema) return;
    const identity = `${draftOwnerId}:${selectedSkuId}`;
    if (suppressedDraftSaveRef.current === identity) {
      suppressedDraftSaveRef.current = null;
      return;
    }
    saveWorkflowDraft(
      window.localStorage,
      draftOwnerId,
      selectedSkuId,
      schema,
      parameters,
    );
  }, [draftOwnerId, selectedSkuId, schema, parameters]);

  const hasImageUploadInFlight = useMemo(() => {
    if (!schema) return false;
    for (const field of iterateLeafFields(schema.fields)) {
      if (!isWorkflowFieldVisible(field, parameters, fieldPaths)) continue;
      const p = fieldPaths[field.id];
      const raw = p ? getAtPath(parameters, p) : undefined;
      if (field.kind === "imageUpload" || field.kind === "videoUpload" || field.kind === "audioUpload") {
        if ((raw as ImageFieldValue | undefined)?.status === "uploading") return true;
      } else if (field.kind === "multiImageUpload") {
        const items = (raw as MultiImageFieldValue | undefined)?.items ?? [];
        if (items.some((it) => it.status === "uploading")) return true;
      }
    }
    return false;
  }, [schema, parameters, fieldPaths]);

  useEffect(() => {
    if (!selectedToolProjectId || !schema || hasImageUploadInFlight) return;
    if (suppressedProjectSaveRef.current === selectedToolProjectId) {
      suppressedProjectSaveRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => {
      const outputState: ToolProjectOutputState = {
        subtitleState: subtitleState === "processing" ? "idle" : subtitleState,
        ...(captionedVideoUrl ? { captionedVideoUrl } : {}),
        ...(subtitleError ? { subtitleError } : {}),
      };
      void updateToolProject(selectedToolProjectId, {
        formState: sanitizeWorkflowDraftParameters(schema, parameters),
        outputState,
        activeTaskId,
        providerCode: gatewayProviderCode ?? "",
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    selectedToolProjectId,
    schema,
    parameters,
    activeTaskId,
    gatewayProviderCode,
    subtitleState,
    captionedVideoUrl,
    subtitleError,
    hasImageUploadInFlight,
    updateToolProject,
  ]);

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

  const applyToolProject = useCallback((project: ToolProjectRecord, sku: SkuDefinition) => {
    resetPoll();
    suppressedProjectSaveRef.current = project.id;
    setSelectedToolProjectId(project.id);
    setActiveTaskId(project.activeTaskId ?? null);
    setViewingHistoryId(null);
    setGatewaySelection(sku.skuId, project.providerCode || sku.providerCode);
    hydrateSchema(sku.uiSchema, sanitizeWorkflowDraftParameters(sku.uiSchema, project.formState));

    const output = project.outputState && typeof project.outputState === "object" && !Array.isArray(project.outputState)
      ? project.outputState as ToolProjectOutputState
      : {};
    const restoredCaptionedUrl = typeof output.captionedVideoUrl === "string" ? output.captionedVideoUrl : null;
    setCaptionedVideoUrl(restoredCaptionedUrl);
    setSubtitleError(typeof output.subtitleError === "string" ? output.subtitleError : null);
    setSubtitleState(output.subtitleState === "success" && restoredCaptionedUrl
      ? "success"
      : output.subtitleState === "error" ? "error" : "idle");
    setShowErrors(false);
    setSubmitError(null);
    setProjectError(null);
    void fetchCloudHistory(project.id);
  }, [fetchCloudHistory, hydrateSchema, resetPoll, setGatewaySelection, setViewingHistoryId]);

  // ── SKU switch ───────────────────────────────────────────────────────────
  const applySku = useCallback(
    (sku: SkuDefinition) => {
      const canResumeExistingProject = selectedSkuId === sku.skuId
        && selectedToolProjectId !== null
        && toolProjects.some((project) => project.id === selectedToolProjectId);
      if (canResumeExistingProject) {
        setGatewaySelection(sku.skuId, selectedToolProject?.providerCode || sku.providerCode);
        setShowErrors(false);
        setSubmitError(null);
        setProjectError(null);
        return;
      }

      projectRequestSequenceRef.current += 1;
      setProjectLoadRevision((revision) => revision + 1);
      setProjectsLoading(true);
      resetPoll();
      setActiveTaskId(null);
      setViewingHistoryId(null);
      setSelectedToolProjectId(null);
      setToolProjects([]);
      setProjectError(null);
      setSelectedSkuId(sku.skuId);
      setGatewaySelection(sku.skuId, sku.providerCode);
      const restoredParameters = draftOwnerId
        ? loadWorkflowDraft(window.localStorage, draftOwnerId, sku.skuId, sku.uiSchema)
        : null;
      hydrateSchema(sku.uiSchema, restoredParameters ?? undefined);
      setShowErrors(false);
      setSubmitError(null);
      setSubtitleState("idle");
      setCaptionedVideoUrl(null);
      setSubtitleError(null);
    },
    [draftOwnerId, hydrateSchema, resetPoll, selectedSkuId, selectedToolProject, selectedToolProjectId, setGatewaySelection, setViewingHistoryId, toolProjects]
  );

  useEffect(() => {
    if (sessionStatus !== "authenticated" || !selectedSku || schema !== selectedSku.uiSchema) return;
    const sequence = ++projectRequestSequenceRef.current;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
    setProjectsLoading(true);
    setProjectError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/tool-projects?skuId=${encodeURIComponent(selectedSku.skuId)}`, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
        if (!response.ok || record?.ok !== true || !Array.isArray(record.projects)) {
          throw new Error(typeof record?.error === "string" ? record.error : "项目加载失败");
        }
        let projects = record.projects as ToolProjectRecord[];
        if (projects.length === 0) {
          const createResponse = await fetch("/api/tool-projects", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "same-origin",
            signal: controller.signal,
            body: JSON.stringify({
              skuId: selectedSku.skuId,
              providerCode: selectedSku.providerCode,
              name: `${selectedSku.displayName}项目 1`,
              formState: sanitizeWorkflowDraftParameters(
                selectedSku.uiSchema,
                useWorkflowStore.getState().parameters,
              ),
            }),
          });
          const createdPayload: unknown = await createResponse.json().catch(() => null);
          const createdRecord = createdPayload && typeof createdPayload === "object"
            ? createdPayload as Record<string, unknown>
            : null;
          if (!createResponse.ok || createdRecord?.ok !== true || !createdRecord.project) {
            throw new Error(typeof createdRecord?.error === "string" ? createdRecord.error : "项目创建失败");
          }
          projects = [createdRecord.project as ToolProjectRecord];
        }
        if (sequence !== projectRequestSequenceRef.current) return;
        setToolProjects(projects);
        applyToolProject(projects[0], selectedSku);
      } catch (error) {
        if (sequence === projectRequestSequenceRef.current) {
          setProjectError(controller.signal.aborted
            ? (locale === "en" ? "Project loading timed out. Please retry." : "项目加载超时，请重试。")
            : error instanceof Error ? error.message : "项目加载失败");
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (sequence === projectRequestSequenceRef.current) setProjectsLoading(false);
      }
    })();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [applyToolProject, locale, projectLoadRevision, schema, selectedSku, sessionStatus]);

  const handleRetryToolProjects = useCallback(() => {
    projectRequestSequenceRef.current += 1;
    setProjectLoadRevision((revision) => revision + 1);
  }, []);

  const persistCurrentProject = useCallback(async () => {
    if (!selectedToolProjectId || !schema || hasImageUploadInFlight) return;
    await updateToolProject(selectedToolProjectId, {
      formState: sanitizeWorkflowDraftParameters(schema, useWorkflowStore.getState().parameters),
      outputState: {
        subtitleState: subtitleState === "processing" ? "idle" : subtitleState,
        ...(captionedVideoUrl ? { captionedVideoUrl } : {}),
        ...(subtitleError ? { subtitleError } : {}),
      },
      activeTaskId,
      providerCode: gatewayProviderCode ?? "",
    });
  }, [activeTaskId, captionedVideoUrl, gatewayProviderCode, hasImageUploadInFlight, schema, selectedToolProjectId, subtitleError, subtitleState, updateToolProject]);

  useEffect(() => {
    setActiveToolGroup(routeToolGroup);
  }, [routeToolGroup]);

  useEffect(() => {
    const handleToolSectionChange = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchToolSectionEventDetail>).detail;
      void persistCurrentProject();
      setActiveToolGroup(detail.group);
      setView("gallery");
    };

    window.addEventListener(WORKBENCH_TOOL_SECTION_EVENT, handleToolSectionChange);
    return () => window.removeEventListener(WORKBENCH_TOOL_SECTION_EVENT, handleToolSectionChange);
  }, [persistCurrentProject]);

  const handleSelectToolProject = useCallback(async (projectId: string) => {
    if (!selectedSku || projectId === selectedToolProjectId) return;
    await persistCurrentProject();
    const project = toolProjects.find((item) => item.id === projectId);
    if (project) applyToolProject(project, selectedSku);
  }, [applyToolProject, persistCurrentProject, selectedSku, selectedToolProjectId, toolProjects]);

  const handleCreateToolProject = useCallback(async () => {
    if (!selectedSku || !schema) return;
    await persistCurrentProject();
    setProjectsLoading(true);
    try {
      const response = await fetch("/api/tool-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          skuId: selectedSku.skuId,
          providerCode: selectedSku.providerCode,
          name: `${selectedSku.displayName}项目 ${toolProjects.length + 1}`,
          formState: sanitizeWorkflowDraftParameters(schema, {}),
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
      if (!response.ok || record?.ok !== true || !record.project) {
        throw new Error(typeof record?.error === "string" ? record.error : "项目创建失败");
      }
      const project = record.project as ToolProjectRecord;
      setToolProjects((current) => [project, ...current]);
      applyToolProject(project, selectedSku);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "项目创建失败");
    } finally {
      setProjectsLoading(false);
    }
  }, [applyToolProject, persistCurrentProject, schema, selectedSku, toolProjects.length]);

  const handleRenameToolProject = useCallback(async () => {
    if (!selectedToolProject) return;
    const name = window.prompt(locale === "en" ? "Project name" : "请输入项目名称", selectedToolProject.name)?.trim();
    if (!name || name === selectedToolProject.name) return;
    await updateToolProject(selectedToolProject.id, { name });
  }, [locale, selectedToolProject, updateToolProject]);

  const handleDeleteToolProject = useCallback(async () => {
    if (!selectedToolProject || !selectedSku) return;
    if (toolProjects.length <= 1) {
      window.alert(locale === "en" ? "Keep at least one project for this tool." : "每个工具至少需要保留一个项目。你可以重命名或清空当前项目。");
      return;
    }
    if (!window.confirm(locale === "en" ? `Delete “${selectedToolProject.name}”?` : `确定删除“${selectedToolProject.name}”吗？`)) return;
    const response = await fetch(`/api/tool-projects/${encodeURIComponent(selectedToolProject.id)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      setProjectError(locale === "en" ? "Failed to delete project" : "项目删除失败");
      return;
    }
    const remaining = toolProjects.filter((item) => item.id !== selectedToolProject.id);
    setToolProjects(remaining);
    applyToolProject(remaining[0], selectedSku);
  }, [applyToolProject, locale, selectedSku, selectedToolProject, toolProjects]);

  const handleResetForm = useCallback(() => {
    setShowErrors(false);
    setSubmitError(null);
    setSubtitleState("idle");
    setCaptionedVideoUrl(null);
    setSubtitleError(null);
    if (draftOwnerId && selectedSkuId) {
      suppressedDraftSaveRef.current = `${draftOwnerId}:${selectedSkuId}`;
      clearWorkflowDraft(window.localStorage, draftOwnerId, selectedSkuId);
    }
    reset();
  }, [draftOwnerId, reset, selectedSkuId]);

  const enterStudio = useCallback(
    (sku: SkuDefinition) => {
      if (sku.href) {
        window.location.assign(sku.href);
        return;
      }
      const currentState = window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
      window.history.pushState(
        { ...currentState, [WORKFLOW_STUDIO_HISTORY_KEY]: sku.skuId },
        "",
        window.location.href,
      );
      applySku(sku);
      setActiveCategory(sku.category);
      setView("studio");
    },
    [applySku]
  );

  const backToGallery = useCallback(() => {
    void persistCurrentProject();
    const currentState = window.history.state;
    if (currentState?.[WORKFLOW_STUDIO_HISTORY_KEY]) {
      window.history.back();
      return;
    }
    setView("gallery");
  }, [persistCurrentProject]);

  const handleSignOut = useCallback(async () => {
    await persistCurrentProject();
    await signOut({ callbackUrl: "/" });
  }, [persistCurrentProject]);

  useEffect(() => {
    const syncViewFromHistory = (state: unknown) => {
      const skuId = state && typeof state === "object"
        ? (state as Record<string, unknown>)[WORKFLOW_STUDIO_HISTORY_KEY]
        : undefined;
      if (typeof skuId !== "string") {
        setView("gallery");
        return;
      }
      const sku = skus.find((item) => item.skuId === skuId && !item.href);
      if (!sku) {
        setView("gallery");
        return;
      }
      applySku(sku);
      setActiveCategory(sku.category);
      setView("studio");
    };

    const onPopState = (event: PopStateEvent) => syncViewFromHistory(event.state);
    window.addEventListener("popstate", onPopState);
    if (!historyViewRestoredRef.current && skus.length > 0) {
      historyViewRestoredRef.current = true;
      syncViewFromHistory(window.history.state);
    }
    return () => window.removeEventListener("popstate", onPopState);
  }, [applySku, skus]);

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
      skuId: selectedSku?.skuId,
    });
  }, [activeTaskId, pollData, isPolling, transportError, consecutiveErrors, elapsedMs, expectedDurationMs, selectedSku?.skuId]);

  const displayViewerModel = useMemo((): TaskStatusViewModel | null => {
    if (viewingHistoryId) {
      const item = cloudHistory.find((h) => h.taskId === viewingHistoryId);
      if (!item) return viewerModel;
      const url = item.resultUrl?.trim();
      if (url) {
        const mediaType =
          item.mediaType === "image" || item.mediaType === "video" || item.mediaType === "audio" || item.mediaType === "model"
            ? item.mediaType
            : inferMediaTypeFromResultUrl(url);
        return { phase: "success", videoUrl: url, mediaType, hints: [] };
      }
    }
    return viewerModel;
  }, [viewingHistoryId, cloudHistory, viewerModel]);

  const effectiveViewerModel = useMemo((): TaskStatusViewModel | null => {
    if (!isAutoSubtitleTool) return displayViewerModel;
    if (subtitleState === "processing") {
      return {
        phase: "loading",
        subPhase: "running",
        elapsedMs: 0,
        expectedDurationMs: 60_000,
        hints: [locale === "en" ? "Transcribing speech and rendering subtitles…" : "正在识别人声、匹配时间轴并合成字幕…"],
      };
    }
    if (subtitleState === "success" && captionedVideoUrl) {
      return { phase: "success", videoUrl: captionedVideoUrl, mediaType: "video", hints: [] };
    }
    if (subtitleState === "error") {
      return { phase: "failure", errorMessage: subtitleError ?? "字幕处理失败，请重试", hints: [] };
    }
    return null;
  }, [isAutoSubtitleTool, displayViewerModel, subtitleState, captionedVideoUrl, subtitleError, locale]);

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
    void fetchCloudHistory(selectedToolProjectId);
  }, [viewingHistoryId, pollData?.status, activeTaskId, fetchCloudHistory, selectedToolProjectId]);

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
    if (!selectedToolProjectId) {
      setSubmitError(locale === "en" ? "Please wait for a project to load." : "请等待项目加载完成后再提交。");
      return;
    }
    // 轮询进行中或已有提交在途，禁止重复提交
    if (isSubmitting || isPolling) return;

    setShowErrors(true);
    const errs = validate();
    if (Object.keys(errs).length > 0) { setSubmitError(null); return; }

    if (isAutoSubtitleTool) {
      if (!standaloneSourceVideoUrl) {
        setSubmitError(locale === "en" ? "Please upload a source video first." : "请先上传原视频");
        return;
      }
      setSubmitError(null);
      setAutoSaveNotice(null);
      setSubtitleError(null);
      setCaptionedVideoUrl(null);
      setSubtitleState("processing");
      setIsSubmitting(true);
      try {
        const response = await fetch("/api/gateway/subtitles", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ sourceVideoUrl: standaloneSourceVideoUrl }),
        });
        const raw: unknown = await response.json().catch(() => null);
        const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
        if (!response.ok || result?.ok !== true || typeof result.captionedVideoUrl !== "string") {
          throw new Error(typeof result?.error === "string" ? result.error : "字幕处理失败，请稍后重试");
        }
        setCaptionedVideoUrl(result.captionedVideoUrl);
        setSubtitleState("success");
        bumpProfileBalance();
      } catch (error) {
        setSubtitleError(error instanceof Error ? error.message : "字幕处理失败，请稍后重试");
        setSubtitleState("error");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const built = buildPayload();
    if (!built) { setSubmitError(t.errIncomplete); return; }
    if (!built.skuId || !built.providerCode) { setSubmitError(t.errMissingSku); return; }

    setSubmitError(null);
    setAutoSaveNotice(null);
    setSubtitleState("idle");
    setCaptionedVideoUrl(null);
    setSubtitleError(null);
    setIsSubmitting(true);
    resetPoll();
    setActiveTaskId(null);
    try {
      const res = await fetch("/api/gateway/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...built, toolProjectId: selectedToolProjectId }),
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
      const nextTaskId = tid.trim();
      setActiveTaskId(nextTaskId);
      if (selectedToolProjectId) {
        void updateToolProject(selectedToolProjectId, {
          activeTaskId: nextTaskId,
          providerCode: built.providerCode,
        }, false);
      }
    } catch (e) {
      console.error("[WorkflowStudio] 提单网络异常", e);
      setSubmitError(e instanceof Error ? e.message : t.errNetwork);
    } finally {
      setIsSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSku, validate, buildPayload, resetPoll, setViewingHistoryId, isAutoSubtitleTool, standaloneSourceVideoUrl, locale, bumpProfileBalance, selectedToolProjectId, updateToolProject]);

  const onStudioFormSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
    (e) => { e.preventDefault(); void handleSubmitToGateway(); },
    [handleSubmitToGateway]
  );

  const handleRegenerate = useCallback(() => {
    resetPoll();
    setActiveTaskId(null);
    setSubmitError(null);
    setAutoSaveNotice(null);
    setSubtitleState("idle");
    setCaptionedVideoUrl(null);
    setSubtitleError(null);
    if (selectedToolProjectId) {
      void updateToolProject(selectedToolProjectId, { activeTaskId: null }, false);
    }
  }, [resetPoll, selectedToolProjectId, updateToolProject]);

  const talkingVideoReady = Boolean(
    isTalkingVideo
    && !viewingHistoryId
    && activeTaskId
    && pollData?.status === "succeeded"
    && typeof pollData.resultUrl === "string"
    && pollData.resultUrl.trim(),
  );

  const handleAutoSubtitle = useCallback(async () => {
    if (!talkingVideoReady || !activeTaskId || !voiceAudioUrl || subtitleState === "processing") return;
    setSubtitleState("processing");
    setSubtitleError(null);
    try {
      const response = await fetch("/api/gateway/subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ taskId: activeTaskId, audioUrl: voiceAudioUrl }),
      });
      const raw: unknown = await response.json().catch(() => null);
      const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
      if (!response.ok || result?.ok !== true || typeof result.captionedVideoUrl !== "string") {
        throw new Error(typeof result?.error === "string" ? result.error : "字幕处理失败，请稍后重试");
      }
      setCaptionedVideoUrl(result.captionedVideoUrl);
      setSubtitleState("success");
      bumpProfileBalance();
    } catch (error) {
      setSubtitleError(error instanceof Error ? error.message : "字幕处理失败，请稍后重试");
      setSubtitleState("error");
    }
  }, [talkingVideoReady, activeTaskId, voiceAudioUrl, subtitleState, bumpProfileBalance]);

  const supplementaryVideo = isTalkingVideo && !viewingHistoryId && subtitleState !== "idle"
    ? {
        status: subtitleState === "success" ? "success" as const : subtitleState === "error" ? "error" as const : "processing" as const,
        url: captionedVideoUrl ?? undefined,
        title: locale === "en" ? "Captioned video" : "字幕版视频",
        message: subtitleState === "error"
          ? subtitleError ?? undefined
          : locale === "en"
            ? "Transcribing speech and rendering subtitles…"
            : "正在识别人声并合成字幕…",
      }
    : null;

  const bailianEstimate = useMemo(() => {
    if (
      !selectedSku
      || !["BAILIAN_WANX_I2V", "BAILIAN_WAN27_VIDEO_CONTINUATION"].includes(selectedSku.skuId)
      || !schema
    ) return null;
    const p = fieldPaths.duration;
    const raw = p ? getAtPath(parameters, p) : undefined;
    let sec = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 5;
    const minDuration = selectedSku.skuId === "BAILIAN_WAN27_VIDEO_CONTINUATION" ? 2 : 3;
    sec = Math.min(15, Math.max(minDuration, sec));
    const credits = sec * BAILIAN_VIDEO_CREDITS_PER_SECOND;
    return { sec, credits };
  }, [selectedSku, schema, fieldPaths, parameters]);

  const tripoEstimate = useMemo(() => {
    if (!selectedSku || selectedSku.skuId !== "BAILIAN_TRIPO_3D" || !schema) return null;
    const readValue = (fieldId: string) => {
      const valuePath = fieldPaths[fieldId];
      return valuePath ? getAtPath(parameters, valuePath) : undefined;
    };
    const model = String(readValue("modelName") ?? "Tripo/Tripo-P1.0");
    const generationMode = String(readValue("generationMode") ?? "text");
    const textureOutput = String(readValue("textureOutput") ?? "pbr");
    const textureQuality = String(readValue("textureQuality") ?? "standard");
    const rawFaceLimit = readValue("faceLimit");
    const faceLimit = typeof rawFaceLimit === "number" && Number.isFinite(rawFaceLimit) ? rawFaceLimit : 20_000;
    const geometryQuality = faceLimit > 1_500_000 ? "ultra" : "standard";
    return {
      credits: estimateBailianTripoCredits({ model, generationMode, textureOutput, textureQuality, faceLimit }),
      detail: `${model.replace("Tripo/Tripo-", "Tripo ")} · ${generationMode} · ${faceLimit.toLocaleString()} faces · ${textureOutput === "base" ? "base mesh" : textureQuality}${model.endsWith("H3.1") ? ` · ${geometryQuality}` : ""}`,
    };
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
    { key: "model", label: t.categoryModel },
  ];
  const visibleCategoryTabs = activeToolGroup === "favorites"
    ? []
    : activeToolGroup
      ? CATEGORY_TABS.filter((tab) => tab.key === "video")
      : CATEGORY_TABS;

  useEffect(() => {
    if (activeToolGroup && activeToolGroup !== "favorites") setActiveCategory("video");
  }, [activeToolGroup]);

  const visibleSkus = activeToolGroup === "favorites"
    ? skus.filter((s) => favoriteSkuIds.has(s.skuId))
    : activeToolGroup === "video-generation"
    ? skus.filter((s) => isSkuInVideoGenerationTab(s, activeVideoGenerationTab))
    : activeToolGroup === "video-editing"
      ? skus.filter((s) => isSkuInVideoEditingTab(s, activeVideoEditingTab))
    : activeToolGroup
      ? skus.filter((s) => isSkuInToolGroup(s, activeToolGroup))
      : skus.filter((s) => s.category === activeCategory);
  const activeToolGroupLabel = activeToolGroup
    ? TOOL_GROUP_LABELS[activeToolGroup][locale]
    : "";
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
            onSignOut={() => void handleSignOut()}
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
              {activeToolGroup === "video-generation" ? VIDEO_GENERATION_TABS.map((tab) => {
                const count = skus.filter((s) => isSkuInVideoGenerationTab(s, tab.key)).length;
                const isActive = activeVideoGenerationTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveVideoGenerationTab(tab.key)}
                    className={[
                      "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                        : "bg-[#1a2844] text-slate-400 hover:bg-[#243560] hover:text-slate-200",
                    ].join(" ")}
                  >
                    <span>{locale === "en" ? tab.labelEn : tab.label}</span>
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
              }) : activeToolGroup === "video-editing" ? VIDEO_EDITING_TABS.map((tab) => {
                const count = skus.filter((s) => isSkuInVideoEditingTab(s, tab.key)).length;
                const isActive = activeVideoEditingTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveVideoEditingTab(tab.key)}
                    className={[
                      "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                        : "bg-[#1a2844] text-slate-400 hover:bg-[#243560] hover:text-slate-200",
                    ].join(" ")}
                  >
                    <span>{locale === "en" ? tab.labelEn : tab.label}</span>
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
              }) : visibleCategoryTabs.map((tab) => {
                const count = activeToolGroup
                  ? visibleSkus.length
                  : skus.filter((s) => s.category === tab.key).length;
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
            {activeToolGroupLabel && (
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight text-white">
                  {activeToolGroupLabel}
                </h2>
              </div>
            )}

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
                <p className="text-sm text-slate-500">
                  {activeToolGroup === "favorites" ? t.favoritesEmpty : t.categoryEmpty}
                </p>
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
                    favoriteAddLabel={t.favoriteAdd}
                    favoriteRemoveLabel={t.favoriteRemove}
                    isFavorite={favoriteSkuIds.has(sku.skuId)}
                    onToggleFavorite={() => toggleFavoriteSku(sku.skuId)}
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
    <div className={embedded ? "relative flex h-full min-h-0 flex-col overflow-y-auto bg-[#08111f]" : "relative flex min-h-screen flex-col bg-[#08111f]"}>
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="wf-ambient-orb absolute -left-40 top-10 h-[34rem] w-[34rem] rounded-full bg-cyan-500/[0.055] blur-[110px]" />
        <div className="wf-ambient-orb absolute right-0 top-1/3 h-[30rem] w-[30rem] rounded-full bg-emerald-500/[0.045] blur-[120px] [animation-delay:-5s]" />
      </div>
      {renderNav}

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-4 py-5 lg:px-6 lg:py-7">
        {/* Two-column layout */}
        <div
          ref={studioColumnsRef}
          className="flex min-h-0 flex-1 flex-col items-start gap-5 lg:flex-row lg:gap-0"
          style={{ "--studio-left-width": `${studioSplitPercent}%` } as CSSProperties}
        >

          {/* ── Left: form only ── */}
          <aside className="w-full min-w-0 max-w-full overflow-x-hidden lg:w-[var(--studio-left-width)] lg:flex-none">

            {/* Parameter form */}
            <div className="wf-panel-enter min-w-0 max-w-full overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#111d31]/90 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
              {schema ? (
                <DynamicForm
                  schema={schema}
                  errors={errors}
                  locale={locale}
                  onSubmit={onStudioFormSubmit}
                  headerAction={selectedSku ? (
                    <WorkflowPricing
                      sku={selectedSku}
                      locale={locale}
                      bailianEstimate={bailianEstimate}
                      tripoEstimate={tripoEstimate}
                    />
                  ) : null}
                  beforeFields={
                    <div className="space-y-2">
                      <ToolProjectSelector
                        projects={toolProjects}
                        selectedProjectId={selectedToolProjectId}
                        loading={projectsLoading}
                        saving={projectSaving}
                        locale={locale}
                        onSelect={(projectId) => void handleSelectToolProject(projectId)}
                        onCreate={() => void handleCreateToolProject()}
                        onRename={() => void handleRenameToolProject()}
                        onDelete={() => void handleDeleteToolProject()}
                      />
                      {projectError && (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                          <span>{projectError}</span>
                          <button
                            type="button"
                            onClick={handleRetryToolProjects}
                            disabled={projectsLoading}
                            className="shrink-0 rounded-lg border border-amber-300/25 bg-amber-300/10 px-2.5 py-1.5 font-medium text-amber-100 transition hover:bg-amber-300/20 disabled:opacity-50"
                          >
                            {locale === "en" ? "Retry" : "重新加载"}
                          </button>
                        </div>
                      )}
                    </div>
                  }
                  formFooter={
                    <div className="-mx-5 -mb-5 space-y-3 border-t border-white/[0.07] bg-[#0b1628]/75 px-5 pb-5 pt-4 lg:-mx-6 lg:-mb-6 lg:px-6 lg:pb-6">
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

                      {selectedSku?.category !== "model" && (
                        <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3 transition-colors hover:bg-white/[0.04]">
                          <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-300">
                            <input
                              type="checkbox"
                              checked={autoSaveToAssetLibrary}
                              onChange={(e) => setAutoSaveToAssetLibrary(e.target.checked)}
                              className="h-4 w-4 rounded border-[#3a5070] bg-[#0f1728] text-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:ring-offset-0"
                            />
                            {t.autoSaveToAssetToggle}
                          </label>
                        </div>
                      )}

                      {(isAutoSaving || autoSaveNotice) && (
                        <div className="rounded-xl border border-[#2a3d5e] bg-[#13253f] px-3.5 py-2.5 text-xs text-slate-300">
                          {isAutoSaving ? t.autoSaveSaving : autoSaveNotice}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <button
                          type="submit"
                          disabled={isSubmitting || isPolling || hasImageUploadInFlight || !selectedSku || !selectedToolProjectId || sessionStatus !== "authenticated"}
                          className="group relative inline-flex min-h-11 items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_-12px_rgba(16,185,129,0.7)] transition-all duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_16px_36px_-12px_rgba(16,185,129,0.8)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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
                          onClick={handleResetForm}
                          className="min-h-11 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white active:scale-[0.98]"
                        >
                          {t.resetBtn}
                        </button>
                        {isTalkingVideo && (
                          <button
                            type="button"
                            onClick={() => void handleAutoSubtitle()}
                            disabled={!talkingVideoReady || !voiceAudioUrl || subtitleState === "processing"}
                            title={!talkingVideoReady
                              ? (locale === "en" ? "Available after the talking video is generated" : "有声视频生成完成后即可使用")
                              : undefined}
                            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-300/30 bg-gradient-to-r from-cyan-500/20 to-emerald-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:border-cyan-200/50 hover:from-cyan-500/30 hover:to-emerald-500/30 disabled:cursor-not-allowed disabled:border-white/[0.07] disabled:bg-none disabled:bg-white/[0.035] disabled:text-slate-600"
                          >
                            {subtitleState === "processing" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current" />}
                            {subtitleState === "processing"
                              ? (locale === "en" ? "Adding subtitles…" : "正在添加字幕…")
                              : subtitleState === "success"
                                ? (locale === "en" ? "Regenerate subtitles" : "重新生成字幕")
                                : (locale === "en" ? "Auto subtitles" : "自动添加字幕")}
                          </button>
                        )}
                        {activeTaskId && (
                          <button
                            type="button"
                            onClick={handleRegenerate}
                            className="min-h-11 rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-300 transition-all duration-200 hover:border-white/[0.18] hover:bg-white/[0.075] hover:text-white active:scale-[0.98]"
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

          <div
            role="separator"
            aria-label={locale === "en" ? "Resize parameter and result panels" : "调整参数面板与结果面板宽度"}
            aria-orientation="vertical"
            aria-valuemin={MIN_STUDIO_SPLIT_PERCENT}
            aria-valuemax={MAX_STUDIO_SPLIT_PERCENT}
            aria-valuenow={studioSplitPercent}
            aria-valuetext={`${studioSplitPercent}%`}
            tabIndex={0}
            title={locale === "en" ? "Drag to resize; double-click to reset" : "拖动调整宽度，双击恢复默认"}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={handleSplitPointerMove}
            onPointerUp={handleSplitPointerEnd}
            onPointerCancel={handleSplitPointerEnd}
            onLostPointerCapture={finishStudioSplitResize}
            onKeyDown={handleSplitKeyDown}
            onDoubleClick={() => applyStudioSplit(DEFAULT_STUDIO_SPLIT_PERCENT, true)}
            className="group relative hidden min-h-[560px] w-6 shrink-0 cursor-col-resize touch-none self-stretch outline-none lg:block"
          >
            <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 rounded-full bg-white/[0.06] transition-all duration-200 group-hover:w-0.5 group-hover:bg-emerald-400/55 group-focus-visible:w-0.5 group-focus-visible:bg-emerald-400/80 group-active:w-0.5 group-active:bg-emerald-300" />
          </div>

          {/* ── Right: viewer + history ── */}
          <div
            className={cn(
              "wf-panel-enter flex w-full min-w-0 flex-col overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#091422]/90 shadow-[0_28px_80px_-36px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-xl [animation-delay:80ms] lg:sticky lg:top-5 lg:flex-1",
              embedded
                ? "min-h-[480px] lg:h-[calc(100dvh-7rem)] lg:min-h-[360px] lg:max-h-[calc(100dvh-7rem)]"
                : "min-h-[560px] lg:max-h-[calc(100vh-2.5rem)]"
            )}
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
              <div className="flex items-center gap-2.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {locale === "en" ? "Output stage" : "结果舞台"}
                </span>
              </div>
              <span className="rounded-full border border-white/[0.07] bg-white/[0.035] px-2.5 py-1 text-[10px] font-medium text-slate-500">
                {activeTaskId || isSubmitting ? (locale === "en" ? "LIVE" : "任务中") : (locale === "en" ? "READY" : "待命")}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <TaskStatusViewer
                model={effectiveViewerModel}
                onRegenerate={handleRegenerate}
                downloadFileName="workflow-studio.mp4"
                className="h-full w-full"
                compact={embedded}
                supplementaryVideo={supplementaryVideo}
              />
            </div>
            {cloudHistory.length > 0 && (
              <div className="shrink-0 border-t border-white/[0.07] bg-[#08111f]/80 px-3">
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

const DANCE_MOVE_DURATION_OPTIONS = Array.from({ length: 29 }, (_, index) => index + 2);

function PriceTrigger({ locale, onClick }: { locale: "zh" | "en"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 inline-flex h-7 items-center gap-1 rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 text-xs font-medium text-amber-300 transition-colors hover:border-amber-300/70 hover:bg-amber-400/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/35"
    >
      <span aria-hidden>¥</span>
      {locale === "en" ? "Pricing" : "价格"}
    </button>
  );
}

function WorkflowPricing({
  sku,
  locale,
  bailianEstimate,
  tripoEstimate,
}: {
  sku: SkuDefinition;
  locale: "zh" | "en";
  bailianEstimate: { sec: number; credits: number } | null;
  tripoEstimate: { credits: number; detail: string } | null;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (sku.skuId === "BAILIAN_WAN22_ANIMATE_MOVE") {
    return <DanceMovePricing locale={locale} />;
  }

  const name = locale === "en" && sku.displayNameEn ? sku.displayNameEn : sku.displayName;
  const isS2v = sku.skuId === "BAILIAN_WAN22_S2V";
  const isVideoEdit = WAN27_VIDEO_EDIT_SKU_IDS.has(sku.skuId);
  if (!isS2v && !isVideoEdit && !bailianEstimate && !tripoEstimate) {
    return <FixedWorkflowPricing name={name} credits={sku.sellCredits} locale={locale} />;
  }
  const dialogTitle = locale === "en" ? `${name} pricing` : `${name}价格明细`;
  const creditsUnit = locale === "en" ? "credits" : "积分";
  const perSecondUnit = locale === "en" ? "credits/sec" : "积分/秒";

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-pricing-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#345071] bg-[#101c30] shadow-2xl shadow-black/60"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#263b59] px-5 py-4">
          <h3 id="workflow-pricing-title" className="text-base font-semibold text-slate-100">
            {dialogTitle}
          </h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={locale === "en" ? "Close pricing" : "关闭价格明细"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 text-lg text-slate-400 transition-colors hover:border-slate-400 hover:text-white"
          >
            ×
          </button>
        </header>

        <div className="space-y-3 bg-[#0c1729] p-5 text-sm">
          {isS2v || isVideoEdit ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-3 text-emerald-300">
                <span className="block text-xs text-slate-400">{isVideoEdit ? "720P" : "480P"}</span>
                <strong className="mt-1 block text-base">
                  {isVideoEdit ? BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND : BAILIAN_S2V_480P_CREDITS_PER_SECOND} {perSecondUnit}
                </strong>
              </div>
              <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-3 text-sky-300">
                <span className="block text-xs text-slate-400">{isVideoEdit ? "1080P" : "720P"}</span>
                <strong className="mt-1 block text-base">
                  {isVideoEdit ? BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND : BAILIAN_S2V_720P_CREDITS_PER_SECOND} {perSecondUnit}
                </strong>
              </div>
            </div>
          ) : tripoEstimate ? (
            <div className="rounded-lg border border-violet-500/20 bg-violet-950/20 px-4 py-4 text-violet-200">
              <span className="block text-xs text-slate-400">{locale === "en" ? "Current estimate" : "当前预计价格"}</span>
              <strong className="mt-1 block text-lg">
                {tripoEstimate.credits.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {creditsUnit}
              </strong>
              <span className="mt-1 block text-xs text-slate-500">{tripoEstimate.detail}</span>
            </div>
          ) : bailianEstimate ? (
            <>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-4 py-3 text-emerald-300">
                <span className="block text-xs text-slate-400">{locale === "en" ? "Rate" : "计费单价"}</span>
                <strong className="mt-1 block text-base">{BAILIAN_VIDEO_CREDITS_PER_SECOND} {perSecondUnit}</strong>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-4 py-3 text-amber-300">
                <span className="block text-xs text-slate-400">{locale === "en" ? "Current estimate" : "当前预计价格"}</span>
                <strong className="mt-1 block text-base">
                  {bailianEstimate.credits.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {creditsUnit}
                </strong>
                <span className="mt-1 block text-xs text-slate-500">
                  {bailianEstimate.sec}s × {BAILIAN_VIDEO_CREDITS_PER_SECOND} {perSecondUnit}
                </span>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-950/20 px-4 py-4 text-amber-300">
              <span className="block text-xs text-slate-400">{locale === "en" ? "Price per generation" : "每次生成价格"}</span>
              <strong className="mt-1 block text-lg">
                {sku.sellCredits.toLocaleString(locale === "en" ? "en-US" : "zh-CN")} {creditsUnit}
              </strong>
            </div>
          )}
          <p className="text-xs leading-relaxed text-slate-500">
            {locale === "en" ? "The final charge is based on the actual completed task." : "最终扣费以任务实际完成后的结算结果为准。"}
          </p>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <PriceTrigger locale={locale} onClick={() => setOpen(true)} />
      {dialog}
    </>
  );
}

function DanceMovePricing({ locale }: { locale: "zh" | "en" }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setOpen(false);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dance-move-pricing-title"
        className="flex max-h-[min(82vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#345071] bg-[#101c30] shadow-2xl shadow-black/60"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#263b59] px-5 py-4">
          <div>
            <h3 id="dance-move-pricing-title" className="text-base font-semibold text-slate-100">
              {locale === "en" ? "Dance generation pricing" : "舞蹈视频价格明细"}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={locale === "en" ? "Close pricing" : "关闭价格明细"}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-600 text-lg text-slate-400 transition-colors hover:border-slate-400 hover:text-white"
          >
            ×
          </button>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-[#263b59] bg-[#0c1729] px-5 py-3 text-xs">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-emerald-300">
            <span className="block text-slate-400">{locale === "en" ? "Standard" : "标准模式"}</span>
            <strong className="mt-0.5 block text-sm">{BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND} {locale === "en" ? "credits/sec" : "积分/秒"}</strong>
          </div>
          <div className="rounded-lg border border-sky-500/20 bg-sky-950/20 px-3 py-2 text-sky-300">
            <span className="block text-slate-400">{locale === "en" ? "Professional" : "专业模式"}</span>
            <strong className="mt-0.5 block text-sm">{BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND} {locale === "en" ? "credits/sec" : "积分/秒"}</strong>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 pb-5">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-[#101c30] text-xs text-slate-400">
              <tr>
                <th className="border-b border-[#263b59] py-3 text-left font-medium">{locale === "en" ? "Duration" : "时长"}</th>
                <th className="border-b border-[#263b59] py-3 text-right font-medium">{locale === "en" ? "Standard" : "标准"}</th>
                <th className="border-b border-[#263b59] py-3 text-right font-medium">{locale === "en" ? "Professional" : "专业"}</th>
              </tr>
            </thead>
            <tbody>
              {DANCE_MOVE_DURATION_OPTIONS.map((seconds) => (
                <tr key={seconds} className="text-slate-300 odd:bg-white/[0.015]">
                  <td className="border-b border-white/[0.05] py-2">{seconds} {locale === "en" ? "sec" : "秒"}</td>
                  <td className="border-b border-white/[0.05] py-2 text-right tabular-nums">
                    {(seconds * BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}
                  </td>
                  <td className="border-b border-white/[0.05] py-2 text-right tabular-nums">
                    {(seconds * BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND).toLocaleString(locale === "en" ? "en-US" : "zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <PriceTrigger locale={locale} onClick={() => setOpen(true)} />
      {dialog}
    </>
  );
}

interface WorkflowCardProps {
  sku: SkuDefinition;
  locale: string;
  categoryLabel: string;
  creditsLabel: string;
  startLabel: string;
  favoriteAddLabel: string;
  favoriteRemoveLabel: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClick: () => void;
}

function WorkflowCard({
  sku,
  locale,
  categoryLabel,
  creditsLabel,
  startLabel,
  favoriteAddLabel,
  favoriteRemoveLabel,
  isFavorite,
  onToggleFavorite,
  onClick,
}: WorkflowCardProps) {
  const name = locale === "en" && sku.displayNameEn ? sku.displayNameEn : sku.displayName;
  const desc = locale === "en" && sku.descriptionEn ? sku.descriptionEn : sku.description;
  const isDanceMove = sku.skuId === "BAILIAN_WAN22_ANIMATE_MOVE";
  const isS2v = sku.skuId === "BAILIAN_WAN22_S2V";
  const isVideoEdit = WAN27_VIDEO_EDIT_SKU_IDS.has(sku.skuId);
  const isCoverReserved = sku.skuId === "BAILIAN_VOICE_CLONE"
    || sku.skuId === "BAILIAN_COSYVOICE_VOICE_DESIGN"
    || sku.skuId === "BAILIAN_EMOTIONAL_TTS";
  const favoriteActionLabel = isFavorite ? favoriteRemoveLabel : favoriteAddLabel;
  const priceLabel = isDanceMove
    ? `${BAILIAN_ANIMATE_MOVE_STD_CREDITS_PER_SECOND}–${BAILIAN_ANIMATE_MOVE_PRO_CREDITS_PER_SECOND} ${creditsLabel}/${locale === "en" ? "sec" : "秒"}`
    : isS2v
      ? `${BAILIAN_S2V_480P_CREDITS_PER_SECOND}–${BAILIAN_S2V_720P_CREDITS_PER_SECOND} ${creditsLabel}/${locale === "en" ? "sec" : "秒"}`
      : isVideoEdit
        ? `${BAILIAN_WAN27_VIDEO_EDIT_720P_CREDITS_PER_SECOND}–${BAILIAN_WAN27_VIDEO_EDIT_1080P_CREDITS_PER_SECOND} ${creditsLabel}/${locale === "en" ? "sec" : "秒"}`
        : `${sku.sellCredits} ${creditsLabel}`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl bg-[#111e34] shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl hover:shadow-black/50">
      <button
        type="button"
        onClick={onClick}
        aria-label={`${startLabel}: ${name}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-inset"
      />
      {/* Cover media */}
      <div className="relative aspect-video w-full overflow-hidden">
        {sku.cover ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sku.cover}
              alt={name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.06]"
            />
            {sku.coverVideo && (
              <video
                src={sku.coverVideo}
                poster={sku.cover}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-hidden="true"
                onCanPlay={(event) => {
                  if (event.currentTarget.paused) void event.currentTarget.play().catch(() => undefined);
                }}
                onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
              />
            )}
          </>
        ) : isCoverReserved ? (
          <div className="h-full w-full bg-[#07101f]" aria-label={locale === "en" ? "Cover image reserved" : "封面图片预留"} />
        ) : (
          <div className={`h-full w-full bg-gradient-to-br ${CATEGORY_BG[sku.category]}`}>
            <div className="flex h-full items-center justify-center">
              <span className="text-5xl opacity-20 select-none">{CATEGORY_ICON[sku.category]}</span>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0 z-[11] flex translate-y-2 flex-col justify-end bg-gradient-to-t from-[#050a13]/95 via-[#07101f]/80 to-[#07101f]/15 p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
          <span className="mb-1 text-[10px] font-medium text-cyan-200/80">{categoryLabel}</span>
          <div className="flex min-w-0 items-start justify-between gap-3">
            <h3 className="line-clamp-2 min-w-0 text-sm font-semibold leading-snug text-white">{name}</h3>
            <span className="max-w-[48%] shrink-0 text-right text-[11px] font-semibold leading-snug text-emerald-300">
              {priceLabel}
            </span>
          </div>
          {desc && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-slate-200/90">{desc}</p>}
        </div>

        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={isFavorite}
          aria-label={favoriteActionLabel}
          title={favoriteActionLabel}
          className={`absolute right-3 top-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-lg border opacity-0 shadow-lg backdrop-blur-md transition-all focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-amber-300/70 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 ${
            isFavorite
              ? "border-amber-300/45 bg-amber-400/20 text-amber-300"
              : "border-white/20 bg-black/45 text-slate-300 hover:border-amber-300/45 hover:bg-amber-400/15 hover:text-amber-300"
          }`}
        >
          <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </article>
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
