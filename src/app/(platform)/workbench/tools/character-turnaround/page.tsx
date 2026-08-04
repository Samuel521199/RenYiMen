"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  ImagePlus,
  Loader2,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";

type AssetView = "front" | "side" | "back";

type TurnaroundKeyframe = {
  id: string;
  keyframeNo: number;
  status: string;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  assetView?: AssetView | string;
  imageUrl?: string | null;
  errorMessage?: string | null;
  locked: boolean;
};

type TurnaroundProject = {
  id: string;
  title: string;
  status: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  referenceImageUrls: string[];
  keyframes: TurnaroundKeyframe[];
  createdAt: string;
  updatedAt: string;
  errorMessage?: string | null;
};

type ApiResponse = {
  ok: boolean;
  project?: TurnaroundProject;
  projects?: TurnaroundProject[];
  error?: string;
};

const PROJECT_STORAGE_KEY = "character-turnaround-project-id";
const VIEW_ORDER: AssetView[] = ["front", "side", "back"];

const COPY = {
  zh: {
    back: "返回工具",
    title: "人物三视图",
    subtitle: "独立生成正面、侧面和背面人物资产",
    source: "人物身份参考",
    sourceHint: "建议使用清晰、无遮挡、尽量完整展示人物与服装的图片。",
    dropHint: "拖拽图片到此处，或点击选择",
    dropActive: "松开即可上传图片",
    uploading: "正在上传",
    details: "人物与服装补充说明",
    detailsPlaceholder: "补充参考图中不易看清的服装、发型、配饰或背面细节",
    ratio: "画幅",
    create: "创建并生成正面图",
    creating: "正在创建",
    front: "正面",
    side: "侧面",
    backView: "背面",
    waitingFront: "等待正面图批准并锁定",
    waitingSide: "等待侧面图批准并锁定",
    queued: "已进入持久化队列",
    running: "正在生成",
    ready: "待审核",
    approved: "已批准并锁定",
    failed: "生成失败",
    empty: "尚未生成",
    approveFront: "批准并生成侧面",
    approveSide: "批准并生成背面",
    approveBack: "批准并完成",
    approving: "正在批准",
    regenerate: "重新生成",
    download: "下载图片",
    refresh: "刷新",
    progress: "生成进度",
    completed: "三视图已全部批准",
    invalidImage: "请拖入有效的图片文件",
    uploadFailed: "参考图上传失败",
    createFailed: "项目创建失败",
    actionFailed: "操作失败",
    identityRoot: "原始身份图",
  },
  en: {
    back: "Back to tools",
    title: "Character Turnaround",
    subtitle: "Generate separate front, side, and back character assets",
    source: "Identity reference",
    sourceHint: "Use a clear, unobstructed image that shows the character and outfit as fully as possible.",
    dropHint: "Drop an image here, or click to choose",
    dropActive: "Release to upload image",
    uploading: "Uploading",
    details: "Character and outfit notes",
    detailsPlaceholder: "Add outfit, hairstyle, accessory, or back-view details that are unclear in the source",
    ratio: "Aspect ratio",
    create: "Create and generate front",
    creating: "Creating",
    front: "Front",
    side: "Side",
    backView: "Back",
    waitingFront: "Waiting for approved and locked front view",
    waitingSide: "Waiting for approved and locked side view",
    queued: "Queued durably",
    running: "Generating",
    ready: "Ready for review",
    approved: "Approved and locked",
    failed: "Generation failed",
    empty: "Not generated",
    approveFront: "Approve and generate side",
    approveSide: "Approve and generate back",
    approveBack: "Approve and finish",
    approving: "Approving",
    regenerate: "Regenerate",
    download: "Download image",
    refresh: "Refresh",
    progress: "Generation progress",
    completed: "All three views are approved",
    invalidImage: "Drop a valid image file",
    uploadFailed: "Reference upload failed",
    createFailed: "Project creation failed",
    actionFailed: "Action failed",
    identityRoot: "Identity root",
  },
} as const;

export default function CharacterTurnaroundPage() {
  const { locale } = useLanguage();
  const copy = COPY[locale];
  const [project, setProject] = useState<TurnaroundProject | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const pollingRef = useRef(false);

  const loadProject = useCallback(async (projectId: string, quiet = false) => {
    if (!projectId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const data = await fetchJson(`/api/video-projects/${projectId}`);
      if (!data.project) throw new Error(data.error || copy.actionFailed);
      setProject(data.project);
      if (!quiet) setError("");
      window.localStorage.setItem(PROJECT_STORAGE_KEY, data.project.id);
    } catch (requestError) {
      if (!quiet) setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    } finally {
      pollingRef.current = false;
    }
  }, [copy.actionFailed]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await fetchJson("/api/character-turnarounds");
      const nextProjects = data.projects ?? [];
      const storedId = window.localStorage.getItem(PROJECT_STORAGE_KEY);
      const selected = nextProjects.find((item) => item.id === storedId) ?? nextProjects[0];
      if (selected) await loadProject(selected.id, true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    }
  }, [copy.actionFailed, loadProject]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const hasActiveTask = useMemo(() => project?.keyframes.some((frame) =>
    frame.status === "IMAGE_PENDING" || frame.status === "IMAGE_RUNNING"
  ) ?? false, [project]);

  useEffect(() => {
    if (!project || !hasActiveTask) return;
    const timer = window.setInterval(() => void loadProject(project.id, true), 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveTask, loadProject, project]);

  const framesByView = useMemo(() => new Map(
    (project?.keyframes ?? []).flatMap((frame) =>
      VIEW_ORDER.includes(frame.assetView as AssetView)
        ? [[frame.assetView as AssetView, frame] as const]
        : []
    ),
  ), [project]);

  const approvedCount = VIEW_ORDER.filter((view) => {
    const frame = framesByView.get(view);
    return Boolean(frame?.imageUrl && (frame.locked || frame.status === "IMAGE_APPROVED"));
  }).length;

  const handleUpload = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(copy.invalidImage);
      return;
    }
    setUploading(true);
    setError("");
    try {
      setReferenceImageUrl(await uploadReferenceImage(file));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : copy.uploadFailed);
    } finally {
      setUploading(false);
    }
  }, [copy.invalidImage, copy.uploadFailed]);

  const { isDragging, dropZoneProps } = useFileDrop({
    disabled: uploading,
    onFiles: handleUpload,
  });

  async function createProject() {
    if (!referenceImageUrl || creating) return;
    setCreating(true);
    setError("");
    try {
      const data = await fetchJson("/api/character-turnarounds", {
        method: "POST",
        body: JSON.stringify({ referenceImageUrl, characterDescription, aspectRatio }),
      });
      if (!data.project) throw new Error(data.error || copy.createFailed);
      setProject(data.project);
      window.localStorage.setItem(PROJECT_STORAGE_KEY, data.project.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  }

  async function approveFrame(frame: TurnaroundKeyframe) {
    if (!project || actionId) return;
    setActionId(`approve:${frame.id}`);
    setError("");
    try {
      const data = await fetchJson(`/api/video-projects/${project.id}/keyframes/${frame.id}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: true, locale }),
      });
      if (!data.project) throw new Error(data.error || copy.actionFailed);
      setProject(data.project);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    } finally {
      setActionId("");
    }
  }

  async function regenerateFrame(frame: TurnaroundKeyframe) {
    if (!project || actionId) return;
    setActionId(`retry:${frame.id}`);
    setError("");
    try {
      if (frame.locked) {
        await fetchJson(`/api/video-projects/${project.id}/keyframes/${frame.id}`, {
          method: "PATCH",
          body: JSON.stringify({ locked: false, locale }),
        });
      }
      const data = await fetchJson(`/api/video-projects/${project.id}/keyframes/${frame.id}/image`, { method: "POST" });
      if (!data.project) throw new Error(data.error || copy.actionFailed);
      setProject(data.project);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    } finally {
      setActionId("");
    }
  }

  return (
    <div className="min-h-full bg-[#070d1b] text-slate-100">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <Link href="/workbench/tools" className="mb-3 inline-flex min-h-11 items-center gap-2 text-sm text-slate-400 transition hover:text-cyan-300">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {copy.back}
            </Link>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{copy.title}</h1>
            <p className="mt-2 text-sm text-slate-400">{copy.subtitle}</p>
          </div>
        </header>

        {!project && (
          <section className="grid gap-6 border-b border-white/10 pb-7 lg:grid-cols-[minmax(260px,420px)_1fr]">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{copy.source}</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{copy.sourceHint}</p>
                </div>
                {referenceImageUrl && (
                  <button type="button" title="Remove" onClick={() => setReferenceImageUrl("")} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06] hover:text-white">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <label
                className={`relative flex aspect-[4/3] cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed bg-[#0b1426] transition ${isDragging ? "border-cyan-300 bg-cyan-400/10" : "border-cyan-400/30 hover:border-cyan-300/60 hover:bg-[#0d1930]"}`}
                {...dropZoneProps}
              >
                {isDragging ? (
                  <span className="flex flex-col items-center gap-3 text-sm font-medium text-cyan-200">
                    <Upload className="h-8 w-8" aria-hidden="true" />
                    {copy.dropActive}
                  </span>
                ) : referenceImageUrl ? (
                  <img src={previewImageSrc(referenceImageUrl)} alt={copy.identityRoot} className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-3 text-sm text-slate-400">
                    {uploading ? <Loader2 className="h-7 w-7 animate-spin text-cyan-300" /> : <ImagePlus className="h-7 w-7 text-cyan-300" />}
                    {uploading ? copy.uploading : copy.dropHint}
                  </span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    void handleUpload(files);
                  }}
                />
              </label>
            </div>

            <div className="flex min-w-0 flex-col gap-5">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-100">{copy.details}</span>
                <textarea
                  value={characterDescription}
                  onChange={(event) => setCharacterDescription(event.target.value)}
                  placeholder={copy.detailsPlaceholder}
                  rows={6}
                  className="w-full resize-y rounded-md border border-white/10 bg-[#0b1426] px-4 py-3 text-sm leading-6 text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
                />
              </label>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-slate-100">{copy.ratio}</legend>
                <div className="inline-flex rounded-md border border-white/10 bg-[#0b1426] p-1">
                  {(["9:16", "1:1", "16:9"] as const).map((ratio) => (
                    <button key={ratio} type="button" onClick={() => setAspectRatio(ratio)} className={`min-h-10 min-w-16 rounded px-3 text-sm transition ${aspectRatio === ratio ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}>
                      {ratio}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="mt-auto flex justify-end">
                <button type="button" disabled={!referenceImageUrl || uploading || creating} onClick={() => void createProject()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cyan-500 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {creating ? copy.creating : copy.create}
                </button>
              </div>
            </div>
          </section>
        )}

        {error && <div role="alert" className="rounded-md border border-red-400/25 bg-red-950/25 px-4 py-3 text-sm text-red-200">{error}</div>}

        {project && (
          <>
            <section className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
              <div>
                <p className="text-xs font-medium uppercase text-slate-500">{copy.progress}</p>
                <p className="mt-1 text-lg font-semibold text-white">{approvedCount}/3 {approvedCount === 3 ? `· ${copy.completed}` : ""}</p>
              </div>
              <div className="flex items-center gap-3">
                {project.referenceImageUrls[0] && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <img src={previewImageSrc(project.referenceImageUrls[0])} alt={copy.identityRoot} className="h-11 w-11 rounded-md border border-white/10 object-cover" />
                    {copy.identityRoot}
                  </div>
                )}
                <button type="button" title={copy.refresh} onClick={() => void loadProject(project.id)} className="grid h-11 w-11 place-items-center rounded-md border border-white/10 text-slate-300 transition hover:border-cyan-400/30 hover:bg-white/[0.06]">
                  <RefreshCw className={`h-4 w-4 ${hasActiveTask ? "animate-spin" : ""}`} aria-hidden="true" />
                </button>
              </div>
            </section>

            <main className="grid gap-4 md:grid-cols-3">
              {VIEW_ORDER.map((view) => (
                <TurnaroundCard
                  key={view}
                  view={view}
                  frame={framesByView.get(view)}
                  framesByView={framesByView}
                  aspectRatio={project.aspectRatio}
                  copy={copy}
                  busy={actionId}
                  onApprove={approveFrame}
                  onRegenerate={regenerateFrame}
                />
              ))}
            </main>
          </>
        )}
      </div>
    </div>
  );
}

function TurnaroundCard({
  view,
  frame,
  framesByView,
  aspectRatio,
  copy,
  busy,
  onApprove,
  onRegenerate,
}: {
  view: AssetView;
  frame?: TurnaroundKeyframe;
  framesByView: Map<AssetView, TurnaroundKeyframe>;
  aspectRatio: TurnaroundProject["aspectRatio"];
  copy: typeof COPY.zh | typeof COPY.en;
  busy: string;
  onApprove: (frame: TurnaroundKeyframe) => Promise<void>;
  onRegenerate: (frame: TurnaroundKeyframe) => Promise<void>;
}) {
  const predecessor = view === "side" ? framesByView.get("front") : view === "back" ? framesByView.get("side") : undefined;
  const predecessorReady = !predecessor || Boolean(predecessor.imageUrl && (predecessor.locked || predecessor.status === "IMAGE_APPROVED"));
  const waitingText = view === "back" ? copy.waitingSide : copy.waitingFront;
  const label = view === "front" ? copy.front : view === "side" ? copy.side : copy.backView;
  const isRunning = frame?.status === "IMAGE_PENDING" || frame?.status === "IMAGE_RUNNING";
  const approved = Boolean(frame?.imageUrl && (frame.locked || frame.status === "IMAGE_APPROVED"));
  const failed = frame?.status === "FAILED";
  const statusLabel = approved
    ? copy.approved
    : !predecessorReady
      ? waitingText
      : isRunning
        ? frame?.status === "IMAGE_RUNNING" ? copy.running : copy.queued
        : failed
          ? copy.failed
          : frame?.imageUrl
            ? copy.ready
            : copy.empty;
  const approveLabel = view === "front" ? copy.approveFront : view === "side" ? copy.approveSide : copy.approveBack;
  const approving = frame ? busy === `approve:${frame.id}` : false;
  const retrying = frame ? busy === `retry:${frame.id}` : false;
  const ratioClass = aspectRatio === "16:9" ? "aspect-video" : aspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]";

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-[#0b1426]">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded bg-cyan-400/10 text-xs font-semibold text-cyan-300">{VIEW_ORDER.indexOf(view) + 1}</span>
          <h2 className="text-sm font-semibold text-white">{label}</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs ${approved ? "text-emerald-300" : failed ? "text-red-300" : isRunning ? "text-cyan-300" : "text-slate-400"}`}>
          {approved ? <LockKeyhole className="h-3.5 w-3.5" /> : isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {statusLabel}
        </span>
      </div>
      <div className={`relative w-full overflow-hidden bg-black/30 ${ratioClass}`}>
        {frame?.imageUrl ? (
          <img src={previewImageSrc(frame.imageUrl)} alt={label} className="h-full w-full object-contain" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-slate-500">
            {isRunning ? <Loader2 className="h-7 w-7 animate-spin text-cyan-300" /> : <ImagePlus className="h-7 w-7" />}
            <span>{statusLabel}</span>
          </div>
        )}
      </div>
      {frame?.errorMessage && <p className="border-t border-red-400/20 bg-red-950/20 px-4 py-3 text-xs leading-5 text-red-200">{frame.errorMessage}</p>}
      <div className="mt-auto flex min-h-16 items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
        <div className="flex items-center gap-1">
          {frame?.imageUrl && (
            <a href={frame.imageUrl} target="_blank" rel="noreferrer" title={copy.download} className="grid h-11 w-11 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white">
              <Download className="h-4 w-4" aria-hidden="true" />
            </a>
          )}
          {frame && predecessorReady && !isRunning && (
            <button type="button" disabled={Boolean(busy)} title={copy.regenerate} onClick={() => void onRegenerate(frame)} className="grid h-11 w-11 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            </button>
          )}
        </div>
        {frame?.imageUrl && !approved && (
          <button type="button" disabled={Boolean(busy)} onClick={() => void onApprove(frame)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-500 px-3 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40">
            {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {approving ? copy.approving : approveLabel}
          </button>
        )}
        {approved && <span className="inline-flex items-center gap-2 px-2 text-xs font-medium text-emerald-300"><Check className="h-4 w-4" />{copy.approved}</span>}
      </div>
    </article>
  );
}

async function fetchJson(url: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const text = await response.text();
  let data: ApiResponse;
  try {
    data = text ? JSON.parse(text) as ApiResponse : { ok: false };
  } catch {
    data = { ok: false, error: text.slice(0, 240) };
  }
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function uploadReferenceImage(file: File): Promise<string> {
  const presign = await fetchJsonUpload("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
  });
  if (!presign.uploadUrl || !presign.publicUrl) throw new Error(presign.error || "Upload presign failed");
  const upload = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!upload.ok) throw new Error(`Upload failed ${upload.status}`);
  return presign.publicUrl;
}

async function fetchJsonUpload(url: string, init: RequestInit): Promise<{ uploadUrl?: string; publicUrl?: string; error?: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: { uploadUrl?: string; publicUrl?: string; error?: string };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 240) };
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function previewImageSrc(url?: string | null): string {
  const value = String(url ?? "").trim();
  if (!value || value.startsWith("/") || value.startsWith("data:")) return value;
  return `/api/download-external-image?url=${encodeURIComponent(value)}`;
}
