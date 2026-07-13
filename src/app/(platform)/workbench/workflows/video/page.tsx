// @ts-nocheck
"use client";

import { workbenchFetch } from "@workbench/lib/api";
import type { ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import DraftExplorer from "@workbench/components/video/DraftExplorer";
import ExportArchiver from "@workbench/components/video/ExportArchiver";
import FinalGenerator from "@workbench/components/video/FinalGenerator";
import FirstFramePicker, { type PickedFrame } from "@workbench/components/video/FirstFramePicker";
import MotionExtractor from "@workbench/components/video/MotionExtractor";
import MotionFXConfig, { MOTION_FX_PRESETS } from "@workbench/components/video/MotionFXConfig";
import PostProcessor from "@workbench/components/video/PostProcessor";
import { useLanguage } from "@workbench/lib/LanguageContext";
import {
  applyModelQualityResults,
  buildSubtitleSegments,
  DEFAULT_CHARACTER_LOCK_PROMPT,
  DEFAULT_PRESET_ORDER,
  DEFAULT_QUALITY_THRESHOLD,
  buildVideoPrompt,
  chooseAutoCoverUrl,
  createAutoSubtitle,
  getPresetOrderByFeedback,
  getPresetStats,
  parseBatchVariables,
  pickBestDraftByQuality,
  recordPresetFeedback,
  readPresetFeedback,
  splitSubtitleLines,
  withDraftQuality,
} from "@workbench/lib/video-automation";
import {
  DEFAULT_POST_CONFIG,
  normalizePostConfig,
  type VideoDraftItem,
  type VideoWorkflowState,
  autoSaveVideoSession,
  canAdvanceFrom,
  defaultVideoWorkflowState,
  ensureVideoJobForState,
  normalizeFirstFrame,
  normalizeVideoMediaUrl,
  restoreVideoSession,
  toBackendStaticPath,
} from "@workbench/lib/video-workflow";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";

const STEP_COUNT = 7;
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";
const DEFAULT_MULTI_ASPECT_RATIOS = ["9:16", "16:9", "1:1"];
const STORYBOARD_POLL_INTERVAL_MS = 3500;
const STORYBOARD_MAX_POLLS = 60;
const STORYBOARD_TOAST_DURATION_MS = 4200;
const DEFAULT_STORYBOARD_COUNT = 8;
const DEFAULT_STORYBOARD_STYLE = "cinematic_ad";

type MultiAspectVariant = {
  ratio: string;
  status: "idle" | "pending" | "done" | "failed";
  videoUrl?: string;
};

type StoryboardStyleOption = {
  value: string;
  label: string;
  promptHint: string;
};

type StoryboardOperationLog = {
  id: string;
  actor: string;
  triggerSource: "auto" | "manual";
  triggeredAt: string;
  finalDraftId: string;
  resultCount: number;
  status: "success" | "failed";
};

const DEFAULT_STORYBOARD_STYLE_OPTIONS: StoryboardStyleOption[] = [
  {
    value: "cinematic_ad",
    label: "电影广告风",
    promptHint: "电影广告风（强光影与镜头叙事）",
  },
  {
    value: "social_short",
    label: "社媒短视频风",
    promptHint: "社媒短视频风（节奏强、记忆点明确）",
  },
  {
    value: "documentary_real",
    label: "纪实写实风",
    promptHint: "纪实写实风（自然光影与真实质感）",
  },
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function toAbsoluteUrl(value?: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (isHttpUrl(raw)) return raw;
  if (typeof window === "undefined") return raw;
  return `${window.location.origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseStoryboardUrls(payload: { resultUrls?: unknown; videoUrl?: unknown }): string[] {
  const fromList = normalizeStringArray(payload.resultUrls);
  if (fromList.length) return [...new Set(fromList)];

  if (typeof payload.videoUrl === "string" && payload.videoUrl.trim()) {
    const raw = payload.videoUrl.trim();
    if (raw.startsWith("[")) {
      try {
        return [...new Set(normalizeStringArray(JSON.parse(raw)))];
      } catch {
        return [];
      }
    }
    return [raw];
  }
  return [];
}

function normalizeStoryboardStyleOptions(value: unknown): StoryboardStyleOption[] {
  if (!Array.isArray(value)) return [...DEFAULT_STORYBOARD_STYLE_OPTIONS];
  const options: StoryboardStyleOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const v = typeof row.value === "string" ? row.value.trim() : "";
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!v || !label) continue;
    const promptHint = typeof row.promptHint === "string" && row.promptHint.trim() ? row.promptHint.trim() : label;
    options.push({ value: v, label, promptHint });
  }
  return options.length ? options : [...DEFAULT_STORYBOARD_STYLE_OPTIONS];
}

function findStoryboardStyleOption(
  options: StoryboardStyleOption[],
  selected: string,
): StoryboardStyleOption {
  const hit = options.find((item) => item.value === selected);
  if (hit) return hit;
  return options[0] || DEFAULT_STORYBOARD_STYLE_OPTIONS[0];
}

function normalizeStoryboardOperationLogs(value: unknown): StoryboardOperationLog[] {
  if (!Array.isArray(value)) return [];
  const logs: StoryboardOperationLog[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const actor = typeof row.actor === "string" ? row.actor.trim() : "";
    const triggerSource = row.triggerSource === "auto" ? "auto" : row.triggerSource === "manual" ? "manual" : null;
    const triggeredAt = typeof row.triggeredAt === "string" ? row.triggeredAt.trim() : "";
    const finalDraftId = typeof row.finalDraftId === "string" ? row.finalDraftId.trim() : "";
    const status = row.status === "success" ? "success" : row.status === "failed" ? "failed" : null;
    const resultCount =
      typeof row.resultCount === "number" && Number.isFinite(row.resultCount) ? Math.max(0, Math.floor(row.resultCount)) : 0;
    if (!id || !actor || !triggerSource || !triggeredAt || !status) continue;
    logs.push({ id, actor, triggerSource, triggeredAt, finalDraftId, resultCount, status });
  }
  return logs.slice(0, 30);
}

function resolveStoryboardActorName(): string {
  if (typeof window === "undefined") return "当前用户";
  const candidates = [
    localStorage.getItem("workbench_user_name"),
    localStorage.getItem("workbench_username"),
    localStorage.getItem("workbench_user"),
    localStorage.getItem("workbench_email"),
  ];
  const hit = candidates.find((item) => typeof item === "string" && item.trim());
  return hit?.trim() || "当前用户";
}

function buildAutoStoryboardPrompt(
  state: VideoWorkflowState,
  count: number,
  styleLabel: string,
): string {
  const notes = (state.notes || "").trim();
  const emotion = (state.draftEmotion || "").trim();
  const draftPrompt = (state.draftPrompt || "").trim();
  const keypoints = (state.motionData?.raw_keypoints ?? [])
    .slice(0, 8)
    .map((point) => `${Number(point.timestamp || 0).toFixed(1)}s ${point.label}`)
    .join("；");
  const parts = [
    notes ? `项目背景：${notes}` : "",
    emotion ? `情绪方向：${emotion}` : "",
    draftPrompt ? `视频主题：${draftPrompt}` : "",
    keypoints ? `关键动作时间线：${keypoints}` : "",
    `请生成 ${count} 张可直接用于运营复盘的关键分镜，覆盖开场建立镜头、主体特写、动作高光、结尾收束；要求人物与风格一致，镜头语言清晰。`,
    `分镜风格偏好：${styleLabel}。`,
  ];
  return parts.filter(Boolean).join("\n");
}

interface VideoEnumOption {
  id?: number;
  enum_type?: string;
  value: string;
  label_zh: string;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("workbench_token") || "";
}

function normalizeUrl(url?: string): string | undefined {
  return normalizeVideoMediaUrl(url);
}

function splitFinalVideos(finals: VideoDraftItem[]) {
  return {
    originals: finals.filter((final) => !final.operation),
    composed: finals.filter((final) => Boolean(final.operation)).sort((a, b) => (a.id > b.id ? -1 : 1)),
  };
}

function withDefaultAspectRatio(state: VideoWorkflowState): VideoWorkflowState {
  return {
    ...state,
    motionConfig: {
      ...state.motionConfig,
      aspectRatio: (state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
      consistencyLockEnabled: (state.motionConfig?.consistencyLockEnabled as boolean) ?? true,
      consistencyLockPrompt:
        (state.motionConfig?.consistencyLockPrompt as string) ?? DEFAULT_CHARACTER_LOCK_PROMPT,
      autoQualityEnabled: (state.motionConfig?.autoQualityEnabled as boolean) ?? true,
      qualityThreshold: (state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD,
      batchEnabled: (state.motionConfig?.batchEnabled as boolean) ?? false,
      batchPerVariableCount: (state.motionConfig?.batchPerVariableCount as number) ?? 1,
      batchVariablesText: (state.motionConfig?.batchVariablesText as string) ?? "",
      autoSubtitleEnabled: (state.motionConfig?.autoSubtitleEnabled as boolean) ?? true,
      autoBgmEnabled: (state.motionConfig?.autoBgmEnabled as boolean) ?? false,
      autoCoverEnabled: (state.motionConfig?.autoCoverEnabled as boolean) ?? true,
      draftShowOnlyLowScore: (state.motionConfig?.draftShowOnlyLowScore as boolean) ?? false,
      finalShowOnlyLowScore: (state.motionConfig?.finalShowOnlyLowScore as boolean) ?? false,
      autoStoryboardAfterArchive: (state.motionConfig?.autoStoryboardAfterArchive as boolean) ?? true,
      storyboardPrompt: (state.motionConfig?.storyboardPrompt as string) ?? "",
      storyboardCount: Math.max(4, Math.min(16, Number((state.motionConfig?.storyboardCount as number) || DEFAULT_STORYBOARD_COUNT))),
      storyboardStyle: (state.motionConfig?.storyboardStyle as string) || DEFAULT_STORYBOARD_STYLE,
      storyboardStyleOptions: normalizeStoryboardStyleOptions(state.motionConfig?.storyboardStyleOptions),
      storyboardResolution: Number((state.motionConfig?.storyboardResolution as number) || 1024),
      storyboardImageUrls: normalizeStringArray(state.motionConfig?.storyboardImageUrls),
      storyboardGeneratedFinalIds: normalizeStringArray(state.motionConfig?.storyboardGeneratedFinalIds),
      storyboardOperationLogs: normalizeStoryboardOperationLogs(state.motionConfig?.storyboardOperationLogs),
      storyboardLogFilter:
        ((state.motionConfig?.storyboardLogFilter as string) || "") === "auto"
          ? "auto"
          : ((state.motionConfig?.storyboardLogFilter as string) || "") === "manual"
            ? "manual"
            : "all",
      storyboardLogLimit: [10, 20, 50].includes(Number(state.motionConfig?.storyboardLogLimit))
        ? Number(state.motionConfig?.storyboardLogLimit)
        : 10,
      storyboardLogFinalIdKeyword: (state.motionConfig?.storyboardLogFinalIdKeyword as string) ?? "",
      storyboardCsvExportMode:
        ((state.motionConfig?.storyboardCsvExportMode as string) || "") === "all" ? "all" : "filtered",
      storyboardLastTriggerSource:
        ((state.motionConfig?.storyboardLastTriggerSource as string) || "") === "auto" ? "auto" : "manual",
      storyboardLastTriggeredAt: (state.motionConfig?.storyboardLastTriggeredAt as string) || "",
      multiAspectRatios:
        (state.motionConfig?.multiAspectRatios as string[]) ?? [...DEFAULT_MULTI_ASPECT_RATIOS],
    },
  };
}

function StepNav({
  current,
  labels,
}: {
  current: number;
  labels: string[];
}) {
  return (
    <div className="mb-8 flex items-center gap-1 overflow-x-auto pb-1">
      {labels.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex flex-shrink-0 items-center gap-1">
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                active
                  ? "bg-blue-600 text-white"
                  : done
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-100 text-gray-400"
              }`}
            >
              <span>{done ? "✓" : step}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div className={`h-px w-4 flex-shrink-0 ${done ? "bg-green-300" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VideoWorkflowInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, lang } = useLanguage();
  const token = getToken();

  const [state, setState] = useState<VideoWorkflowState>(() => withDefaultAspectRatio(defaultVideoWorkflowState()));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [videoModels, setVideoModels] = useState<{ id: number; name: string; model_name: string }[]>([]);
  const [finalModels, setFinalModels] = useState<{ id: number; name: string; model_name: string }[]>([]);
  const [analysisModelId, setAnalysisModelId] = useState<number | undefined>();
  const [emotionOptions, setEmotionOptions] = useState<VideoEnumOption[]>([]);
  const [actionOptions, setActionOptions] = useState<VideoEnumOption[]>([]);
  const [generatingFinal, setGeneratingFinal] = useState(false);
  const [composingLogo, setComposingLogo] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [composedVideos, setComposedVideos] = useState<VideoDraftItem[]>([]);
  const [presetOrder, setPresetOrder] = useState<string[]>([...DEFAULT_PRESET_ORDER]);
  const [presetStats, setPresetStats] = useState<Record<string, { winRate: number; samples: number }>>({});
  const [autoPostNotice, setAutoPostNotice] = useState<string | null>(null);
  const [multiAspectGenerating, setMultiAspectGenerating] = useState(false);
  const [multiAspectVariants, setMultiAspectVariants] = useState<MultiAspectVariant[]>([]);
  const [storyboardGenerating, setStoryboardGenerating] = useState(false);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);
  const [storyboardNotice, setStoryboardNotice] = useState<string | null>(null);
  const [storyboardToast, setStoryboardToast] = useState<{
    message: string;
    tone: "info" | "success" | "warning" | "error";
  } | null>(null);
  const [storyboardUndoSnapshot, setStoryboardUndoSnapshot] = useState<string[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDraftRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFinalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobCreatedRef = useRef(false);
  const storyboardToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stepLabels = [
    t("首帧选择"),
    t("草稿探索"),
    t("动作提炼"),
    t("动效配置"),
    t("精品生成"),
    t("后处理"),
    t("导出归档"),
  ];

  const showStoryboardToast = useCallback(
    (
      message: string,
      tone: "info" | "success" | "warning" | "error" = "info",
    ) => {
      if (storyboardToastTimerRef.current) {
        clearTimeout(storyboardToastTimerRef.current);
      }
      setStoryboardToast({ message, tone });
      storyboardToastTimerRef.current = setTimeout(() => {
        setStoryboardToast(null);
      }, STORYBOARD_TOAST_DURATION_MS);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (storyboardToastTimerRef.current) {
        clearTimeout(storyboardToastTimerRef.current);
      }
    };
  }, []);

  const appendStoryboardOperationLog = useCallback(
    (
      baseState: VideoWorkflowState,
      entry: Omit<StoryboardOperationLog, "id">,
    ): VideoWorkflowState => {
      const currentLogs = normalizeStoryboardOperationLogs(baseState.motionConfig?.storyboardOperationLogs);
      const nextLog: StoryboardOperationLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...entry,
      };
      return {
        ...baseState,
        motionConfig: {
          ...baseState.motionConfig,
          storyboardOperationLogs: [nextLog, ...currentLogs].slice(0, 30),
        },
      };
    },
    [],
  );

  const refreshPresetFeedback = useCallback(() => {
    const feedbackEntries = readPresetFeedback();
    const defaultOrder = MOTION_FX_PRESETS.map((preset) => preset.id);
    setPresetOrder(getPresetOrderByFeedback(feedbackEntries, defaultOrder));
    setPresetStats(getPresetStats(feedbackEntries));
  }, []);

  const getQualityOptions = useCallback(
    (duration?: number) => ({
      targetDuration: duration ?? ((state.motionConfig?.draftDuration as number) ?? 5),
      threshold: (state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD,
    }),
    [state.motionConfig],
  );

  const markDraftsWithQuality = useCallback(
    (drafts: VideoDraftItem[], duration?: number) => withDraftQuality(drafts, getQualityOptions(duration)),
    [getQualityOptions],
  );

  const scoreDraftsWithModel = useCallback(
    async (
      drafts: VideoDraftItem[],
      jobId: string,
      draftType: "draft" | "final",
      duration?: number,
    ): Promise<VideoDraftItem[]> => {
      const autoQualityEnabled = (state.motionConfig?.autoQualityEnabled as boolean) ?? true;
      const fallback = markDraftsWithQuality(drafts, duration);
      if (!autoQualityEnabled) return fallback;
      const candidateIds = fallback
        .filter((item) => (item.status === "done" || item.status === "selected") && item.video_url)
        .map((item) => item.id);
      if (!candidateIds.length) return fallback;

      try {
        const response = await workbenchFetch(`/api/video/motion/quality-score/${jobId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
          },
          body: JSON.stringify({
            draft_ids: candidateIds,
            draft_type: draftType,
            threshold: (state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD,
            model_config_id: analysisModelId,
          }),
        });
        const data = await response.json();
        if (data?.code !== 0 || !Array.isArray(data?.data?.items)) {
          return fallback;
        }
        return applyModelQualityResults(
          fallback,
          data.data.items.map((item: any) => ({
            draftId: String(item.draft_id),
            score: Number(item.score ?? 0),
            grade: (item.grade ?? "C") as "A" | "B" | "C" | "D",
            reasons: Array.isArray(item.reasons) ? item.reasons : [],
            suggestions: Array.isArray(item.suggestions) ? item.suggestions : [],
            dimensions: {
              consistency: Number(item.consistency_score ?? item.score ?? 0),
              motion: Number(item.motion_score ?? item.score ?? 0),
              visual: Number(item.visual_score ?? item.score ?? 0),
              textClean: Number(item.text_clean_score ?? item.score ?? 0),
            },
          })),
        );
      } catch (error) {
        console.warn("[quality-score] fallback to local score:", error);
        return fallback;
      }
    },
    [analysisModelId, markDraftsWithQuality, state.motionConfig],
  );

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const jobId = searchParams.get("job_id");

    async function bootstrapVideoWorkflow() {
      const loadMotionData = async (videoJobId: string) => {
        try {
          const motionResponse = await workbenchFetch(`/api/video/motion/${videoJobId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const motionResult = await motionResponse.json();
          if (motionResult?.code === 0 && motionResult.data) {
            return {
              motion_sequence: motionResult.data.motion_sequence ?? [],
              timing: motionResult.data.timing ?? {},
              raw_keypoints: motionResult.data.raw_keypoints ?? [],
            };
          }
        } catch {}
        return undefined;
      };

      if (sessionId && token) {
        const restored = await restoreVideoSession(Number(sessionId), token);
        if (restored) {
          if (restored.videoJobId) {
            try {
              const motionData = await loadMotionData(restored.videoJobId);
              const finalResponse = await workbenchFetch(`/api/video/draft/${restored.videoJobId}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const finalResult = await finalResponse.json();
              const allFinals: VideoDraftItem[] = markDraftsWithQuality(
                finalResult?.code === 0
                  ? (finalResult.data?.drafts ?? []).map((draft: any) => ({
                      id: draft.id,
                      model: draft.model,
                      video_url: normalizeUrl(draft.video_url),
                      thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url),
                      duration_seconds: draft.duration_seconds,
                      status: draft.status,
                      selected: draft.selected,
                      operation: draft.operation,
                      generation_cost: draft.generation_cost,
                    }))
                  : [],
              );
              const { originals: finals, composed } = splitFinalVideos(allFinals);
              const selectedFinal =
                finals.find((final) => final.id === restored.originalFinalId) ??
                finals.find((final) => final.selected || final.status === "selected") ??
                finals.find((final) => final.status === "done");
              const response = await workbenchFetch(`/api/video/jobs/${restored.videoJobId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
              });
              const res = await response.json();
              if (res?.code === 0) {
                setComposedVideos(composed);
                setState({
                  ...restored,
                  finalVideos: finals,
                  selectedFinalId: selectedFinal?.id,
                  originalFinalId: selectedFinal?.id,
                  composedFinalId:
                    composed.find((final) => final.id === restored.composedFinalId)?.id ?? composed[0]?.id,
                  motionData: motionData ?? restored.motionData,
                  motionConfig: {
                    ...restored.motionConfig,
                    aspectRatio:
                      res.data.aspect_ratio ??
                      (restored.motionConfig?.aspectRatio as string) ??
                      DEFAULT_VIDEO_ASPECT_RATIO,
                  },
                });
                return;
              }
            } catch {}
            const motionData = await loadMotionData(restored.videoJobId);
            try {
              const finalResponse = await workbenchFetch(`/api/video/draft/${restored.videoJobId}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const finalResult = await finalResponse.json();
              if (finalResult?.code === 0) {
                const allFinals: VideoDraftItem[] = markDraftsWithQuality(
                  (finalResult.data?.drafts ?? []).map((draft: any) => ({
                    id: draft.id,
                    model: draft.model,
                    video_url: normalizeUrl(draft.video_url),
                    thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url),
                    duration_seconds: draft.duration_seconds,
                    status: draft.status,
                    selected: draft.selected,
                    operation: draft.operation,
                    generation_cost: draft.generation_cost,
                  })),
                );
                const { originals: finals, composed } = splitFinalVideos(allFinals);
                const selectedFinal =
                  finals.find((final) => final.id === restored.originalFinalId) ??
                  finals.find((final) => final.selected || final.status === "selected") ??
                  finals.find((final) => final.status === "done");
                setComposedVideos(composed);
                setState({
                  ...restored,
                  finalVideos: finals,
                  selectedFinalId: selectedFinal?.id,
                  originalFinalId: selectedFinal?.id,
                  composedFinalId:
                    composed.find((final) => final.id === restored.composedFinalId)?.id ?? composed[0]?.id,
                  motionData: motionData ?? restored.motionData,
                  motionConfig: {
                    ...restored.motionConfig,
                    aspectRatio: (restored.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
                  },
                });
                return;
              }
            } catch {}
            if (motionData) {
              const restoredFinals = splitFinalVideos(restored.finalVideos ?? []);
              setComposedVideos(restoredFinals.composed);
              setState({
                ...restored,
                finalVideos: restoredFinals.originals,
                selectedFinalId:
                  restoredFinals.originals.find((final) => final.id === restored.originalFinalId)?.id ??
                  restoredFinals.originals.find((final) => final.selected || final.status === "selected")?.id ??
                  restoredFinals.originals.find((final) => final.status === "done")?.id,
                originalFinalId:
                  restoredFinals.originals.find((final) => final.id === restored.originalFinalId)?.id ??
                  restoredFinals.originals.find((final) => final.selected || final.status === "selected")?.id ??
                  restoredFinals.originals.find((final) => final.status === "done")?.id,
                composedFinalId:
                  restoredFinals.composed.find((final) => final.id === restored.composedFinalId)?.id ??
                  restoredFinals.composed[0]?.id,
                motionData,
                motionConfig: {
                  ...restored.motionConfig,
                  aspectRatio: (restored.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
                },
              });
              return;
            }
          }
          const restoredFinals = splitFinalVideos(restored.finalVideos ?? []);
          setComposedVideos(restoredFinals.composed);
          setState({
            ...restored,
            finalVideos: restoredFinals.originals,
            selectedFinalId:
              restoredFinals.originals.find((final) => final.id === restored.originalFinalId)?.id ??
              restoredFinals.originals.find((final) => final.selected || final.status === "selected")?.id ??
              restoredFinals.originals.find((final) => final.status === "done")?.id,
            originalFinalId:
              restoredFinals.originals.find((final) => final.id === restored.originalFinalId)?.id ??
              restoredFinals.originals.find((final) => final.selected || final.status === "selected")?.id ??
              restoredFinals.originals.find((final) => final.status === "done")?.id,
            composedFinalId:
              restoredFinals.composed.find((final) => final.id === restored.composedFinalId)?.id ??
              restoredFinals.composed[0]?.id,
            motionConfig: {
              ...restored.motionConfig,
              aspectRatio: (restored.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
            },
          });
        }
      } else if (jobId && token) {
        const API_BASE = "/api/workbench";
        workbenchFetch(`/api/video/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
        })
          .then((response) => response.json())
          .then(async (res) => {
            if (res?.code === 0) {
              const job = res.data;
              let drafts: VideoDraftItem[] = [];
              let finalVideos: VideoDraftItem[] = [];
              let selectedDraftId: string | undefined;
              let selectedFinalId: string | undefined;
              let composedFinalId: string | undefined;
              const motionData = await loadMotionData(job.id);
              const draftsResponse = await workbenchFetch(`/api/video/draft/${job.id}/list?draft_type=draft`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
              });
              const finalsResponse = await workbenchFetch(`/api/video/draft/${job.id}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
              });
              const draftsData = await draftsResponse.json();
              const finalsData = await finalsResponse.json();
              if (draftsData?.code === 0) {
                drafts = markDraftsWithQuality(
                  (draftsData.data?.drafts ?? []).map((draft: any) => ({
                    id: draft.id,
                    model: draft.model,
                    video_url: draft.video_url,
                    thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url),
                    duration_seconds: draft.duration_seconds,
                    status: draft.status,
                    selected: draft.selected,
                    generation_cost: draft.generation_cost,
                  })),
                );
                const selectedDraft = drafts.find((draft) => draft.selected || draft.status === "selected");
                selectedDraftId = selectedDraft?.id;
              }
              if (finalsData?.code === 0) {
                const allFinals: VideoDraftItem[] = markDraftsWithQuality(
                  (finalsData.data?.drafts ?? []).map((draft: any) => ({
                    id: draft.id,
                    model: draft.model,
                    video_url: normalizeUrl(draft.video_url),
                    thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url),
                    duration_seconds: draft.duration_seconds,
                    status: draft.status,
                    selected: draft.selected,
                    operation: draft.operation,
                    generation_cost: draft.generation_cost,
                  })),
                );
                const { originals, composed } = splitFinalVideos(allFinals);
                finalVideos = originals;
                setComposedVideos(composed);
                composedFinalId = composed[0]?.id;
                const selectedFinal = finalVideos.find(
                  (draft) => (draft.selected || draft.status === "selected") && draft.video_url,
                ) ?? finalVideos.find((draft) => draft.status === "done" && draft.video_url);
                selectedFinalId = selectedFinal?.id;
              }
              jobCreatedRef.current = true;
              setState((prev) => ({
                ...prev,
                drafts,
                finalVideos,
                selectedDraftId,
                selectedFinalId,
                originalFinalId: selectedFinalId,
                composedFinalId,
                videoJobId: job.id,
                sessionId: job.session_id,
                currentStep: job.current_step ?? 1,
                firstFrameStatus: job.first_frame_status ?? "empty",
                firstFrame: job.first_frame_url
                  ? normalizeFirstFrame({
                      asset_id: job.first_frame_asset_id,
                      url: job.first_frame_url,
                      source_type: job.first_frame_source_type ?? "gallery",
                    })
                  : undefined,
                notes: job.notes ?? "",
                videoLanguage: job.video_language ?? "english",
                motionData: motionData ?? prev.motionData,
                motionConfig: {
                  ...prev.motionConfig,
                  aspectRatio:
                    job.aspect_ratio ?? (prev.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
                },
              }));
              if (job.session_id) {
                const url = new URL(window.location.href);
                url.searchParams.set("session_id", String(job.session_id));
                url.searchParams.delete("job_id");
                window.history.replaceState(null, "", url.toString());
              }
            }
          })
          .catch(console.error);
      } else if (token && !jobCreatedRef.current) {
        const existingSessionId = searchParams.get("session_id");
        if (!existingSessionId) {
          jobCreatedRef.current = true;
          workbenchFetch("/api/video/jobs/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
            },
            body: JSON.stringify({
              video_language: state.videoLanguage || "english",
            }),
          })
            .then((response) => response.json())
            .then((res) => {
            if (res?.code === 0) {
              setState((prev) => ({
                ...prev,
                videoJobId: res.data.id,
                sessionId: res.data.session_id,
                motionConfig: {
                  ...prev.motionConfig,
                  aspectRatio: (prev.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO,
                },
              }));
              const url = new URL(window.location.href);
              url.searchParams.set("session_id", String(res.data.session_id));
              window.history.replaceState(null, "", url.toString());
            }
            });
        }
      }
    }

    void bootstrapVideoWorkflow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (nextState: VideoWorkflowState) => {
      if (!token) return nextState;
      setSaving(true);
      setSaveError(false);
      const result = await autoSaveVideoSession(nextState);
      setSaving(false);
      if (result) {
        const updated = { ...nextState, sessionId: result.sessionId, lastSavedAt: result.savedAt };
        const url = new URL(window.location.href);
        url.searchParams.set("session_id", String(result.sessionId));
        window.history.replaceState(null, "", url.toString());
        return updated;
      }
      setSaveError(true);
      return nextState;
    },
    [token],
  );

  useEffect(() => {
    if (state.firstFrameStatus === "awaiting_make" && state.videoJobId) {
      pollRef.current = setInterval(async () => {
        const response = await workbenchFetch(`/api/video/first-frame/${state.videoJobId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
        });
        const res = await response.json();
        if (res?.code === 0 && res.data.first_frame_status === "selected") {
          if (pollRef.current) clearInterval(pollRef.current);
          setState((prev) => ({
            ...prev,
            firstFrameStatus: "selected",
            firstFrame: normalizeFirstFrame({
              asset_id: res.data.first_frame_asset_id || 0,
              url: res.data.first_frame_url || "",
              source_type: "frame",
            }),
          }));
        }
      }, 5000);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pollDraftRef.current) clearInterval(pollDraftRef.current);
      if (pollFinalRef.current) clearInterval(pollFinalRef.current);
    };
  }, [state.firstFrameStatus, state.videoJobId]);

  useEffect(() => {
    workbenchFetch(`/api/model-configs/video?usage=draft`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
    })
      .then((response) => response.json())
      .then((res) => {
        if (res?.code === 0) {
          setVideoModels(res.data ?? []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    workbenchFetch(`/api/model-configs/video?usage=final`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
    })
      .then((response) => response.json())
      .then((res) => {
        if (res?.code === 0) {
          setFinalModels(res.data ?? []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    workbenchFetch("/api/model-configs?purpose=video_analysis", {
      headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
    })
      .then((response) => response.json())
      .then((res) => {
        if (res?.code === 0 && res.data?.length > 0) {
          setAnalysisModelId(res.data[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const loadVideoEnums = useCallback(async (enumType: "emotion" | "action") => {
    try {
      const response = await workbenchFetch(`/api/video/enums?type=${enumType}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
      });
      const res = await response.json();
      if (res?.code === 0 && Array.isArray(res.data)) {
        if (enumType === "emotion") {
          setEmotionOptions(res.data);
        } else {
          setActionOptions(res.data);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    void loadVideoEnums("emotion");
    void loadVideoEnums("action");
  }, [loadVideoEnums]);

  useEffect(() => {
    refreshPresetFeedback();
  }, [refreshPresetFeedback]);

  const createVideoEnum = async (enumType: "emotion" | "action", labelZh: string, value: string) => {
    const response = await workbenchFetch("/api/video/enums", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
      },
      body: JSON.stringify({
        enum_type: enumType,
        value,
        label_zh: labelZh,
      }),
    });
    const res = await response.json();
    if (res?.code !== 0) throw new Error(res?.msg || "enum create failed");
    if (Array.isArray(res.data)) {
      if (enumType === "emotion") {
        setEmotionOptions(res.data);
      } else {
        setActionOptions(res.data);
      }
    }
  };

  const handleRecordPresetFeedback = useCallback(
    (rating: "good" | "bad") => {
      const presetId = (state.motionConfig?.fxPresetId as string) || "custom";
      const selectedVideo =
        composedVideos.find((final) => final.id === state.composedFinalId) ||
        state.finalVideos.find((final) => final.id === state.originalFinalId);
      recordPresetFeedback(presetId, rating, selectedVideo?.qualityScore);
      refreshPresetFeedback();
    },
    [composedVideos, refreshPresetFeedback, state.composedFinalId, state.finalVideos, state.motionConfig, state.originalFinalId],
  );

  const handleAutoPostGenerate = useCallback(async () => {
    const autoSubtitleEnabled = (state.motionConfig?.autoSubtitleEnabled as boolean) ?? true;
    const autoBgmEnabled = (state.motionConfig?.autoBgmEnabled as boolean) ?? false;
    const autoCoverEnabled = (state.motionConfig?.autoCoverEnabled as boolean) ?? true;
    const baseConfig = normalizePostConfig(state.postConfig ?? DEFAULT_POST_CONFIG);
    const selectedVideo =
      composedVideos.find((final) => final.id === state.composedFinalId) ||
      state.finalVideos.find((final) => final.id === state.originalFinalId);
    const autoSubtitle = createAutoSubtitle(state.draftPrompt, state.motionData);
    const subtitleMaxChars = baseConfig.subtitle.maxCharsPerLine ?? 14;
    const subtitleLines = splitSubtitleLines(autoSubtitle, subtitleMaxChars);
    const subtitleSegments = buildSubtitleSegments(
      autoSubtitle,
      (selectedVideo?.duration_seconds as number) || (state.motionConfig?.draftDuration as number) || 5,
      subtitleMaxChars,
    );
    const autoCover = chooseAutoCoverUrl(
      selectedVideo?.video_url,
      selectedVideo?.thumbnail_url,
      normalizeVideoMediaUrl(state.firstFrame?.url),
    );

    const nextState: VideoWorkflowState = {
      ...state,
      postConfig: {
        ...baseConfig,
        subtitle: {
          ...baseConfig.subtitle,
          enabled: autoSubtitleEnabled ? true : baseConfig.subtitle.enabled,
          text: autoSubtitleEnabled ? autoSubtitle : baseConfig.subtitle.text,
          lines: autoSubtitleEnabled ? subtitleLines : baseConfig.subtitle.lines,
          segments: autoSubtitleEnabled ? subtitleSegments : baseConfig.subtitle.segments,
          styleTemplate: baseConfig.subtitle.styleTemplate ?? "social_pop",
        },
      },
      motionConfig: {
        ...state.motionConfig,
        sound: autoBgmEnabled ? true : ((state.motionConfig?.sound as boolean) ?? false),
        autoCoverUrl: autoCoverEnabled ? autoCover : "",
      },
    };

    setState(nextState);
    await save(nextState);
    const notes: string[] = [];
    if (autoSubtitleEnabled) notes.push("字幕");
    if (autoBgmEnabled) notes.push("BGM");
    if (autoCoverEnabled) notes.push("封面");
    setAutoPostNotice(notes.length ? `已自动生成：${notes.join(" / ")}` : "未启用自动项");
  }, [composedVideos, save, state]);

  const goNext = async () => {
    if (!canAdvanceFrom(state.currentStep, state)) return;

    let workingState = state;
    if (state.currentStep === 1) {
      const ensured = await ensureVideoJobForState(state);
      if (!ensured?.videoJobId) {
        alert(t("无法创建视频任务，请刷新页面后重试"));
        return;
      }
      workingState = ensured;
    }

    const next = Math.min(workingState.currentStep + 1, STEP_COUNT);
    const updated = { ...workingState, currentStep: next };
    if (workingState.videoJobId && workingState.notes) {
      try {
        await workbenchFetch(`/api/video/jobs/${workingState.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
          },
          body: JSON.stringify({ notes: workingState.notes }),
        });
      } catch {}
    }
    const saved = await save(updated);
    if (workingState.videoJobId) {
      try {
        await workbenchFetch(`/api/video/jobs/${workingState.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
          },
          body: JSON.stringify({ current_step: next }),
        });
      } catch {}
    }
    setState(saved);
  };

  const goPrev = async () => {
    if (state.currentStep <= 1) return;
    const prev = state.currentStep - 1;
    const updated = { ...state, currentStep: prev };
    const saved = await save(updated);
    setState(saved);
  };

  const handleSelectFromLibrary = () => {
    setShowPicker(true);
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState((prev) => ({ ...prev, firstFrameStatus: "uploading" }));
    const form = new FormData();
    form.append("file", file);
    form.append("category", "video_first_frame");
    try {
      const res = await workbenchFetch(`/api/assets/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (data?.code === 0) {
        const asset = data.data;
        const nextState: VideoWorkflowState = {
          ...state,
          firstFrameStatus: "selected",
          firstFrame: normalizeFirstFrame({
            asset_id: asset.id,
            url: asset.url,
            source_type: "upload",
          }),
        };
        setState(nextState);
        if (state.videoJobId) {
          try {
            await workbenchFetch(`/api/video/first-frame/${state.videoJobId}/select`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
              },
              body: JSON.stringify({
                asset_id: asset.id,
                url: asset.url,
                source_type: "upload",
              }),
            });
          } catch (error) {
            console.warn("[handleUpload] persist failed:", error);
          }
        }
        const saved = await save(nextState);
        setState(saved);
      } else {
        setState((prev) => ({ ...prev, firstFrameStatus: "empty" }));
      }
    } catch {
      setState((prev) => ({ ...prev, firstFrameStatus: "empty" }));
    } finally {
      e.target.value = "";
    }
  };

  const handleAwaitingMake = async () => {
    const preSaved = await save({ ...state, firstFrameStatus: "awaiting_make" });
    setState(preSaved);
    const sessionParam = preSaved.sessionId ? `&return_session=${preSaved.sessionId}` : "";
    window.open(`/workbench/workflows/expression?return_to=video${sessionParam}`, "_blank");
  };

  const handlePickerSelect = async (frame: PickedFrame) => {
    console.log("[handlePickerSelect] frame:", frame);
    const nextState: VideoWorkflowState = {
      ...state,
      firstFrameStatus: "selected",
      firstFrame: normalizeFirstFrame({
        asset_id: frame.asset_id,
        url: frame.url,
        source_type: frame.source_type,
      }),
    };
    console.log("[handlePickerSelect] next.firstFrame:", nextState.firstFrame);
    setState(nextState);
    setShowPicker(false);
    const jobId = nextState.videoJobId ?? state.videoJobId;
    if (jobId) {
      try {
        await workbenchFetch(`/api/video/first-frame/${jobId}/select`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
          },
          body: JSON.stringify({
            asset_id: frame.asset_id,
            url: toBackendStaticPath(frame.url),
            source_type: frame.source_type,
          }),
        });
      } catch (error) {
        console.warn("[handlePickerSelect] persist failed:", error);
      }
    }
    save(nextState).then((saved) => setState(saved));
  };

  const handleGenerate = async () => {
    if (!state.firstFrame?.url) {
      alert(t("请先在 Step 1 选择首帧"));
      return;
    }
    const modelConfigId = state.motionConfig?.modelConfigId as number;
    if (!modelConfigId) {
      alert(t("请先选择生成模型"));
      return;
    }

    const ensured = await ensureVideoJobForState(state);
    if (!ensured?.videoJobId) {
      alert(t("无法创建视频任务，请刷新页面后重试"));
      return;
    }
    let activeState = ensured;
    if (ensured.videoJobId !== state.videoJobId || ensured.sessionId !== state.sessionId) {
      activeState = (await save(ensured)) ?? ensured;
      setState(activeState);
    }
    const videoJobId = activeState.videoJobId!;

    setGenerating(true);
    if (pollDraftRef.current) {
      clearInterval(pollDraftRef.current);
      pollDraftRef.current = null;
    }
    setState((prev) => ({ ...prev, ...activeState, drafts: [], selectedDraftId: undefined }));

    const token = localStorage.getItem("workbench_token") ?? "";
    const count = (activeState.motionConfig?.draftCount as number) ?? 5;
    const duration = (activeState.motionConfig?.draftDuration as number) ?? 5;
    const aspectRatio = (activeState.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO;
    const autoBgmEnabled = (activeState.motionConfig?.autoBgmEnabled as boolean) ?? false;
    const sound =
      typeof activeState.motionConfig?.sound === "boolean"
        ? (activeState.motionConfig?.sound as boolean)
        : autoBgmEnabled;
    const qualityThreshold = (activeState.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD;
    const autoQualityEnabled = (activeState.motionConfig?.autoQualityEnabled as boolean) ?? true;
    const batchEnabled = (activeState.motionConfig?.batchEnabled as boolean) ?? false;
    const batchVariables = parseBatchVariables(activeState.motionConfig?.batchVariablesText as string);
    const batchPerVariableCount = (activeState.motionConfig?.batchPerVariableCount as number) ?? 1;
    const consistencyLockEnabled = (activeState.motionConfig?.consistencyLockEnabled as boolean) ?? true;
    const consistencyLockPrompt =
      (activeState.motionConfig?.consistencyLockPrompt as string) ?? DEFAULT_CHARACTER_LOCK_PROMPT;
    // 减去 1s 缓冲，防止客户端时钟略快于服务器时钟导致草稿被 since 过滤掉
    const generateStartTime = new Date(Date.now() - 1000).toISOString();
    const basePromptText = buildVideoPrompt({
      emotion: activeState.draftEmotion,
      prompt: activeState.draftPrompt,
      consistencyLockEnabled,
      consistencyLockPrompt,
    });
    const requests =
      batchEnabled && batchVariables.length > 0
        ? batchVariables.map((variable) => ({
            prompt: buildVideoPrompt({
              emotion: activeState.draftEmotion,
              prompt: activeState.draftPrompt,
              variable,
              consistencyLockEnabled,
              consistencyLockPrompt,
            }),
            count: Math.max(batchPerVariableCount, 1),
          }))
        : [{ prompt: basePromptText, count }];

    try {
      let successCount = 0;
      for (const request of requests) {
        const response = await workbenchFetch(`/api/video/draft/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            job_id: videoJobId,
            model_config_id: modelConfigId,
            prompt: request.prompt,
            negative_prompt: "text, watermark, subtitle, caption, words, letters, typography, writing",
            aspect_ratio: aspectRatio,
            duration,
            count: request.count,
            sound,
            draft_type: "draft",
          }),
        });
        const data = await response.json();
        if (data?.code === 0) {
          successCount += 1;
          continue;
        }
        console.warn("[handleGenerate] single batch request failed:", data);
      }
      if (successCount === 0) {
        alert(t("草稿生成失败，请稍后重试"));
        setGenerating(false);
        return;
      }

      if (pollDraftRef.current) clearInterval(pollDraftRef.current);
      pollDraftRef.current = setInterval(async () => {
        try {
          const pollResponse = await workbenchFetch(`/api/video/draft/${videoJobId}/list?draft_type=draft&since=${encodeURIComponent(generateStartTime)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          const pollData = await pollResponse.json();
          if (pollData?.code === 0) {
            const drafts: VideoDraftItem[] = markDraftsWithQuality(
              (pollData.data?.drafts ?? []).map((draft: any) => ({
                id: draft.id,
                model: draft.model,
                video_url: draft.video_url,
                thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url ?? state.firstFrame?.url),
                duration_seconds: draft.duration_seconds,
                status: draft.status,
                selected: draft.selected,
                generation_cost: draft.generation_cost,
                aspectRatio,
              })),
              duration,
            );
            setState((prev) => ({ ...prev, drafts }));
            if (pollData.data?.all_done) {
              if (pollDraftRef.current) clearInterval(pollDraftRef.current);
              pollDraftRef.current = null;
              setGenerating(false);
              const allResponse = await workbenchFetch(`/api/video/draft/${videoJobId}/list?draft_type=draft`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const allData = await allResponse.json();
              if (allData?.code === 0) {
                const allDraftsBase: VideoDraftItem[] = markDraftsWithQuality(
                  (allData.data?.drafts ?? []).map((draft: any) => ({
                    id: draft.id,
                    model: draft.model,
                    video_url: draft.video_url,
                    thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url),
                    duration_seconds: draft.duration_seconds,
                    status: draft.status,
                    selected: draft.selected,
                    generation_cost: draft.generation_cost,
                    aspectRatio,
                  })),
                  duration,
                );
                const allDrafts = await scoreDraftsWithModel(allDraftsBase, videoJobId, "draft", duration);

                const bestDraft = autoQualityEnabled
                  ? pickBestDraftByQuality(allDrafts, {
                      targetDuration: duration,
                      threshold: qualityThreshold,
                    })
                  : undefined;

                setState((prev) => ({
                  ...prev,
                  drafts: allDrafts,
                  selectedDraftId: bestDraft?.id ?? prev.selectedDraftId,
                }));

                if (bestDraft?.id && state.videoJobId) {
                  try {
                    await workbenchFetch(`/api/video/draft/${state.videoJobId}/select/${bestDraft.id}`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
                    });
                  } catch {}
                }
              }
            }
          }
        } catch (error) {
          console.warn("[pollDraft] error:", error);
        }
      }, 8000);
    } catch (error) {
      console.error("[handleGenerate] fetch error:", error);
      setGenerating(false);
    }
  };

  const handleSelectDraft = async (draftId: string) => {
    const nextState = { ...state, selectedDraftId: draftId };
    setState(nextState);
    if (state.videoJobId) {
      try {
        await workbenchFetch(`/api/video/draft/${state.videoJobId}/select/${draftId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
        });
      } catch (error) {
        console.warn("select draft failed:", error);
      }
    }
    void save(nextState);
  };

  const handleAspectRatioChange = async (value: string) => {
    const nextState: VideoWorkflowState = {
      ...state,
      motionConfig: {
        ...state.motionConfig,
        aspectRatio: value,
        multiAspectRatios: Array.from(
          new Set([
            ...(Array.isArray(state.motionConfig?.multiAspectRatios)
              ? (state.motionConfig?.multiAspectRatios as string[])
              : []),
            value,
          ]),
        ),
      },
    };
    setState(nextState);
    void save(nextState);
    if (state.videoJobId) {
      try {
        await workbenchFetch(`/api/video/jobs/${state.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
          },
          body: JSON.stringify({ aspect_ratio: value }),
        });
      } catch {}
    }
  };

  const handleGenerateFinal = async () => {
    if (!state.videoJobId) return;
    const modelConfigId = state.motionConfig?.finalModelConfigId as number;
    if (!modelConfigId) {
      alert(t("请先选择精品模型"));
      return;
    }

    setGeneratingFinal(true);
    setComposedVideos([]);
    setMultiAspectVariants([]);
    setState((prev) => ({
      ...prev,
      finalVideos: [],
      selectedFinalId: undefined,
      originalFinalId: undefined,
      composedFinalId: undefined,
    }));

    const finalToken = localStorage.getItem("workbench_token") ?? "";
    // 减去 1s 缓冲，防止客户端时钟略快于服务器时钟导致草稿被 since 过滤掉
    const generateStartTime = new Date(Date.now() - 1000).toISOString();
    const aspectRatio = (state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO;
    const duration = (state.motionConfig?.draftDuration as number) ?? 5;
    const autoBgmEnabled = (state.motionConfig?.autoBgmEnabled as boolean) ?? false;
    const sound =
      typeof state.motionConfig?.sound === "boolean" ? (state.motionConfig?.sound as boolean) : autoBgmEnabled;
    const qualityThreshold = (state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD;
    const autoQualityEnabled = (state.motionConfig?.autoQualityEnabled as boolean) ?? true;
    const consistencyLockEnabled = (state.motionConfig?.consistencyLockEnabled as boolean) ?? true;
    const consistencyLockPrompt =
      (state.motionConfig?.consistencyLockPrompt as string) ?? DEFAULT_CHARACTER_LOCK_PROMPT;
    const motionText = state.motionData?.motion_sequence?.join(", ") ?? "";
    const promptText = buildVideoPrompt({
      emotion: state.draftEmotion,
      prompt: `${state.draftPrompt || ""} Motion: ${motionText}`.trim(),
      consistencyLockEnabled,
      consistencyLockPrompt,
    });

    try {
      const response = await workbenchFetch("/api/video/draft/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${finalToken}`,
        },
        body: JSON.stringify({
          job_id: state.videoJobId,
          model_config_id: modelConfigId,
          prompt: promptText,
          negative_prompt: "text, watermark, subtitle, caption, words, letters, typography, writing",
          aspect_ratio: aspectRatio,
          duration,
          count: 1,
          sound,
          draft_type: "final",
        }),
      });
      const data = await response.json();
      if (data?.code !== 0) {
        setGeneratingFinal(false);
        return;
      }

      if (pollFinalRef.current) clearInterval(pollFinalRef.current);
      pollFinalRef.current = setInterval(async () => {
        try {
          const pollResponse = await workbenchFetch(`/api/video/draft/${state.videoJobId}/list?draft_type=final&since=${encodeURIComponent(generateStartTime)}`,
            {
              headers: { Authorization: `Bearer ${finalToken}` },
            },
          );
          const pollData = await pollResponse.json();
          if (pollData?.code === 0) {
            const allFinalsBase: VideoDraftItem[] = markDraftsWithQuality(
              (pollData.data?.drafts ?? []).map((draft: any) => ({
                id: draft.id,
                model: draft.model,
                video_url: normalizeUrl(draft.video_url),
                thumbnail_url: normalizeVideoMediaUrl(draft.thumbnail_url ?? state.firstFrame?.url),
                duration_seconds: draft.duration_seconds,
                status: draft.status,
                selected: draft.selected,
                operation: draft.operation,
                generation_cost: draft.generation_cost,
                aspectRatio,
              })),
              duration,
            );
            const { originals: finalsPreview, composed } = splitFinalVideos(allFinalsBase);
            setComposedVideos(composed);
            setState((prev) => ({
              ...prev,
              finalVideos: finalsPreview,
            }));
            if (pollData.data?.all_done) {
              const allFinals = await scoreDraftsWithModel(allFinalsBase, state.videoJobId, "final", duration);
              const { originals: finals } = splitFinalVideos(allFinals);
              const bestFinal = autoQualityEnabled
                ? pickBestDraftByQuality(finals, {
                    targetDuration: duration,
                    threshold: qualityThreshold,
                  })
                : undefined;
              setState((prev) => ({
                ...prev,
                finalVideos: finals,
                selectedFinalId: bestFinal?.id ?? prev.selectedFinalId,
                originalFinalId: bestFinal?.id ?? prev.originalFinalId,
              }));
              if (pollFinalRef.current) clearInterval(pollFinalRef.current);
              pollFinalRef.current = null;
              setGeneratingFinal(false);
              if (bestFinal?.id && state.videoJobId) {
                try {
                  await workbenchFetch(`/api/video/draft/${state.videoJobId}/select/${bestFinal.id}`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
                  });
                } catch {}
              }
            }
          }
        } catch {}
      }, 8000);
    } catch {
      setGeneratingFinal(false);
    }
  };

  const handleGenerateMultiAspect = useCallback(async () => {
    if (!state.videoJobId) return;
    const baseDraftId = state.composedFinalId || state.originalFinalId;
    if (!baseDraftId) {
      alert("请先选择一个可用终稿");
      return;
    }
    const selectedRatiosRaw = ((state.motionConfig?.multiAspectRatios as string[]) ?? []).filter(Boolean);
    const selectedRatios = selectedRatiosRaw.length ? selectedRatiosRaw : [...DEFAULT_MULTI_ASPECT_RATIOS];
    if (!selectedRatios.length) return;

    setMultiAspectGenerating(true);
    setMultiAspectVariants(selectedRatios.map((ratio) => ({ ratio, status: "pending" })));
    try {
      const response = await workbenchFetch(`/api/video/jobs/${state.videoJobId}/smart-crop-export`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
        },
        body: JSON.stringify({
          draft_id: baseDraftId,
          ratios: selectedRatios,
          focus_mode: "auto",
        }),
      });
      const data = await response.json();
      if (data?.code !== 0) {
        throw new Error(data?.msg || data?.detail || "multi-aspect smart crop failed");
      }
      const map = new Map(
        (data.data?.items ?? []).map((item: any) => [
          String(item.ratio),
          {
            status: item.status === "done" ? "done" : "failed",
            videoUrl: normalizeUrl(item.video_url),
          },
        ]),
      );
      setMultiAspectVariants((prev) =>
        prev.map((item) => {
          const result = map.get(item.ratio);
          if (!result) return { ...item, status: "failed" };
          return { ...item, status: result.status, videoUrl: result.videoUrl };
        }),
      );
    } catch (error) {
      console.warn("[multi-aspect] smart crop failed:", error);
      setMultiAspectVariants((prev) => prev.map((item) => ({ ...item, status: "failed" })));
    } finally {
      setMultiAspectGenerating(false);
    }
  }, [state]);

  const handleGenerateStoryboard = useCallback(
    async (trigger: "manual" | "auto" = "manual") => {
      if (storyboardGenerating) return;
      const baseFinalId = state.composedFinalId || state.originalFinalId;
      const selectedVideo =
        composedVideos.find((final) => final.id === state.composedFinalId) ||
        state.finalVideos.find((final) => final.id === state.originalFinalId);
      const finalVideoUrl = normalizeUrl(selectedVideo?.video_url);
      if (!baseFinalId || !finalVideoUrl) {
        alert("请先生成终稿视频");
        return;
      }
      const generatedFinalIds = normalizeStringArray(state.motionConfig?.storyboardGeneratedFinalIds);
      if (trigger === "auto" && generatedFinalIds.includes(baseFinalId)) {
        const skipMessage = "当前终稿已生成过分镜，已跳过自动触发";
        setStoryboardNotice(skipMessage);
        showStoryboardToast(skipMessage, "warning");
        return;
      }
      const referenceImageUrl = toAbsoluteUrl(
        normalizeVideoMediaUrl(state.firstFrame?.url) || (state.motionConfig?.autoCoverUrl as string) || "",
      );
      if (!referenceImageUrl) {
        alert("请先提供可用的参考图（首帧或自动封面）");
        return;
      }

      const storyboardCount = Math.max(
        4,
        Math.min(16, Number((state.motionConfig?.storyboardCount as number) || DEFAULT_STORYBOARD_COUNT)),
      );
      const storyboardStyleOptions = normalizeStoryboardStyleOptions(state.motionConfig?.storyboardStyleOptions);
      const storyboardStyleKey =
        ((state.motionConfig?.storyboardStyle as string) || DEFAULT_STORYBOARD_STYLE).trim() || DEFAULT_STORYBOARD_STYLE;
      const styleOption = findStoryboardStyleOption(storyboardStyleOptions, storyboardStyleKey);
      const customPrompt = ((state.motionConfig?.storyboardPrompt as string) || "").trim();
      const storyboardPrompt = customPrompt
        ? `${customPrompt}\n补充要求：生成 ${storyboardCount} 张关键分镜，风格为${styleOption.promptHint}。`
        : buildAutoStoryboardPrompt(state, storyboardCount, styleOption.promptHint);
      const storyboardResolution = Number((state.motionConfig?.storyboardResolution as number) || 1024);
      const storyboardTriggeredAt = new Date().toISOString();
      const storyboardActor = resolveStoryboardActorName();
      let pendingForLog: VideoWorkflowState | null = null;

      setStoryboardGenerating(true);
      setStoryboardError(null);
      setStoryboardUndoSnapshot(null);
      const startMessage = trigger === "auto" ? "归档后已自动启动关键分镜生成" : "已启动关键分镜生成";
      setStoryboardNotice(startMessage);
      showStoryboardToast(startMessage, "info");
      try {
        const submitResponse = await fetch("/api/gateway/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            templateId: "lu-storyboard",
            workflowId: "lu-storyboard",
            skuId: "RH_STORYBOARD",
            providerCode: "RUNNINGHUB_STORYBOARD",
            nodeInputs: {
              "74": { image: referenceImageUrl },
              "103": { text: storyboardPrompt },
              "104": { value: storyboardResolution },
            },
          }),
        });
        const submitData = await submitResponse.json().catch(() => ({}));
        if (
          !submitResponse.ok ||
          !submitData ||
          submitData.ok !== true ||
          typeof submitData.taskId !== "string" ||
          !submitData.taskId.trim()
        ) {
          throw new Error(
            submitData?.error || submitData?.message || `关键分镜任务提交失败（HTTP ${submitResponse.status}）`,
          );
        }
        const storyboardTaskId = submitData.taskId.trim();
        const pendingState: VideoWorkflowState = {
          ...state,
          motionConfig: {
            ...state.motionConfig,
            storyboardPrompt,
            storyboardTaskId,
            storyboardCount,
            storyboardStyle: storyboardStyleKey,
            storyboardStyleOptions,
            storyboardSourceFinalId: baseFinalId,
            storyboardLastTriggerSource: trigger,
            storyboardLastTriggeredAt: storyboardTriggeredAt,
          },
        };
        pendingForLog = pendingState;
        setState(pendingState);
        void save(pendingState);

        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        let storyboardUrls: string[] = [];
        for (let i = 0; i < STORYBOARD_MAX_POLLS; i += 1) {
          if (i > 0) await wait(STORYBOARD_POLL_INTERVAL_MS);
          const pollResponse = await fetch(
            `/api/gateway/task/${encodeURIComponent(storyboardTaskId)}?providerCode=RUNNINGHUB_STORYBOARD`,
            {
              method: "GET",
              headers: { Accept: "application/json" },
              credentials: "same-origin",
              cache: "no-store",
            },
          );
          if (pollResponse.status === 503) continue;
          const pollData = await pollResponse.json().catch(() => ({}));
          const pollStatus = String(pollData?.status || "").toLowerCase();
          if (pollStatus === "loading") continue;
          if (pollStatus === "failure") {
            throw new Error(pollData?.error || "关键分镜生成失败");
          }
          if (pollStatus === "success") {
            storyboardUrls = parseStoryboardUrls(pollData);
            if (!storyboardUrls.length) {
              throw new Error("关键分镜已完成，但未解析到可用图片");
            }
            break;
          }
        }

        if (!storyboardUrls.length) {
          throw new Error("关键分镜生成超时，请稍后重试");
        }
        const doneState: VideoWorkflowState = {
          ...pendingState,
          motionConfig: {
            ...pendingState.motionConfig,
            storyboardImageUrls: storyboardUrls,
            storyboardGeneratedFinalIds: [...new Set([...generatedFinalIds, baseFinalId])],
          },
        };
        const loggedState = appendStoryboardOperationLog(doneState, {
          actor: storyboardActor,
          triggerSource: trigger,
          triggeredAt: storyboardTriggeredAt,
          finalDraftId: baseFinalId,
          resultCount: storyboardUrls.length,
          status: "success",
        });
        setState(loggedState);
        const saved = await save(loggedState);
        setState(saved);
        const successMessage = `关键分镜生成完成，共 ${storyboardUrls.length} 张`;
        setStoryboardNotice(successMessage);
        showStoryboardToast(successMessage, "success");
      } catch (error) {
        console.error("[storyboard] generate failed:", error);
        const message = error instanceof Error ? error.message : "关键分镜生成失败，请稍后重试";
        const failedBase =
          pendingForLog ??
          ({
            ...state,
            motionConfig: {
              ...state.motionConfig,
              storyboardLastTriggerSource: trigger,
              storyboardLastTriggeredAt: storyboardTriggeredAt,
            },
          } as VideoWorkflowState);
        const failedState = appendStoryboardOperationLog(failedBase, {
          actor: storyboardActor,
          triggerSource: trigger,
          triggeredAt: storyboardTriggeredAt,
          finalDraftId: baseFinalId,
          resultCount: 0,
          status: "failed",
        });
        setState(failedState);
        void save(failedState);
        setStoryboardError(message);
        setStoryboardNotice(message);
        showStoryboardToast(`关键分镜生成失败：${message}`, "error");
      } finally {
        setStoryboardGenerating(false);
      }
    },
    [
      appendStoryboardOperationLog,
      composedVideos,
      save,
      showStoryboardToast,
      state,
      storyboardGenerating,
    ],
  );

  const handleResetStoryboardConfig = useCallback(() => {
    const nextState: VideoWorkflowState = {
      ...state,
      motionConfig: {
        ...state.motionConfig,
        storyboardCount: DEFAULT_STORYBOARD_COUNT,
        storyboardStyle: DEFAULT_STORYBOARD_STYLE,
      },
    };
    setState(nextState);
    void save(nextState);
    const message = "分镜配置已恢复默认";
    setStoryboardNotice(message);
    showStoryboardToast(message, "info");
  }, [save, showStoryboardToast, state]);

  const handleClearStoryboard = useCallback(() => {
    const currentImages = normalizeStringArray(state.motionConfig?.storyboardImageUrls);
    if (!currentImages.length) {
      const message = "当前没有可清空的分镜结果";
      setStoryboardNotice(message);
      showStoryboardToast(message, "warning");
      return;
    }
    setStoryboardUndoSnapshot(currentImages);
    const nextState: VideoWorkflowState = {
      ...state,
      motionConfig: {
        ...state.motionConfig,
        storyboardImageUrls: [],
        storyboardTaskId: "",
        storyboardSourceFinalId: "",
      },
    };
    setState(nextState);
    void save(nextState);
    setStoryboardError(null);
    const message = "已清空本次分镜结果，可撤销一次";
    setStoryboardNotice(message);
    showStoryboardToast(message, "info");
  }, [save, showStoryboardToast, state]);

  const handleUndoClearStoryboard = useCallback(() => {
    if (!storyboardUndoSnapshot || !storyboardUndoSnapshot.length) {
      const message = "没有可撤销的清空操作";
      setStoryboardNotice(message);
      showStoryboardToast(message, "warning");
      return;
    }
    const nextState: VideoWorkflowState = {
      ...state,
      motionConfig: {
        ...state.motionConfig,
        storyboardImageUrls: storyboardUndoSnapshot,
      },
    };
    setState(nextState);
    void save(nextState);
    setStoryboardUndoSnapshot(null);
    const message = "已撤销清空，分镜结果已恢复";
    setStoryboardNotice(message);
    showStoryboardToast(message, "success");
  }, [save, showStoryboardToast, state, storyboardUndoSnapshot]);

  const handleSelectFinal = async (finalId: string) => {
    const next = { ...state, selectedFinalId: finalId, originalFinalId: finalId, composedFinalId: undefined };
    setState(next);
    if (state.videoJobId) {
      try {
        await workbenchFetch(`/api/video/draft/${state.videoJobId}/select/${finalId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("workbench_token")}` },
        });
      } catch (error) {
        console.warn("select final failed:", error);
      }
    }
    void save(next);
  };

  const handleComposeAll = async () => {
    const originalDraft = state.finalVideos.find((final) => final.id === state.originalFinalId);
    const postConfig = normalizePostConfig(state.postConfig ?? DEFAULT_POST_CONFIG);
    const fx = {
      camera: (state.motionConfig?.fxCamera as string) || "",
      text: (state.motionConfig?.fxText as string) || "",
      cta: (state.motionConfig?.fxCta as string) || "",
      global: (state.motionConfig?.fxGlobal as string) || "",
    };
    if (!originalDraft || !state.videoJobId) return;
    if (!originalDraft.video_url) {
      alert("所选视频尚未生成完成，无法合成");
      return;
    }
    const hasAnyLayer = postConfig.logo.enabled || postConfig.subtitle.enabled || postConfig.cta.enabled;
    const hasAnyFx = Boolean(fx.camera || fx.text || fx.cta || fx.global);
    if (!hasAnyLayer && !hasAnyFx) return;

    setComposingLogo(true);
    try {
      const body: Record<string, unknown> = { draft_id: originalDraft.id };

      if (postConfig.logo.enabled && postConfig.logo.url) {
        body.logo = {
          url: toBackendStaticPath(postConfig.logo.url),
          x: postConfig.logo.x,
          y: postConfig.logo.y,
          size: postConfig.logo.size,
        };
      }
      if (postConfig.subtitle.enabled && postConfig.subtitle.text) {
        body.subtitle = {
          text: postConfig.subtitle.text,
          position: postConfig.subtitle.position,
          font_size: postConfig.subtitle.fontSize,
          style_template: postConfig.subtitle.styleTemplate ?? "social_pop",
          max_chars_per_line: postConfig.subtitle.maxCharsPerLine ?? 14,
          lines:
            Array.isArray(postConfig.subtitle.lines) && postConfig.subtitle.lines.length
              ? postConfig.subtitle.lines
              : undefined,
          segments:
            Array.isArray(postConfig.subtitle.segments) && postConfig.subtitle.segments.length
              ? postConfig.subtitle.segments
              : undefined,
        };
      }
      if (postConfig.cta.enabled && postConfig.cta.text) {
        body.cta = {
          text: postConfig.cta.text,
          position: postConfig.cta.position,
        };
      }
      if (hasAnyFx) {
        body.fx = fx;
      }

      const response = await workbenchFetch(`/api/video/jobs/${state.videoJobId}/compose-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data?.code !== 0) {
        alert(data?.msg || data?.detail || t("效果合成失败，请稍后重试"));
        return;
      }
      if (data?.code === 0 && data.data?.composed_url && data.data?.new_draft_id) {
        const composedUrl = data.data.composed_url.startsWith("http")
          ? data.data.composed_url
          : `${"/api/workbench"}${data.data.composed_url}`;
        const newDraft = {
          id: data.data.new_draft_id,
          model: originalDraft.model,
          video_url: composedUrl,
          thumbnail_url: normalizeVideoMediaUrl(originalDraft.thumbnail_url),
          duration_seconds: originalDraft.duration_seconds,
          status: "done",
          selected: true,
          operation: "compose_all",
          generation_cost: 0,
        } as VideoDraftItem;
        setComposedVideos((prev) => [...prev.filter((final) => final.id !== newDraft.id), newDraft]);
        const nextState = {
          ...state,
          composedFinalId: data.data.new_draft_id,
        };
        setState(nextState);
        await save(nextState);
        alert(t("Logo 合成成功"));
      }
    } catch (error) {
      console.error("compose-all failed:", error);
      alert(t("效果合成失败，请稍后重试"));
    } finally {
      setComposingLogo(false);
    }
  };

  const canGoNext = canAdvanceFrom(state.currentStep, state);

  return (
    <>
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">{t("视频工作台")}</h1>
          <div className="flex items-center gap-3">
            {saving && <span className="text-xs text-gray-400">{t("保存中...")}</span>}
            {saveError && <span className="text-xs text-red-400">{t("保存失败")}</span>}
            {!saving && !saveError && state.lastSavedAt && (
              <span className="text-xs text-gray-400">{t("已保存")}</span>
            )}
            <button
              onClick={() => save(state)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              {t("手动保存")}
            </button>
          </div>
        </div>

        <StepNav current={state.currentStep} labels={stepLabels} />

        <div className="min-h-[360px] rounded-2xl border border-gray-100 bg-white p-6">
          {state.currentStep === 1 && (
            <div>
              <h2 className="mb-1 text-base font-semibold text-gray-900">{t("首帧选择")}</h2>
              <p className="mb-6 text-sm text-gray-500">{t("首帧说明")}</p>

              <div className="mb-5">
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  {t("任务名称")}
                  <span className="ml-1 text-gray-400 font-normal">({t("选填")})</span>
                </label>
                <input
                  type="text"
                  value={state.notes ?? ""}
                  onChange={(event) => setState((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder={t("给这条视频任务起个名字...")}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                  maxLength={100}
                />
              </div>

              {state.firstFrameStatus === "selected" && state.firstFrame && (
                <div className="mb-6 flex items-center gap-4 rounded-xl border border-green-200 bg-green-50 p-4">
                  <img
                    src={normalizeVideoMediaUrl(state.firstFrame.url)}
                    alt="first frame"
                    className="h-20 w-20 rounded-lg border border-green-200 object-cover"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-green-700">{t("首帧已选定")}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      {t("来源")}: {state.firstFrame.source_type}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setState((prev) => ({ ...prev, firstFrameStatus: "empty", firstFrame: undefined }))
                    }
                    className="text-xs text-gray-400 hover:text-red-500"
                  >
                    {t("重新选择")}
                  </button>
                </div>
              )}

              {state.firstFrameStatus === "awaiting_make" && (
                <div className="mb-6 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="animate-spin text-lg text-blue-500">⏳</div>
                  <div>
                    <div className="text-sm font-medium text-blue-700">{t("等待首帧制作完成")}</div>
                    <div className="mt-0.5 text-xs text-gray-500">{t("自动检测中，每5秒轮询一次")}</div>
                  </div>
                </div>
              )}

              {state.firstFrameStatus === "empty" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <button
                    onClick={handleSelectFromLibrary}
                    className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 transition-all hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span className="text-3xl">🖼</span>
                    <span className="text-sm font-medium text-gray-700">{t("从库中选择")}</span>
                    <span className="text-center text-xs text-gray-400">{t("成品图库 / 素材库 / 截帧库")}</span>
                  </button>

                  <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 transition-all hover:border-blue-300 hover:bg-blue-50">
                    <span className="text-3xl">⬆</span>
                    <span className="text-sm font-medium text-gray-700">{t("上传图片")}</span>
                    <span className="text-center text-xs text-gray-400">{t("上传后自动入库")}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleUpload}
                      disabled={false}
                    />
                  </label>

                  <button
                    onClick={handleAwaitingMake}
                    className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 p-6 transition-all hover:border-blue-300 hover:bg-blue-50"
                  >
                    <span className="text-3xl">✦</span>
                    <span className="text-sm font-medium text-gray-700">{t("去制作首帧")}</span>
                    <span className="text-center text-xs text-gray-400">{t("跳转图片工作台")}</span>
                  </button>
                </div>
              )}

              {state.firstFrameStatus === "uploading" && (
                <div className="flex items-center justify-center gap-2 py-12 text-gray-400">
                  <span className="animate-spin">⏳</span>
                  <span className="text-sm">{t("上传中...")}</span>
                </div>
              )}
            </div>
          )}

          {state.currentStep === 2 && (
            <DraftExplorer
              firstFrameUrl={normalizeVideoMediaUrl(state.firstFrame?.url)}
              emotion={state.draftEmotion}
              prompt={state.draftPrompt}
              aspectRatio={(state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO}
              modelConfigId={state.motionConfig?.modelConfigId as number}
              draftCount={(state.motionConfig?.draftCount as number) ?? 5}
              duration={(state.motionConfig?.draftDuration as number) ?? 5}
              sound={(state.motionConfig?.sound as boolean) ?? false}
              availableModels={videoModels}
              emotionOptions={emotionOptions}
              drafts={state.drafts}
              selectedDraftId={state.selectedDraftId}
              generating={generating}
              onModelChange={(id) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, modelConfigId: id },
                }))
              }
              onDraftCountChange={(count) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, draftCount: count },
                }))
              }
              onDurationChange={(duration) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, draftDuration: duration },
                }))
              }
              onEmotionChange={(value) => setState((prev) => ({ ...prev, draftEmotion: value }))}
              onCreateEmotion={(labelZh, value) => createVideoEnum("emotion", labelZh, value)}
              onPromptChange={(value) => setState((prev) => ({ ...prev, draftPrompt: value }))}
              onAspectRatioChange={handleAspectRatioChange}
              onSoundChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, sound: value },
                }))
              }
              batchEnabled={(state.motionConfig?.batchEnabled as boolean) ?? false}
              batchVariablesText={(state.motionConfig?.batchVariablesText as string) ?? ""}
              batchPerVariableCount={(state.motionConfig?.batchPerVariableCount as number) ?? 1}
              characterLockEnabled={(state.motionConfig?.consistencyLockEnabled as boolean) ?? true}
              characterLockPrompt={
                (state.motionConfig?.consistencyLockPrompt as string) ?? DEFAULT_CHARACTER_LOCK_PROMPT
              }
              autoQualityEnabled={(state.motionConfig?.autoQualityEnabled as boolean) ?? true}
              qualityThreshold={(state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD}
              showOnlyLowScore={(state.motionConfig?.draftShowOnlyLowScore as boolean) ?? false}
              onBatchEnabledChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, batchEnabled: value },
                }))
              }
              onBatchVariablesTextChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, batchVariablesText: value },
                }))
              }
              onBatchPerVariableCountChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, batchPerVariableCount: value },
                }))
              }
              onCharacterLockEnabledChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, consistencyLockEnabled: value },
                }))
              }
              onCharacterLockPromptChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, consistencyLockPrompt: value },
                }))
              }
              onAutoQualityEnabledChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, autoQualityEnabled: value },
                }))
              }
              onQualityThresholdChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, qualityThreshold: value },
                }))
              }
              onShowOnlyLowScoreChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    draftShowOnlyLowScore: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onGenerate={handleGenerate}
              onSelectDraft={handleSelectDraft}
            />
          )}

          {state.currentStep === 3 && (
            <MotionExtractor
              draftVideoUrl={state.drafts.find((draft) => draft.id === state.selectedDraftId)?.video_url}
              firstFrameUrl={normalizeVideoMediaUrl(state.firstFrame?.url)}
              duration={state.drafts.find((draft) => draft.id === state.selectedDraftId)?.duration_seconds ?? 5}
              motionData={state.motionData}
              jobId={state.videoJobId}
              modelConfigId={analysisModelId}
              actionOptions={actionOptions}
              onCreateAction={(labelZh, value) => createVideoEnum("action", labelZh, value)}
              onSave={async (data) => {
                const next = { ...state, motionData: data };
                setState((prev) => ({ ...prev, motionData: data }));
                try {
                  await workbenchFetch(`/api/video/motion/${state.videoJobId}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
                    },
                    body: JSON.stringify({
                      raw_keypoints: data.raw_keypoints,
                      camera: "",
                      emotion: state.draftEmotion || "",
                      scene: "",
                    }),
                  });
                } catch (error) {
                  console.warn("motion save failed:", error);
                }
                void save(next);
              }}
            />
          )}

          {state.currentStep === 4 && (
            <>
              {presetOrder[0] && (
                <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-3">
                  <div className="text-xs font-medium text-blue-700">
                    效果回流推荐：优先尝试
                    {" "}
                    {MOTION_FX_PRESETS.find((preset) => preset.id === presetOrder[0])?.nameZh ?? presetOrder[0]}
                  </div>
                  {presetStats[presetOrder[0]]?.samples ? (
                    <div className="mt-1 text-xs text-blue-600">
                      历史命中率 {presetStats[presetOrder[0]].winRate}%（样本 {presetStats[presetOrder[0]].samples}）
                    </div>
                  ) : null}
                </div>
              )}
              <MotionFXConfig
                presetId={state.motionConfig?.fxPresetId as string}
                camera={state.motionConfig?.fxCamera as string}
                textFx={state.motionConfig?.fxText as string}
                cta={state.motionConfig?.fxCta as string}
                global={state.motionConfig?.fxGlobal as string}
                presetOrder={presetOrder}
                presetStats={presetStats}
                onPresetSelect={(preset) => {
                  setState((prev) => ({
                    ...prev,
                    motionConfig: {
                      ...prev.motionConfig,
                      fxPresetId: preset.id,
                      fxCamera: preset.camera,
                      fxText: preset.text,
                      fxCta: preset.cta,
                      fxGlobal: preset.global ?? "",
                    },
                  }));
                }}
                onParamChange={(key, value) => {
                  setState((prev) => ({
                    ...prev,
                    motionConfig: {
                      ...prev.motionConfig,
                      [`fx${key.charAt(0).toUpperCase() + key.slice(1)}`]: value,
                    },
                  }));
                }}
              />
            </>
          )}

          {state.currentStep === 5 && (
            <FinalGenerator
              firstFrameUrl={normalizeVideoMediaUrl(state.firstFrame?.url)}
              motionPrompt={`${state.draftEmotion ? `${state.draftEmotion} · ` : ""}${state.draftPrompt || ""}`}
              aspectRatio={(state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO}
              finals={state.finalVideos}
              selectedFinalId={state.selectedFinalId}
              generating={generatingFinal}
              availableModels={finalModels}
              modelConfigId={state.motionConfig?.finalModelConfigId as number}
              duration={(state.motionConfig?.draftDuration as number) ?? 5}
              sound={(state.motionConfig?.sound as boolean) ?? false}
              qualityThreshold={(state.motionConfig?.qualityThreshold as number) ?? DEFAULT_QUALITY_THRESHOLD}
              autoQualityEnabled={(state.motionConfig?.autoQualityEnabled as boolean) ?? true}
              showOnlyLowScore={(state.motionConfig?.finalShowOnlyLowScore as boolean) ?? false}
              onModelChange={(id) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, finalModelConfigId: id },
                }))
              }
              onAspectRatioChange={handleAspectRatioChange}
              onSoundChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, sound: value },
                }))
              }
              onShowOnlyLowScoreChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    finalShowOnlyLowScore: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onGenerate={handleGenerateFinal}
              onSelectFinal={handleSelectFinal}
            />
          )}

          {state.currentStep === 6 && (
            <>
              <div className="mb-4 rounded-xl border border-gray-200 p-4">
                <div className="mb-3 text-sm font-medium text-gray-700">自动后处理（P1）</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <button
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        motionConfig: {
                          ...prev.motionConfig,
                          autoSubtitleEnabled: !((prev.motionConfig?.autoSubtitleEnabled as boolean) ?? true),
                        },
                      }))
                    }
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      (state.motionConfig?.autoSubtitleEnabled as boolean) ?? true
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    自动字幕：{((state.motionConfig?.autoSubtitleEnabled as boolean) ?? true) ? "开" : "关"}
                  </button>
                  <button
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        motionConfig: {
                          ...prev.motionConfig,
                          autoBgmEnabled: !((prev.motionConfig?.autoBgmEnabled as boolean) ?? false),
                        },
                      }))
                    }
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      (state.motionConfig?.autoBgmEnabled as boolean) ?? false
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    自动 BGM：{((state.motionConfig?.autoBgmEnabled as boolean) ?? false) ? "开" : "关"}
                  </button>
                  <button
                    onClick={() =>
                      setState((prev) => ({
                        ...prev,
                        motionConfig: {
                          ...prev.motionConfig,
                          autoCoverEnabled: !((prev.motionConfig?.autoCoverEnabled as boolean) ?? true),
                        },
                      }))
                    }
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      (state.motionConfig?.autoCoverEnabled as boolean) ?? true
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    自动封面：{((state.motionConfig?.autoCoverEnabled as boolean) ?? true) ? "开" : "关"}
                  </button>
                </div>
                <button
                  onClick={() => {
                    void handleAutoPostGenerate();
                  }}
                  className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                >
                  一键生成自动字幕/BGM/封面
                </button>
                {autoPostNotice ? <div className="mt-2 text-xs text-blue-600">{autoPostNotice}</div> : null}
              </div>
              <PostProcessor
                config={normalizePostConfig(state.postConfig ?? DEFAULT_POST_CONFIG)}
                finalVideoUrl={(() => {
                  const originalVideo = state.finalVideos.find((final) => final.id === state.originalFinalId);
                  const url = originalVideo?.video_url;
                  return normalizeUrl(url);
                })()}
                composing={composingLogo}
                onChange={(config) => setState((prev) => ({ ...prev, postConfig: config }))}
                onLogoSelect={(url, assetId) => {
                  setState((prev) => ({
                    ...prev,
                    postConfig: (() => {
                      const prevConfig = normalizePostConfig(prev.postConfig ?? DEFAULT_POST_CONFIG);
                      return {
                        ...prevConfig,
                        logo: {
                          ...prevConfig.logo,
                          enabled: true,
                          url,
                          assetId,
                        },
                      };
                    })(),
                  }));
                }}
              />
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="mb-3 text-sm font-medium text-gray-700">
                  {lang === "zh" ? "动效预设" : "Motion FX"}
                </p>
                <MotionFXConfig
                  compact={true}
                  presetId={state.motionConfig?.fxPresetId as string}
                  camera={state.motionConfig?.fxCamera as string}
                  textFx={state.motionConfig?.fxText as string}
                  cta={state.motionConfig?.fxCta as string}
                  global={state.motionConfig?.fxGlobal as string}
                  presetOrder={presetOrder}
                  presetStats={presetStats}
                  onPresetSelect={(preset) => {
                    setState((prev) => ({
                      ...prev,
                      motionConfig: {
                        ...prev.motionConfig,
                        fxPresetId: preset.id,
                        fxCamera: preset.camera,
                        fxText: preset.text,
                        fxCta: preset.cta,
                        fxGlobal: preset.global ?? "",
                      },
                    }));
                  }}
                  onParamChange={(key, value) => {
                    setState((prev) => ({
                      ...prev,
                      motionConfig: {
                        ...prev.motionConfig,
                        [`fx${key.charAt(0).toUpperCase() + key.slice(1)}`]: value,
                      },
                    }));
                  }}
                />
              </div>
              <button
                onClick={handleComposeAll}
                disabled={composingLogo}
                className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {composingLogo
                  ? lang === "zh"
                    ? "合成中..."
                    : "Composing..."
                  : lang === "zh"
                    ? "⚙ 合成全部效果"
                    : "⚙ Compose All Effects"}
              </button>
            </>
          )}

          {state.currentStep === 7 && (
            <ExportArchiver
              jobId={state.videoJobId}
              finalDraftId={state.composedFinalId || state.originalFinalId}
              finalVideoUrl={(() => {
                const composedVideo = composedVideos.find((final) => final.id === state.composedFinalId);
                const originalVideo = state.finalVideos.find((final) => final.id === state.originalFinalId);
                const url = composedVideo?.video_url || originalVideo?.video_url;
                return normalizeUrl(url);
              })()}
              firstFrameUrl={normalizeVideoMediaUrl(state.firstFrame?.url)}
              taskName={state.notes}
              aspectRatio={(state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO}
              duration={(state.motionConfig?.draftDuration as number) ?? 5}
              coverUrl={(state.motionConfig?.autoCoverUrl as string) || normalizeVideoMediaUrl(state.firstFrame?.url)}
              storyboardPrompt={(state.motionConfig?.storyboardPrompt as string) ?? ""}
              storyboardImages={normalizeStringArray(state.motionConfig?.storyboardImageUrls)}
              storyboardNotice={storyboardNotice ?? undefined}
              generatingStoryboard={storyboardGenerating}
              storyboardError={storyboardError ?? undefined}
              storyboardLastTriggerSource={
                ((state.motionConfig?.storyboardLastTriggerSource as string) || "") === "auto" ? "auto" : "manual"
              }
              storyboardLastTriggeredAt={(state.motionConfig?.storyboardLastTriggeredAt as string) ?? ""}
              storyboardOperationLogs={normalizeStoryboardOperationLogs(state.motionConfig?.storyboardOperationLogs)}
              storyboardLogFilter={
                (((state.motionConfig?.storyboardLogFilter as string) || "") === "auto"
                  ? "auto"
                  : ((state.motionConfig?.storyboardLogFilter as string) || "") === "manual"
                    ? "manual"
                    : "all") as "all" | "auto" | "manual"
              }
              storyboardLogLimit={
                [10, 20, 50].includes(Number(state.motionConfig?.storyboardLogLimit))
                  ? Number(state.motionConfig?.storyboardLogLimit)
                  : 10
              }
              storyboardLogFinalIdKeyword={(state.motionConfig?.storyboardLogFinalIdKeyword as string) ?? ""}
              storyboardCsvExportMode={
                ((state.motionConfig?.storyboardCsvExportMode as string) || "") === "all" ? "all" : "filtered"
              }
              storyboardCount={Math.max(
                4,
                Math.min(16, Number((state.motionConfig?.storyboardCount as number) || DEFAULT_STORYBOARD_COUNT)),
              )}
              storyboardStyle={((state.motionConfig?.storyboardStyle as string) || DEFAULT_STORYBOARD_STYLE).trim()}
              storyboardStyleOptions={normalizeStoryboardStyleOptions(state.motionConfig?.storyboardStyleOptions)}
              autoStoryboardAfterArchive={(state.motionConfig?.autoStoryboardAfterArchive as boolean) ?? true}
              onStoryboardPromptChange={(value) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: {
                    ...prev.motionConfig,
                    storyboardPrompt: value,
                  },
                }))
              }
              onStoryboardCountChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardCount: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onStoryboardStyleChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardStyle: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onStoryboardLogFilterChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardLogFilter: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onStoryboardLogLimitChange={(value) => {
                const safeLimit = [10, 20, 50].includes(value) ? value : 10;
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardLogLimit: safeLimit,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onStoryboardLogFinalIdKeywordChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardLogFinalIdKeyword: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onStoryboardCsvExportModeChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    storyboardCsvExportMode: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onAutoStoryboardAfterArchiveChange={(value) => {
                const nextState: VideoWorkflowState = {
                  ...state,
                  motionConfig: {
                    ...state.motionConfig,
                    autoStoryboardAfterArchive: value,
                  },
                };
                setState(nextState);
                void save(nextState);
              }}
              onGenerateStoryboard={() => {
                void handleGenerateStoryboard();
              }}
              onResetStoryboardConfig={handleResetStoryboardConfig}
              onClearStoryboard={handleClearStoryboard}
              onUndoClearStoryboard={handleUndoClearStoryboard}
              canUndoStoryboardClear={Boolean(storyboardUndoSnapshot?.length)}
              multiAspectRatios={
                ((state.motionConfig?.multiAspectRatios as string[]) ?? [...DEFAULT_MULTI_ASPECT_RATIOS]).filter(
                  Boolean,
                )
              }
              onMultiAspectRatiosChange={(ratios) =>
                setState((prev) => ({
                  ...prev,
                  motionConfig: { ...prev.motionConfig, multiAspectRatios: ratios },
                }))
              }
              onGenerateMultiAspect={handleGenerateMultiAspect}
              generatingMultiAspect={multiAspectGenerating}
              multiAspectVariants={multiAspectVariants}
              onFeedback={handleRecordPresetFeedback}
              archiving={archiving}
              archived={archived}
              onArchive={async () => {
                setArchiving(true);
                try {
                  const finalVideo =
                    composedVideos.find((final) => final.id === state.composedFinalId) ||
                    state.finalVideos.find((final) => final.id === state.originalFinalId);
                  if (finalVideo?.video_url && state.videoJobId) {
                    await workbenchFetch(`/api/video/jobs/${state.videoJobId}/status`, {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
                      },
                      body: JSON.stringify({
                        status: "completed",
                        export_url: finalVideo.video_url,
                      }),
                    });
                  }
                  setArchived(true);
                  const next = { ...state, exportUrl: finalVideo?.video_url };
                  setState(next);
                  void save(next);
                  const presetId = (state.motionConfig?.fxPresetId as string) || "custom";
                  if (finalVideo?.qualityScore) {
                    const rating = finalVideo.qualityScore >= DEFAULT_QUALITY_THRESHOLD ? "good" : "bad";
                    recordPresetFeedback(presetId, rating, finalVideo.qualityScore);
                    refreshPresetFeedback();
                  }
                  if (((state.motionConfig?.autoStoryboardAfterArchive as boolean) ?? true) && !storyboardGenerating) {
                    const currentFinalId = finalVideo?.id || state.composedFinalId || state.originalFinalId;
                    const generatedFinalIds = normalizeStringArray(state.motionConfig?.storyboardGeneratedFinalIds);
                    if (currentFinalId && generatedFinalIds.includes(currentFinalId)) {
                      const message = "当前终稿已生成过分镜，已跳过自动触发";
                      setStoryboardNotice(message);
                      showStoryboardToast(message, "warning");
                    } else {
                      void handleGenerateStoryboard("auto");
                    }
                  }
                } catch (error) {
                  console.error("archive failed:", error);
                } finally {
                  setArchiving(false);
                }
              }}
            />
          )}

          {state.currentStep > 7 && (
            <div className="flex h-64 items-center justify-center text-gray-400">
              <div className="text-center">
                <div className="mb-3 text-4xl">🚧</div>
                <div className="text-sm">
                  {t("步骤")} {state.currentStep} - {stepLabels[state.currentStep - 1]}
                </div>
                <div className="mt-1 text-xs text-gray-300">{t("开发中")}</div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={goPrev}
            disabled={state.currentStep === 1}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {t("上一步")}
          </button>
          {state.currentStep === 7 ? (
            <button
              onClick={async () => {
                if (!state.videoJobId) return;
                await workbenchFetch(`/api/video/jobs/${state.videoJobId}/status`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("workbench_token")}`,
                  },
                  body: JSON.stringify({ status: "completed" }),
                });
                window.location.href = "/workbench/gallery/video";
              }}
              disabled={saving}
              className="rounded-lg bg-green-600 px-6 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-30"
            >
              {lang === "zh" ? "完成归档" : "Archive"}
            </button>
          ) : (
            <button
              onClick={goNext}
              disabled={!canGoNext || saving}
              className="rounded-lg bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {saving ? t("保存中...") : t("下一步")}
            </button>
          )}
        </div>
      </div>
      {showPicker && (
        <FirstFramePicker token={token} onSelect={handlePickerSelect} onClose={() => setShowPicker(false)} />
      )}
      {storyboardToast && (
        <div className="pointer-events-none fixed top-5 right-5 z-[120] max-w-sm">
          <div
            className={`rounded-xl border px-4 py-3 text-sm shadow-lg ${
              storyboardToast.tone === "success"
                ? "border-green-200 bg-green-50 text-green-700"
                : storyboardToast.tone === "warning"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : storyboardToast.tone === "error"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-blue-200 bg-blue-50 text-blue-700"
            }`}
          >
            {storyboardToast.message}
          </div>
        </div>
      )}
    </>
  );
}

export default function VideoWorkflowPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Loading…</div>}>
      <VideoWorkflowInner />
    </Suspense>
  );
}
