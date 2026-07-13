"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import DraftExplorer from "@/components/video/DraftExplorer";
import ExportArchiver from "@/components/video/ExportArchiver";
import FinalGenerator from "@/components/video/FinalGenerator";
import FirstFramePicker, { type PickedFrame } from "@/components/video/FirstFramePicker";
import MotionExtractor from "@/components/video/MotionExtractor";
import MotionFXConfig from "@/components/video/MotionFXConfig";
import PostProcessor from "@/components/video/PostProcessor";
import { useLanguage } from "@/lib/LanguageContext";
import {
  DEFAULT_POST_CONFIG,
  normalizePostConfig,
  type VideoDraftItem,
  type VideoWorkflowState,
  autoSaveVideoSession,
  canAdvanceFrom,
  defaultVideoWorkflowState,
  restoreVideoSession,
} from "@/lib/video-workflow";

const STEP_COUNT = 7;
const DEFAULT_VIDEO_ASPECT_RATIO = "16:9";

interface VideoEnumOption {
  id?: number;
  enum_type?: string;
  value: string;
  label_zh: string;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("token") || "";
}

function normalizeUrl(url?: string): string | undefined {
  if (!url) return url;
  if (url.startsWith("/static/")) return `http://localhost:8000${url}`;
  return url;
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDraftRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollFinalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobCreatedRef = useRef(false);

  const stepLabels = [
    t("首帧选择"),
    t("草稿探索"),
    t("动作提炼"),
    t("动效配置"),
    t("精品生成"),
    t("后处理"),
    t("导出归档"),
  ];

  useEffect(() => {
    const sessionId = searchParams.get("session_id");
    const jobId = searchParams.get("job_id");

    async function bootstrapVideoWorkflow() {
      const loadMotionData = async (videoJobId: string) => {
        try {
          const motionResponse = await fetch(`/api/video/motion/${videoJobId}`, {
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
              const finalResponse = await fetch(`/api/video/draft/${restored.videoJobId}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const finalResult = await finalResponse.json();
              const allFinals: VideoDraftItem[] =
                finalResult?.code === 0
                  ? (finalResult.data?.drafts ?? []).map((draft: any) => ({
                      id: draft.id,
                      model: draft.model,
                      video_url: normalizeUrl(draft.video_url),
                      thumbnail_url: draft.thumbnail_url,
                      duration_seconds: draft.duration_seconds,
                      status: draft.status,
                      selected: draft.selected,
                      operation: draft.operation,
                      generation_cost: draft.generation_cost,
                    }))
                  : [];
              const { originals: finals, composed } = splitFinalVideos(allFinals);
              const selectedFinal =
                finals.find((final) => final.id === restored.originalFinalId) ??
                finals.find((final) => final.selected || final.status === "selected") ??
                finals.find((final) => final.status === "done");
              const response = await fetch(`/api/video/jobs/${restored.videoJobId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
              const finalResponse = await fetch(`/api/video/draft/${restored.videoJobId}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const finalResult = await finalResponse.json();
              if (finalResult?.code === 0) {
                const allFinals: VideoDraftItem[] = (finalResult.data?.drafts ?? []).map((draft: any) => ({
                  id: draft.id,
                  model: draft.model,
                  video_url: normalizeUrl(draft.video_url),
                  thumbnail_url: draft.thumbnail_url,
                  duration_seconds: draft.duration_seconds,
                  status: draft.status,
                  selected: draft.selected,
                  operation: draft.operation,
                  generation_cost: draft.generation_cost,
                }));
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
        const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
        fetch(`/api/video/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
              const draftsResponse = await fetch(`/api/video/draft/${job.id}/list?draft_type=draft`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
              });
              const finalsResponse = await fetch(`/api/video/draft/${job.id}/list?draft_type=final`, {
                headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
              });
              const draftsData = await draftsResponse.json();
              const finalsData = await finalsResponse.json();
              if (draftsData?.code === 0) {
                drafts = (draftsData.data?.drafts ?? []).map((draft: any) => ({
                  id: draft.id,
                  model: draft.model,
                  video_url: draft.video_url,
                  thumbnail_url: draft.thumbnail_url,
                  duration_seconds: draft.duration_seconds,
                  status: draft.status,
                  selected: draft.selected,
                  generation_cost: draft.generation_cost,
                }));
                const selectedDraft = drafts.find((draft) => draft.selected || draft.status === "selected");
                selectedDraftId = selectedDraft?.id;
              }
              if (finalsData?.code === 0) {
                const allFinals: VideoDraftItem[] = (finalsData.data?.drafts ?? []).map((draft: any) => ({
                  id: draft.id,
                  model: draft.model,
                  video_url: normalizeUrl(draft.video_url),
                  thumbnail_url: draft.thumbnail_url,
                  duration_seconds: draft.duration_seconds,
                  status: draft.status,
                  selected: draft.selected,
                  operation: draft.operation,
                  generation_cost: draft.generation_cost,
                }));
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
                  ? {
                      asset_id: job.first_frame_asset_id,
                      url: job.first_frame_url.startsWith("http")
                        ? job.first_frame_url
                        : `${API_BASE}${job.first_frame_url}`,
                      source_type: job.first_frame_source_type ?? "gallery",
                    }
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
          fetch("/api/video/jobs/create", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${localStorage.getItem("token")}`,
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
        const response = await fetch(`/api/video/first-frame/${state.videoJobId}/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        });
        const res = await response.json();
        if (res?.code === 0 && res.data.first_frame_status === "selected") {
          if (pollRef.current) clearInterval(pollRef.current);
          setState((prev) => ({
            ...prev,
            firstFrameStatus: "selected",
            firstFrame: {
              asset_id: res.data.first_frame_asset_id || 0,
              url: res.data.first_frame_url || "",
              source_type: "frame",
            },
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
    fetch(`/api/model-configs/video?usage=draft`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
    fetch(`/api/model-configs/video?usage=final`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
    fetch("/api/model-configs?purpose=video_analysis", {
      headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
      const response = await fetch(`/api/video/enums?type=${enumType}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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

  const createVideoEnum = async (enumType: "emotion" | "action", labelZh: string, value: string) => {
    const response = await fetch("/api/video/enums", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("token")}`,
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

  const goNext = async () => {
    if (!canAdvanceFrom(state.currentStep, state)) return;
    const next = Math.min(state.currentStep + 1, STEP_COUNT);
    const updated = { ...state, currentStep: next };
    if (state.videoJobId && state.notes) {
      try {
        await fetch(`/api/video/jobs/${state.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({ notes: state.notes }),
        });
      } catch {}
    }
    const saved = await save(updated);
    if (state.videoJobId) {
      try {
        await fetch(`/api/video/jobs/${state.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
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
      const res = await fetch(`/api/assets/upload`, {
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
          firstFrame: {
            asset_id: asset.id,
            url: asset.url,
            source_type: "upload",
          },
        };
        setState(nextState);
        if (state.videoJobId) {
          try {
            await fetch(`/api/video/first-frame/${state.videoJobId}/select`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("token")}`,
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
    window.open(`/workflows/expression?return_to=video${sessionParam}`, "_blank");
  };

  const handlePickerSelect = async (frame: PickedFrame) => {
    console.log("[handlePickerSelect] frame:", frame);
    const nextState: VideoWorkflowState = {
      ...state,
      firstFrameStatus: "selected",
      firstFrame: {
        asset_id: frame.asset_id,
        url: frame.url,
        source_type: frame.source_type,
      },
    };
    console.log("[handlePickerSelect] next.firstFrame:", nextState.firstFrame);
    setState(nextState);
    setShowPicker(false);
    const jobId = nextState.videoJobId ?? state.videoJobId;
    if (jobId) {
      try {
        await fetch(`/api/video/first-frame/${jobId}/select`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            asset_id: frame.asset_id,
            url: frame.url,
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
    console.log(
      "[handleGenerate] state:",
      JSON.stringify({
        videoJobId: state.videoJobId,
        firstFrame: state.firstFrame,
        firstFrameStatus: state.firstFrameStatus,
        modelConfigId: state.motionConfig?.modelConfigId,
      }),
    );
    if (!state.firstFrame?.url) {
      alert(t("请先在 Step 1 选择首帧"));
      return;
    }
    if (!state.videoJobId) {
      console.warn("[handleGenerate] no videoJobId");
      return;
    }
    const modelConfigId = state.motionConfig?.modelConfigId as number;
    if (!modelConfigId) {
      alert(t("请先选择生成模型"));
      return;
    }

    setGenerating(true);
    if (pollDraftRef.current) {
      clearInterval(pollDraftRef.current);
      pollDraftRef.current = null;
    }
    setState((prev) => ({ ...prev, drafts: [], selectedDraftId: undefined }));

    const token = localStorage.getItem("token") ?? "";
    const count = (state.motionConfig?.draftCount as number) ?? 5;
    const duration = (state.motionConfig?.draftDuration as number) ?? 5;
    const aspectRatio = (state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO;
    const sound = (state.motionConfig?.sound as boolean) ?? false;
    const generateStartTime = new Date().toISOString();
    const emotionText = state.draftEmotion ? `The character feels ${state.draftEmotion}, ` : "";
    const promptText = `${emotionText}${state.draftPrompt || "moving naturally"}`.trim();

    try {
      const response = await fetch(`/api/video/draft/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          job_id: state.videoJobId,
          model_config_id: modelConfigId,
          prompt: promptText,
          negative_prompt: "text, watermark, subtitle, caption, words, letters, typography, writing",
          aspect_ratio: aspectRatio,
          duration,
          count,
          sound,
          draft_type: "draft",
        }),
      });
      const data = await response.json();
      if (data?.code !== 0) {
        console.error("[handleGenerate] API error:", data);
        setGenerating(false);
        return;
      }

      if (pollDraftRef.current) clearInterval(pollDraftRef.current);
      pollDraftRef.current = setInterval(async () => {
        try {
          const pollResponse = await fetch(
            `/api/video/draft/${state.videoJobId}/list?draft_type=draft&since=${encodeURIComponent(generateStartTime)}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          const pollData = await pollResponse.json();
          if (pollData?.code === 0) {
            const drafts: VideoDraftItem[] = (pollData.data?.drafts ?? []).map((draft: any) => ({
              id: draft.id,
              model: draft.model,
              video_url: draft.video_url,
              thumbnail_url: draft.thumbnail_url ?? state.firstFrame?.url,
              duration_seconds: draft.duration_seconds,
              status: draft.status,
              selected: draft.selected,
              generation_cost: draft.generation_cost,
            }));
            setState((prev) => ({ ...prev, drafts }));
            if (pollData.data?.all_done) {
              if (pollDraftRef.current) clearInterval(pollDraftRef.current);
              pollDraftRef.current = null;
              setGenerating(false);
              const allResponse = await fetch(`/api/video/draft/${state.videoJobId}/list?draft_type=draft`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const allData = await allResponse.json();
              if (allData?.code === 0) {
                const allDrafts: VideoDraftItem[] = (allData.data?.drafts ?? []).map((draft: any) => ({
                  id: draft.id,
                  model: draft.model,
                  video_url: draft.video_url,
                  thumbnail_url: draft.thumbnail_url,
                  duration_seconds: draft.duration_seconds,
                  status: draft.status,
                  selected: draft.selected,
                  generation_cost: draft.generation_cost,
                }));
                setState((prev) => ({ ...prev, drafts: allDrafts }));
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
        await fetch(`/api/video/draft/${state.videoJobId}/select/${draftId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
      motionConfig: { ...state.motionConfig, aspectRatio: value },
    };
    setState(nextState);
    void save(nextState);
    if (state.videoJobId) {
      try {
        await fetch(`/api/video/jobs/${state.videoJobId}/status`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
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
    setState((prev) => ({
      ...prev,
      finalVideos: [],
      selectedFinalId: undefined,
      originalFinalId: undefined,
      composedFinalId: undefined,
    }));

    const finalToken = localStorage.getItem("token") ?? "";
    const generateStartTime = new Date().toISOString();
    const aspectRatio = (state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO;
    const duration = (state.motionConfig?.draftDuration as number) ?? 5;
    const sound = (state.motionConfig?.sound as boolean) ?? false;
    const emotionText = state.draftEmotion ? `The character feels ${state.draftEmotion}, ` : "";
    const motionText = state.motionData?.motion_sequence?.join(", ") ?? "";
    const promptText = `${emotionText}${state.draftPrompt || ""} Motion: ${motionText}`.trim();

    try {
      const response = await fetch("/api/video/draft/generate", {
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
          const pollResponse = await fetch(
            `/api/video/draft/${state.videoJobId}/list?draft_type=final&since=${encodeURIComponent(generateStartTime)}`,
            {
              headers: { Authorization: `Bearer ${finalToken}` },
            },
          );
          const pollData = await pollResponse.json();
          if (pollData?.code === 0) {
            const allFinals: VideoDraftItem[] = (pollData.data?.drafts ?? []).map((draft: any) => ({
              id: draft.id,
              model: draft.model,
              video_url: normalizeUrl(draft.video_url),
              thumbnail_url: draft.thumbnail_url ?? state.firstFrame?.url,
              duration_seconds: draft.duration_seconds,
              status: draft.status,
              selected: draft.selected,
              operation: draft.operation,
              generation_cost: draft.generation_cost,
            }));
            const { originals: finals, composed } = splitFinalVideos(allFinals);
            setComposedVideos(composed);
            setState((prev) => ({ ...prev, finalVideos: finals }));
            if (pollData.data?.all_done) {
              if (pollFinalRef.current) clearInterval(pollFinalRef.current);
              pollFinalRef.current = null;
              setGeneratingFinal(false);
            }
          }
        } catch {}
      }, 8000);
    } catch {
      setGeneratingFinal(false);
    }
  };

  const handleSelectFinal = async (finalId: string) => {
    const next = { ...state, selectedFinalId: finalId, originalFinalId: finalId, composedFinalId: undefined };
    setState(next);
    if (state.videoJobId) {
      try {
        await fetch(`/api/video/draft/${state.videoJobId}/select/${finalId}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
        const logoUrl = postConfig.logo.url.startsWith("http")
          ? postConfig.logo.url
          : `http://host.docker.internal:8000${postConfig.logo.url}`;
        body.logo = {
          url: logoUrl,
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

      const response = await fetch(`/api/video/jobs/${state.videoJobId}/compose-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (data?.code === 0 && data.data?.composed_url && data.data?.new_draft_id) {
        const composedUrl = data.data.composed_url.startsWith("http")
          ? data.data.composed_url
          : `${process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}${data.data.composed_url}`;
        const newDraft = {
          id: data.data.new_draft_id,
          model: originalDraft.model,
          video_url: composedUrl,
          thumbnail_url: originalDraft.thumbnail_url,
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
                    src={state.firstFrame.url}
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
              firstFrameUrl={state.firstFrame?.url}
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
              onGenerate={handleGenerate}
              onSelectDraft={handleSelectDraft}
            />
          )}

          {state.currentStep === 3 && (
            <MotionExtractor
              draftVideoUrl={state.drafts.find((draft) => draft.id === state.selectedDraftId)?.video_url}
              firstFrameUrl={state.firstFrame?.url}
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
                  await fetch(`/api/video/motion/${state.videoJobId}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${localStorage.getItem("token")}`,
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
            <MotionFXConfig
              presetId={state.motionConfig?.fxPresetId as string}
              camera={state.motionConfig?.fxCamera as string}
              textFx={state.motionConfig?.fxText as string}
              cta={state.motionConfig?.fxCta as string}
              global={state.motionConfig?.fxGlobal as string}
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
          )}

          {state.currentStep === 5 && (
            <FinalGenerator
              firstFrameUrl={state.firstFrame?.url}
              motionPrompt={`${state.draftEmotion ? `${state.draftEmotion} · ` : ""}${state.draftPrompt || ""}`}
              aspectRatio={(state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO}
              finals={state.finalVideos}
              selectedFinalId={state.selectedFinalId}
              generating={generatingFinal}
              availableModels={finalModels}
              modelConfigId={state.motionConfig?.finalModelConfigId as number}
              duration={(state.motionConfig?.draftDuration as number) ?? 5}
              sound={(state.motionConfig?.sound as boolean) ?? false}
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
              onGenerate={handleGenerateFinal}
              onSelectFinal={handleSelectFinal}
            />
          )}

          {state.currentStep === 6 && (
            <>
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
              firstFrameUrl={state.firstFrame?.url}
              taskName={state.notes}
              aspectRatio={(state.motionConfig?.aspectRatio as string) ?? DEFAULT_VIDEO_ASPECT_RATIO}
              duration={(state.motionConfig?.draftDuration as number) ?? 5}
              archiving={archiving}
              archived={archived}
              onArchive={async () => {
                setArchiving(true);
                try {
                  const finalVideo =
                    composedVideos.find((final) => final.id === state.composedFinalId) ||
                    state.finalVideos.find((final) => final.id === state.originalFinalId);
                  if (finalVideo?.video_url && state.videoJobId) {
                    await fetch(`/api/video/jobs/${state.videoJobId}/status`, {
                      method: "PATCH",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${localStorage.getItem("token")}`,
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
                await fetch(`/api/video/jobs/${state.videoJobId}/status`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${localStorage.getItem("token")}`,
                  },
                  body: JSON.stringify({ status: "completed" }),
                });
                window.location.href = "/gallery/video";
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
