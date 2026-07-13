/**
 * Video Workflow — shared types and session helpers
 * Mirrors the backend VideoJob schema and workflow_sessions autoSave pattern.
 */

import { apiGet, workbenchStaticUrl } from "@workbench/lib/api";

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export type FirstFrameSourceType = "gallery" | "asset" | "frame" | "upload";
export type FirstFrameStatus = "empty" | "selecting" | "uploading" | "awaiting_make" | "selected";
export type VideoLanguage = "english" | "taglish" | "chinese";

export interface FirstFrame {
  asset_id: number;
  url: string;
  source_type: FirstFrameSourceType;
  width?: number;
  height?: number;
  tags?: string[];
}

/** Resolve backend `/static/...` paths through the Workbench proxy for browser display. */
export function normalizeVideoMediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  return workbenchStaticUrl(url);
}

/** Strip Workbench proxy prefix before persisting paths back to FastAPI. */
export function toBackendStaticPath(url?: string | null): string {
  const value = String(url || "").trim();
  if (!value) return "";
  if (value.startsWith("/api/workbench")) {
    return value.slice("/api/workbench".length) || value;
  }
  return value;
}

export function normalizeFirstFrame(frame?: FirstFrame): FirstFrame | undefined {
  if (!frame?.url) return frame;
  return {
    ...frame,
    url: normalizeVideoMediaUrl(frame.url) || frame.url,
  };
}

export interface MotionKeypoint {
  timestamp: number;
  label: string;
}

export interface MotionData {
  motion_sequence: string[];
  timing: Record<string, number>;
  camera?: string;
  emotion?: string;
  scene?: string;
  raw_keypoints: MotionKeypoint[];
}

export interface VideoDraftItem {
  id: string;
  model: string;
  video_url?: string;
  thumbnail_url?: string;
  duration_seconds?: number;
  status: string;
  selected: boolean;
  operation?: string;
  qualityScore?: number;
  qualityGrade?: "A" | "B" | "C" | "D";
  qualityReasons?: string[];
  qualitySuggestions?: string[];
  qualityDimensions?: {
    consistency: number;
    motion: number;
    visual: number;
    textClean: number;
  };
  qualityModelSource?: "model" | "heuristic";
  aspectRatio?: string;
}

export interface PostLayer {
  enabled: boolean;
}

export interface LogoLayer extends PostLayer {
  url?: string;
  assetId?: number;
  x: number;
  y: number;
  size: number;
}

export interface SubtitleLayer extends PostLayer {
  text: string;
  position: "top" | "bottom" | "center";
  fontSize: number;
  styleTemplate?: "social_pop" | "minimal_clean" | "news_banner";
  maxCharsPerLine?: number;
  lines?: string[];
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export interface CtaLayer extends PostLayer {
  text: string;
  position: "top" | "bottom";
}

export interface PostConfig {
  logo: LogoLayer;
  subtitle: SubtitleLayer;
  cta: CtaLayer;
}

type LegacyPostConfig = {
  subtitleText?: string;
  bgmAssetId?: number;
  sfxAssetId?: number;
  logoEnabled?: boolean;
  ctaText?: string;
  subtitleEnabled?: boolean;
  logoUrl?: string;
  logoAssetId?: number;
  logoPosition?: string;
  logoX?: number;
  logoY?: number;
  logoSize?: number;
};

export const DEFAULT_POST_CONFIG: PostConfig = {
  logo: { enabled: false, x: 5, y: 75, size: 20 },
  subtitle: {
    enabled: false,
    text: "",
    position: "bottom",
    fontSize: 24,
    styleTemplate: "social_pop",
    maxCharsPerLine: 14,
    lines: [],
    segments: [],
  },
  cta: { enabled: false, text: "", position: "bottom" },
};

export function clonePostConfig(config: PostConfig = DEFAULT_POST_CONFIG): PostConfig {
  return {
    logo: { ...config.logo },
    subtitle: { ...config.subtitle },
    cta: { ...config.cta },
  };
}

export function normalizePostConfig(config?: PostConfig | LegacyPostConfig | null): PostConfig {
  const base = clonePostConfig();
  if (!config || typeof config !== "object") return base;

  if ("logo" in config || "subtitle" in config || "cta" in config) {
    const next = config as Partial<PostConfig>;
    return {
      logo: { ...base.logo, ...(next.logo ?? {}) },
      subtitle: { ...base.subtitle, ...(next.subtitle ?? {}) },
      cta: { ...base.cta, ...(next.cta ?? {}) },
    };
  }

  const legacy = config as LegacyPostConfig;
  return {
    logo: {
      ...base.logo,
      enabled: Boolean(legacy.logoEnabled),
      url: legacy.logoUrl,
      assetId: legacy.logoAssetId,
      x: typeof legacy.logoX === "number" ? legacy.logoX : base.logo.x,
      y: typeof legacy.logoY === "number" ? legacy.logoY : base.logo.y,
      size: typeof legacy.logoSize === "number" ? legacy.logoSize : base.logo.size,
    },
    subtitle: {
      ...base.subtitle,
      enabled: Boolean(legacy.subtitleEnabled),
      text: legacy.subtitleText ?? "",
    },
    cta: {
      ...base.cta,
      enabled: Boolean(legacy.ctaText),
      text: legacy.ctaText ?? "",
    },
  };
}

export interface VideoWorkflowState {
  sessionId?: number;
  videoJobId?: string;
  currentStep: number;
  firstFrame?: FirstFrame;
  firstFrameStatus: FirstFrameStatus;
  draftPrompt?: string;
  draftEmotion?: string;
  drafts: VideoDraftItem[];
  selectedDraftId?: string;
  motionData?: MotionData;
  motionPresetId?: string;
  motionConfig?: Record<string, unknown>;
  finalVideos: VideoDraftItem[];
  selectedFinalId?: string;
  originalFinalId?: string;
  composedFinalId?: string;
  postConfig?: PostConfig;
  exportUrl?: string;
  videoLanguage: VideoLanguage;
  notes?: string;
  lastSavedAt?: string;
}

export const defaultVideoWorkflowState = (): VideoWorkflowState => ({
  currentStep: 1,
  firstFrameStatus: "empty",
  drafts: [],
  finalVideos: [],
  postConfig: clonePostConfig(),
  videoLanguage: "english",
});

// ──────────────────────────────────────────
// Session helpers
// ──────────────────────────────────────────

export interface AutoSaveResult {
  sessionId: number;
  savedAt: string;
}

/**
 * Save current workflow state to backend session.
 * Returns updated sessionId (create on first call, update thereafter).
 */
export async function autoSaveVideoSession(
  state: VideoWorkflowState,
): Promise<AutoSaveResult | null> {
  try {
    const token = typeof window !== "undefined" ? (localStorage.getItem("workbench_token") ?? "") : "";
    const API_BASE = "/api/workbench";
    const payload = {
      workflow_type: "video",
      mode: "video",
      session_id: state.sessionId,
      state_json: JSON.stringify(state),
      current_step: state.currentStep,
      status: state.firstFrameStatus === "selected" ? "in_progress" : "draft",
    };
    const res = await fetch(`${API_BASE}/api/workflow-sessions/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data?.code === 0 && data?.data?.id) {
      return {
        sessionId: data.data.id,
        savedAt: new Date().toISOString(),
      };
    }
    return null;
  } catch (error) {
    console.warn("[autoSave] failed:", error);
    return null;
  }
}

/**
 * Restore workflow state from a saved session.
 */
export async function restoreVideoSession(
  sessionId: number,
  token: string,
): Promise<VideoWorkflowState | null> {
  void token;
  try {
    const res = await apiGet<{ state_json?: string }>(`/api/workflow-sessions/${sessionId}`);
    if (res?.code === 0 && res?.data?.state_json) {
      const restored = JSON.parse(res.data.state_json) as VideoWorkflowState;
      return {
        ...defaultVideoWorkflowState(),
        ...restored,
        sessionId,
        firstFrame: normalizeFirstFrame(restored.firstFrame),
        postConfig: normalizePostConfig(restored.postConfig),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function verifyVideoJobExists(videoJobId: string): Promise<boolean> {
  try {
    const res = await apiGet(`/api/video/jobs/${videoJobId}`);
    return res?.code === 0;
  } catch {
    return false;
  }
}

async function persistFirstFrameToJob(videoJobId: string, frame: FirstFrame): Promise<boolean> {
  try {
    const token = typeof window !== "undefined" ? (localStorage.getItem("workbench_token") ?? "") : "";
    const res = await fetch(`/api/workbench/api/video/first-frame/${videoJobId}/select`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        asset_id: frame.asset_id,
        url: toBackendStaticPath(frame.url),
        source_type: frame.source_type,
      }),
    });
    const data = await res.json();
    return data?.code === 0;
  } catch {
    return false;
  }
}

/**
 * Ensure a backend VideoJob exists for the current workflow session.
 * Creates one when missing (e.g. restored session without videoJobId after DB import).
 */
export async function ensureVideoJobForState(
  state: VideoWorkflowState,
): Promise<VideoWorkflowState | null> {
  if (state.videoJobId && (await verifyVideoJobExists(state.videoJobId))) {
    if (state.firstFrame?.url && state.firstFrameStatus === "selected") {
      await persistFirstFrameToJob(state.videoJobId, state.firstFrame);
    }
    return state;
  }

  try {
    const token = typeof window !== "undefined" ? (localStorage.getItem("workbench_token") ?? "") : "";
    const res = await fetch("/api/workbench/api/video/jobs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        session_id: state.sessionId,
        video_language: state.videoLanguage || "english",
        notes: state.notes,
      }),
    });
    const data = await res.json();
    if (data?.code !== 0 || !data?.data?.id) {
      console.error("[ensureVideoJob] create failed:", data);
      return null;
    }

    const nextState: VideoWorkflowState = {
      ...state,
      videoJobId: data.data.id,
      sessionId: data.data.session_id ?? state.sessionId,
    };

    if (nextState.firstFrame?.url && nextState.firstFrameStatus === "selected") {
      const persisted = await persistFirstFrameToJob(nextState.videoJobId!, nextState.firstFrame);
      if (!persisted) {
        console.warn("[ensureVideoJob] first frame persist failed");
      }
    }

    return nextState;
  } catch (error) {
    console.error("[ensureVideoJob] error:", error);
    return null;
  }
}

/**
 * Check whether the first frame writeback has arrived (poll for awaiting_make).
 */
export async function pollFirstFrameStatus(
  videoJobId: string,
  token: string,
): Promise<FirstFrameStatus | null> {
  void token;
  try {
    const res = await apiGet<{ first_frame_status?: FirstFrameStatus }>(
      `/api/video/first-frame/${videoJobId}/status`,
    );
    if (res?.code === 0) {
      return res.data.first_frame_status ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// Step guard
// ──────────────────────────────────────────

/**
 * Returns true if the state satisfies the minimum requirements to advance past step N.
 */
export function canAdvanceFrom(step: number, state: VideoWorkflowState): boolean {
  switch (step) {
    case 1:
      return state.firstFrameStatus === "selected" && !!state.firstFrame?.url;
    case 2:
      return state.drafts.length > 0 && !!state.selectedDraftId;
    case 3:
      return !!state.motionData && state.motionData.motion_sequence.length > 0;
    case 4:
      return true;
    case 5:
      return state.finalVideos.length > 0 && !!state.selectedFinalId;
    case 6:
      return true;
    default:
      return true;
  }
}
