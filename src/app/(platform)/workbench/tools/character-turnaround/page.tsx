"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Download,
  History,
  ImagePlus,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/i18n";
import { useFileDrop } from "@/components/WorkflowForm/controls/useFileDrop";
import { saveFileWithPicker } from "@/lib/save-file-with-picker";

type AssetView = "front" | "side" | "back";
type CharacterPose = "neutral" | "t_pose";

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
  productionJobs?: Array<{
    id: string;
    kind: string;
    status: string;
    targetId: string;
  }>;
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
const ACTIVE_JOB_STATUSES = new Set(["queued", "claimed", "running", "waiting_upstream", "waiting_review"]);

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
    pose: "人物姿势",
    neutralPose: "自然站姿",
    tPose: "T 字姿势（3D）",
    create: "创建并生成正面图",
    creating: "正在创建",
    front: "正面",
    side: "侧面",
    backView: "背面",
    waitingFront: "等待正面图生成完成",
    waitingSide: "等待侧面图生成完成",
    queued: "已进入持久化队列",
    running: "正在生成",
    ready: "待审核",
    failed: "生成失败",
    empty: "尚未生成",
    regenerate: "重新生成",
    download: "下载图片",
    refresh: "刷新",
    progress: "生成进度",
    completed: "三视图已全部生成",
    invalidImage: "请拖入有效的图片文件",
    uploadFailed: "参考图上传失败",
    createFailed: "项目创建失败",
    actionFailed: "操作失败",
    identityRoot: "原始身份图",
    nextStep: "下一步",
    generateFront: "生成正面图",
    generateSide: "生成侧面图",
    generateBack: "生成背面图",
    selectRegenerateView: "选择要重新生成的视图",
    regenerateSelected: "重新生成所选视图",
    regenerateFrontFirst: "请先重新生成正面图",
    regenerateSideFirst: "请先重新生成侧面图",
    waitingGeneration: "等待生成任务完成",
    generated: "已生成",
    newTask: "新建任务",
    continueLast: "继续上次任务",
    downloadFailed: "图片下载失败",
    downloadSuccess: "图片下载成功",
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
    pose: "Character pose",
    neutralPose: "Neutral stance",
    tPose: "T-pose (3D)",
    create: "Create and generate front",
    creating: "Creating",
    front: "Front",
    side: "Side",
    backView: "Back",
    waitingFront: "Waiting for front-view generation",
    waitingSide: "Waiting for side-view generation",
    queued: "Queued durably",
    running: "Generating",
    ready: "Ready for review",
    failed: "Generation failed",
    empty: "Not generated",
    regenerate: "Regenerate",
    download: "Download image",
    refresh: "Refresh",
    progress: "Generation progress",
    completed: "All three views are generated",
    invalidImage: "Drop a valid image file",
    uploadFailed: "Reference upload failed",
    createFailed: "Project creation failed",
    actionFailed: "Action failed",
    identityRoot: "Identity root",
    nextStep: "Next step",
    generateFront: "Generate front view",
    generateSide: "Generate side view",
    generateBack: "Generate back view",
    selectRegenerateView: "Select a view to regenerate",
    regenerateSelected: "Regenerate selected view",
    regenerateFrontFirst: "Regenerate the front view first",
    regenerateSideFirst: "Regenerate the side view first",
    waitingGeneration: "Waiting for generation to finish",
    generated: "Generated",
    newTask: "New task",
    continueLast: "Continue last task",
    downloadFailed: "Image download failed",
    downloadSuccess: "Image downloaded successfully",
  },
} as const;

export default function CharacterTurnaroundPage() {
  const { locale } = useLanguage();
  const copy = COPY[locale];
  const [project, setProject] = useState<TurnaroundProject | null>(null);
  const [resumeProject, setResumeProject] = useState<TurnaroundProject | null>(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState("");
  const [characterDescription, setCharacterDescription] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "1:1" | "16:9">("9:16");
  const [pose, setPose] = useState<CharacterPose>("neutral");
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  const [regenerateView, setRegenerateView] = useState<AssetView>("front");
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
      setResumeProject(selected ?? null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    }
  }, [copy.actionFailed]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (!downloadNotice) return;
    const timer = window.setTimeout(() => setDownloadNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [downloadNotice]);

  const activeJobs = useMemo(
    () => (project?.productionJobs ?? []).filter((job) => ACTIVE_JOB_STATUSES.has(job.status)),
    [project?.productionJobs],
  );
  const hasActiveTask = activeJobs.length > 0;

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

  const generatedCount = VIEW_ORDER.filter((view) => {
    const frame = framesByView.get(view);
    return Boolean(frame?.imageUrl);
  }).length;

  const nextAction = useMemo(() => {
    for (const view of VIEW_ORDER) {
      const frame = framesByView.get(view);
      if (!frame) continue;
      const approved = Boolean(frame.imageUrl && (frame.locked || frame.status === "IMAGE_APPROVED"));
      if (approved) continue;
      const predecessor = view === "side" ? framesByView.get("front") : view === "back" ? framesByView.get("side") : undefined;
      const predecessorReady = !predecessor || Boolean(
        predecessor.imageUrl && (predecessor.locked || predecessor.status === "IMAGE_APPROVED")
      );
      const generating = frame.status === "IMAGE_PENDING" || frame.status === "IMAGE_RUNNING";
      if (frame.imageUrl) {
        return {
          frame,
          kind: "wait" as const,
          label: hasActiveTask ? copy.waitingGeneration : copy.generated,
          disabled: true,
        };
      }
      if (generating && hasActiveTask) {
        return { frame, kind: "wait" as const, label: copy.waitingGeneration, disabled: true };
      }
      if (!predecessorReady) {
        return {
          frame,
          kind: "wait" as const,
          label: view === "back" ? copy.waitingSide : copy.waitingFront,
          disabled: true,
        };
      }
      return {
        frame,
        kind: "generate" as const,
        label: view === "front" ? copy.generateFront : view === "side" ? copy.generateSide : copy.generateBack,
        disabled: false,
      };
    }
    return { kind: "complete" as const, label: copy.completed, disabled: true };
  }, [copy, framesByView, hasActiveTask]);

  const selectedRegenerateFrame = framesByView.get(regenerateView);
  const selectedPredecessor = regenerateView === "side"
    ? framesByView.get("front")
    : regenerateView === "back"
      ? framesByView.get("side")
      : undefined;
  const selectedDependencyReady = !selectedPredecessor || Boolean(
    selectedPredecessor.imageUrl
    && (selectedPredecessor.locked || selectedPredecessor.status === "IMAGE_APPROVED")
  );
  const canRegenerateSelected = Boolean(
    selectedRegenerateFrame
    && !hasActiveTask
    && selectedDependencyReady
  );
  const regenerateSelectedLabel = hasActiveTask
    ? copy.waitingGeneration
    : !selectedDependencyReady
      ? regenerateView === "back" ? copy.regenerateSideFirst : copy.regenerateFrontFirst
      : copy.regenerateSelected;

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

  function startNewTask() {
    if (project) setResumeProject(project);
    setProject(null);
    setReferenceImageUrl("");
    setCharacterDescription("");
    setAspectRatio("9:16");
    setPose("neutral");
    setActionId("");
    setError("");
    setNotice("");
    setRegenerateView("front");
    window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  }

  async function continueLastTask() {
    if (!resumeProject) return;
    await loadProject(resumeProject.id);
  }

  async function createProject() {
    if (!referenceImageUrl || creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const data = await fetchJson("/api/character-turnarounds", {
        method: "POST",
        body: JSON.stringify({ referenceImageUrl, characterDescription, aspectRatio, pose }),
      });
      if (!data.project) throw new Error(data.error || copy.createFailed);
      setProject(data.project);
      setResumeProject(data.project);
      window.localStorage.setItem(PROJECT_STORAGE_KEY, data.project.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.createFailed);
    } finally {
      setCreating(false);
    }
  }

  async function regenerateFrame(frame: TurnaroundKeyframe) {
    if (!project || actionId) return;
    setActionId(`retry:${frame.id}`);
    setError("");
    setNotice("");
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
      const view = frame.assetView as AssetView;
      const label = view === "front" ? copy.front : view === "side" ? copy.side : copy.backView;
      setNotice(locale === "zh" ? `${label}图已进入生成队列。` : `${label} view has entered the generation queue.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : copy.actionFailed);
    } finally {
      setActionId("");
    }
  }

  async function downloadFrame(frame: TurnaroundKeyframe) {
    if (!frame.imageUrl || actionId) return;
    setActionId(`download:${frame.id}`);
    setError("");
    setDownloadNotice("");
    try {
      const response = await fetch(previewImageSrc(frame.imageUrl), { cache: "no-store" });
      if (!response.ok) throw new Error(`${copy.downloadFailed} (HTTP ${response.status})`);
      const blob = await response.blob();
      if (!blob.size) throw new Error(copy.downloadFailed);
      const extension = imageFileExtension(blob.type, frame.imageUrl);
      const view = frame.assetView === "side" ? "side" : frame.assetView === "back" ? "back" : "front";
      const mimeType = blob.type.startsWith("image/") ? blob.type : `image/${extension === "jpg" ? "jpeg" : extension}`;
      const saved = await saveFileWithPicker(blob, `character-turnaround-${view}.${extension}`, [{
        description: copy.download,
        accept: { [mimeType]: [`.${extension}`] },
      }]);
      if (saved) setDownloadNotice(copy.downloadSuccess);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : copy.downloadFailed);
    } finally {
      setActionId("");
    }
  }

  async function runNextAction() {
    if (!nextAction.frame || nextAction.disabled || actionId) return;
    if (nextAction.kind === "generate") {
      await regenerateFrame(nextAction.frame);
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
          {project ? (
            <button type="button" onClick={startNewTask} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/10 px-4 text-sm font-medium text-slate-200 transition hover:border-cyan-400/30 hover:bg-white/[0.06]">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {copy.newTask}
            </button>
          ) : resumeProject ? (
            <button type="button" onClick={() => void continueLastTask()} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/10 px-4 text-sm font-medium text-slate-200 transition hover:border-cyan-400/30 hover:bg-white/[0.06]">
              <History className="h-4 w-4" aria-hidden="true" />
              {copy.continueLast}
            </button>
          ) : null}
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
                <legend className="mb-2 text-sm font-semibold text-slate-100">{copy.pose}</legend>
                <div className="inline-flex rounded-md border border-white/10 bg-[#0b1426] p-1">
                  {(["neutral", "t_pose"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPose(value)}
                      className={`min-h-10 rounded px-3 text-sm transition ${pose === value ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:bg-white/[0.06] hover:text-white"}`}
                    >
                      {value === "t_pose" ? copy.tPose : copy.neutralPose}
                    </button>
                  ))}
                </div>
              </fieldset>
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
                <p className="mt-1 text-lg font-semibold text-white">{generatedCount}/3 {generatedCount === 3 ? `· ${copy.completed}` : ""}</p>
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

            <section className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <p className="text-xs font-medium uppercase text-slate-500">{copy.nextStep}</p>
                  <p className={`mt-1 text-sm ${notice ? "text-emerald-300" : hasActiveTask ? "text-cyan-300" : "text-slate-300"}`} role={notice ? "status" : undefined}>
                    {notice || (hasActiveTask ? copy.waitingGeneration : nextAction.label)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={nextAction.disabled || Boolean(actionId)}
                  onClick={() => void runNextAction()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cyan-500 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionId || hasActiveTask ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : nextAction.kind === "complete" ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Play className="h-4 w-4" aria-hidden="true" />
                  )}
                  {nextAction.label}
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="sr-only">{copy.selectRegenerateView}</span>
                  <select
                    value={regenerateView}
                    onChange={(event) => setRegenerateView(event.target.value as AssetView)}
                    className="min-h-11 rounded-md border border-white/10 bg-[#0b1426] px-3 text-sm text-slate-200 outline-none focus:border-cyan-400/50"
                    title={copy.selectRegenerateView}
                  >
                    <option value="front">{copy.front}</option>
                    <option value="side">{copy.side}</option>
                    <option value="back">{copy.backView}</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!canRegenerateSelected || Boolean(actionId)}
                  onClick={() => selectedRegenerateFrame && void regenerateFrame(selectedRegenerateFrame)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-white/10 px-4 text-sm font-medium text-slate-200 transition hover:border-cyan-400/30 hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {actionId === `retry:${selectedRegenerateFrame?.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {regenerateSelectedLabel}
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
                  projectGenerating={hasActiveTask}
                  aspectRatio={project.aspectRatio}
                  copy={copy}
                  busy={actionId}
                  onRegenerate={regenerateFrame}
                  onDownload={downloadFrame}
                />
              ))}
            </main>
          </>
        )}
      </div>
      {downloadNotice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 flex min-h-11 items-center gap-2 rounded-md border border-emerald-400/30 bg-[#0b1426] px-4 py-3 text-sm font-medium text-emerald-300 shadow-xl shadow-black/30"
        >
          <Check className="h-4 w-4" aria-hidden="true" />
          {downloadNotice}
        </div>
      )}
    </div>
  );
}

function TurnaroundCard({
  view,
  frame,
  framesByView,
  projectGenerating,
  aspectRatio,
  copy,
  busy,
  onRegenerate,
  onDownload,
}: {
  view: AssetView;
  frame?: TurnaroundKeyframe;
  framesByView: Map<AssetView, TurnaroundKeyframe>;
  projectGenerating: boolean;
  aspectRatio: TurnaroundProject["aspectRatio"];
  copy: typeof COPY.zh | typeof COPY.en;
  busy: string;
  onRegenerate: (frame: TurnaroundKeyframe) => Promise<void>;
  onDownload: (frame: TurnaroundKeyframe) => Promise<void>;
}) {
  const predecessor = view === "side" ? framesByView.get("front") : view === "back" ? framesByView.get("side") : undefined;
  const predecessorReady = !predecessor || Boolean(predecessor.imageUrl && (predecessor.locked || predecessor.status === "IMAGE_APPROVED"));
  const waitingText = view === "back" ? copy.waitingSide : copy.waitingFront;
  const label = view === "front" ? copy.front : view === "side" ? copy.side : copy.backView;
  const queuedByProject = Boolean(
    projectGenerating
    && predecessorReady
    && frame
    && !frame.imageUrl
    && frame.status === "SCRIPT_READY"
  );
  const isRunning = projectGenerating && (
    queuedByProject || frame?.status === "IMAGE_PENDING" || frame?.status === "IMAGE_RUNNING"
  );
  const generated = Boolean(frame?.imageUrl);
  const failed = frame?.status === "FAILED";
  const statusLabel = generated
    ? copy.generated
    : !predecessorReady
      ? waitingText
      : isRunning
        ? frame?.status === "IMAGE_RUNNING" ? copy.running : copy.queued
        : failed
          ? copy.failed
          : frame?.imageUrl
            ? copy.ready
            : copy.empty;
  const retrying = frame ? busy === `retry:${frame.id}` : false;
  const downloading = frame ? busy === `download:${frame.id}` : false;
  const ratioClass = aspectRatio === "16:9" ? "aspect-video" : aspectRatio === "1:1" ? "aspect-square" : "aspect-[9/16]";

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-md border border-white/10 bg-[#0b1426]">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded bg-cyan-400/10 text-xs font-semibold text-cyan-300">{VIEW_ORDER.indexOf(view) + 1}</span>
          <h2 className="text-sm font-semibold text-white">{label}</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs ${generated ? "text-emerald-300" : failed ? "text-red-300" : isRunning ? "text-cyan-300" : "text-slate-400"}`}>
          {generated ? <Check className="h-3.5 w-3.5" /> : isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
            <button type="button" disabled={Boolean(busy)} onClick={() => void onDownload(frame)} title={copy.download} className="grid h-11 w-11 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
          {frame && predecessorReady && !isRunning && (
            <button type="button" disabled={Boolean(busy)} title={copy.regenerate} onClick={() => void onRegenerate(frame)} className="grid h-11 w-11 place-items-center rounded-md text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-40">
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            </button>
          )}
        </div>
        {generated && <span className="inline-flex items-center gap-2 px-2 text-xs font-medium text-emerald-300"><Check className="h-4 w-4" />{copy.generated}</span>}
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

function imageFileExtension(contentType: string, sourceUrl: string): "png" | "jpg" | "webp" | "gif" | "avif" {
  const normalizedType = contentType.toLowerCase();
  if (normalizedType.includes("jpeg") || normalizedType.includes("jpg")) return "jpg";
  if (normalizedType.includes("webp")) return "webp";
  if (normalizedType.includes("gif")) return "gif";
  if (normalizedType.includes("avif")) return "avif";
  if (normalizedType.includes("png")) return "png";
  const pathname = (() => {
    try {
      return new URL(sourceUrl, window.location.origin).pathname.toLowerCase();
    } catch {
      return sourceUrl.toLowerCase();
    }
  })();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "jpg";
  if (pathname.endsWith(".webp")) return "webp";
  if (pathname.endsWith(".gif")) return "gif";
  if (pathname.endsWith(".avif")) return "avif";
  return "png";
}
