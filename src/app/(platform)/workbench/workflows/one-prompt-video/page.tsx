"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Clapperboard,
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Languages,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useLanguage } from "@workbench/lib/LanguageContext";

type ProjectStatus =
  | "DRAFT"
  | "PLANNING"
  | "PLAN_REVIEW"
  | "IMAGE_GENERATING"
  | "IMAGE_REVIEW"
  | "CLIP_GENERATING"
  | "CLIP_REVIEW"
  | "COMPOSING"
  | "FINAL_REVIEW"
  | "DONE"
  | "FAILED";

type ShotStatus =
  | "SCRIPT_READY"
  | "IMAGE_PENDING"
  | "IMAGE_RUNNING"
  | "IMAGE_READY"
  | "IMAGE_APPROVED"
  | "CLIP_PENDING"
  | "CLIP_RUNNING"
  | "CLIP_READY"
  | "CLIP_APPROVED"
  | "FAILED";

type AspectRatio = "9:16" | "16:9" | "1:1";
type PageLang = "zh" | "en";

interface VideoShot {
  id: string;
  shotNo: number;
  status: ShotStatus;
  durationSeconds: number;
  purpose: string;
  camera: string;
  action: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  negativePrompt: string;
  subtitle: string;
  imageUrl?: string | null;
  endImageUrl?: string | null;
  clipUrl?: string | null;
  qualityScore?: number | null;
  errorMessage?: string | null;
  locked: boolean;
  startKeyframeNo?: number;
  endKeyframeNo?: number;
  startTimeSeconds?: number;
  endTimeSeconds?: number;
}

interface VideoKeyframe {
  id: string;
  keyframeNo: number;
  timeSeconds: number;
  status: ShotStatus;
  purpose: string;
  imagePrompt: string;
  negativePrompt?: string;
  imageUrl?: string | null;
  locked: boolean;
}

interface VideoSegment {
  id: string;
  segmentNo: number;
  status: ShotStatus;
  startKeyframeNo: number;
  endKeyframeNo: number;
  durationSeconds: number;
  purpose?: string;
  motion?: string;
  camera?: string;
  videoPrompt?: string;
  subtitle?: string;
  clipUrl?: string | null;
}

interface VideoProject {
  id: string;
  status: ProjectStatus;
  title: string;
  userPrompt: string;
  referenceImageUrls: string[];
  aspectRatio: AspectRatio;
  durationSeconds: number;
  stylePreset: string;
  finalVideoUrl?: string | null;
  errorMessage?: string | null;
  updatedAt: string;
  keyframes?: VideoKeyframe[];
  segments?: VideoSegment[];
  shots: VideoShot[];
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  project?: VideoProject;
  projects?: VideoProject[];
}

type Copy = {
  title: string;
  defaultPrompt: string;
  updated: string;
  projects: string;
  newProject: string;
  noProjects: string;
  activeProject: string;
  referenceImages: string;
  uploadReference: string;
  uploadingReference: string;
  referenceImageHint: string;
  removeReference: string;
  renameProject: string;
  deleteProject: string;
  saveProject: string;
  cancel: string;
  saveKeyframe: string;
  projectRenamed: string;
  projectDeleted: string;
  deleteProjectConfirm: string;
  generatePlan: string;
  generating: string;
  approveScript: string;
  approveFrames: string;
  approveClips: string;
  confirmFinal: string;
  shots: string;
  frames: string;
  shot: string;
  noShot: string;
  untitled: string;
  purpose: string;
  action: string;
  camera: string;
  subtitle: string;
  imagePrompt: string;
  videoPrompt: string;
  clipPreview: string;
  keyframePreview: string;
  finalVideo: string;
  downloadClip: string;
  saveShot: string;
  regenerate: string;
  languageButton: string;
  planned: string;
  saved: (shotNo: number) => string;
  keyframesReady: string;
  keyframeRegenerated: string;
  framesApproved: string;
  clipsComposed: string;
  finalApproved: string;
  loadFailed: string;
  createFailed: string;
  planFailed: string;
  saveFailed: string;
  uploadReferenceFailed: string;
  keyframeFailed: string;
  regenerateFailed: string;
  lockFailed: string;
  approveFailed: string;
  actionFailed: string;
  emptyServer: string;
  nonJsonServer: string;
  requestFailed: (status: number) => string;
  styles: Record<string, string>;
  status: Record<ProjectStatus, string>;
  shotStatus: Record<ShotStatus, string>;
  stages: Record<string, string>;
};

const TEXT: Record<PageLang, Copy> = {
  zh: {
    title: "\u4e00\u53e5\u8bdd\u6210\u7247\u5de5\u4f5c\u53f0",
    defaultPrompt: "\u505a\u4e00\u6761 30 \u79d2\u56fd\u98ce\u62a4\u80a4\u54c1\u5e7f\u544a\uff0c\u4e3b\u89d2\u5728\u6e05\u6668\u5ead\u9662\u4f7f\u7528\u4ea7\u54c1\uff0c\u8d28\u611f\u9ad8\u7ea7\u3002",
    updated: "\u66f4\u65b0",
    projects: "\u9879\u76ee",
    newProject: "\u65b0\u5efa\u9879\u76ee",
    noProjects: "\u6682\u65e0\u9879\u76ee",
    activeProject: "\u5f53\u524d",
    referenceImages: "\u8f85\u52a9\u53c2\u8003\u56fe",
    uploadReference: "\u4e0a\u4f20\u53c2\u8003\u56fe",
    uploadingReference: "\u4e0a\u4f20\u4e2d",
    referenceImageHint: "\u53ef\u4e0a\u4f20\u4ea7\u54c1\u3001\u4eba\u7269\u3001\u573a\u666f\u6216\u98ce\u683c\u53c2\u8003\u56fe\uff0c\u6700\u591a 4 \u5f20\uff0c\u751f\u6210\u5206\u955c\u65f6\u4f1a\u4e00\u8d77\u7ed9\u5927\u6a21\u578b\u7406\u89e3\u3002",
    removeReference: "\u79fb\u9664\u53c2\u8003\u56fe",
    renameProject: "\u91cd\u547d\u540d",
    deleteProject: "\u5220\u9664",
    saveProject: "\u4fdd\u5b58",
    cancel: "\u53d6\u6d88",
    saveKeyframe: "\u4fdd\u5b58\u5173\u952e\u5e27",
    projectRenamed: "\u9879\u76ee\u5df2\u91cd\u547d\u540d",
    projectDeleted: "\u9879\u76ee\u5df2\u5220\u9664",
    deleteProjectConfirm: "\u786e\u5b9a\u5220\u9664\u8fd9\u4e2a\u9879\u76ee\u5417\uff1f\u5df2\u751f\u6210\u7684\u5206\u955c\u3001\u56fe\u7247\u548c\u7247\u6bb5\u8bb0\u5f55\u4f1a\u4e00\u8d77\u79fb\u9664\u3002",
    generatePlan: "\u751f\u6210\u5206\u955c\u8ba1\u5212",
    generating: "\u751f\u6210\u4e2d",
    approveScript: "\u786e\u8ba4\u811a\u672c",
    approveFrames: "\u786e\u8ba4\u5173\u952e\u5e27",
    approveClips: "\u786e\u8ba4\u7247\u6bb5\u5e76\u5408\u6210",
    confirmFinal: "\u786e\u8ba4\u6210\u7247",
    shots: "\u955c\u5934",
    frames: "\u5173\u952e\u5e27",
    shot: "\u955c\u5934",
    noShot: "\u6682\u65e0\u9009\u4e2d\u955c\u5934",
    untitled: "\u672a\u547d\u540d\u9879\u76ee",
    purpose: "\u955c\u5934\u76ee\u7684",
    action: "\u52a8\u4f5c\u8bf4\u660e",
    camera: "\u8fd0\u955c",
    subtitle: "\u5b57\u5e55",
    imagePrompt: "\u56fe\u7247 Prompt",
    videoPrompt: "\u89c6\u9891 Prompt",
    clipPreview: "\u5206\u955c\u7247\u6bb5",
    keyframePreview: "\u5173\u952e\u5e27",
    finalVideo: "\u6700\u7ec8\u6210\u7247",
    downloadClip: "\u4e0b\u8f7d\u5206\u955c\u89c6\u9891",
    saveShot: "\u4fdd\u5b58\u955c\u5934",
    regenerate: "\u91cd\u751f\u6210",
    languageButton: "EN",
    planned: "\u5206\u955c\u811a\u672c\u5df2\u751f\u6210",
    saved: (shotNo) => `\u955c\u5934 ${shotNo} \u5df2\u4fdd\u5b58`,
    keyframesReady: "\u5173\u952e\u5e27\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u6b63\u5728\u8f6e\u8be2\u7ed3\u679c",
    keyframeRegenerated: "\u5173\u952e\u5e27\u5df2\u91cd\u751f\u6210",
    framesApproved: "\u5173\u952e\u5e27\u5df2\u786e\u8ba4\uff0c\u89c6\u9891\u7247\u6bb5\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4",
    clipsComposed: "\u7247\u6bb5\u5df2\u786e\u8ba4\uff0cIMS \u5408\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4",
    finalApproved: "\u6210\u7247\u5df2\u786e\u8ba4\uff0c\u9879\u76ee\u5df2\u5b8c\u6210",
    loadFailed: "\u9879\u76ee\u52a0\u8f7d\u5931\u8d25",
    createFailed: "\u9879\u76ee\u521b\u5efa\u5931\u8d25",
    planFailed: "\u5206\u955c\u89c4\u5212\u5931\u8d25",
    saveFailed: "\u4fdd\u5b58\u5931\u8d25",
    uploadReferenceFailed: "\u53c2\u8003\u56fe\u4e0a\u4f20\u5931\u8d25",
    keyframeFailed: "\u5173\u952e\u5e27\u751f\u6210\u5931\u8d25",
    regenerateFailed: "\u91cd\u751f\u6210\u5931\u8d25",
    lockFailed: "\u9501\u5b9a\u72b6\u6001\u66f4\u65b0\u5931\u8d25",
    approveFailed: "\u786e\u8ba4\u5931\u8d25",
    actionFailed: "\u64cd\u4f5c\u5931\u8d25",
    emptyServer: "\u670d\u52a1\u7aef\u8fd4\u56de\u4e3a\u7a7a",
    nonJsonServer: "\u670d\u52a1\u7aef\u8fd4\u56de\u4e86\u975e JSON \u5185\u5bb9",
    requestFailed: (status) => `\u8bf7\u6c42\u5931\u8d25 ${status}`,
    styles: {
      cinematic: "\u7535\u5f71\u5e7f\u544a",
      product: "\u4ea7\u54c1\u5c55\u793a",
      guofeng: "\u56fd\u98ce\u8d28\u611f",
      short_drama: "\u77ed\u5267\u53d9\u4e8b",
      ecommerce: "\u7535\u5546\u79cd\u8349",
    },
    status: {
      DRAFT: "\u8349\u7a3f",
      PLANNING: "\u89c4\u5212\u4e2d",
      PLAN_REVIEW: "\u811a\u672c\u5ba1\u6838",
      IMAGE_GENERATING: "\u5173\u952e\u5e27\u751f\u6210",
      IMAGE_REVIEW: "\u5173\u952e\u5e27\u5ba1\u6838",
      CLIP_GENERATING: "\u89c6\u9891\u751f\u6210",
      CLIP_REVIEW: "\u7247\u6bb5\u5ba1\u6838",
      COMPOSING: "\u5408\u6210\u4e2d",
      FINAL_REVIEW: "\u6210\u7247\u5ba1\u6838",
      DONE: "\u5df2\u5b8c\u6210",
      FAILED: "\u5931\u8d25",
    },
    shotStatus: {
      SCRIPT_READY: "\u811a\u672c",
      IMAGE_PENDING: "\u5f85\u51fa\u56fe",
      IMAGE_RUNNING: "\u51fa\u56fe\u4e2d",
      IMAGE_READY: "\u5f85\u5ba1\u6838",
      IMAGE_APPROVED: "\u5df2\u9501\u5b9a",
      CLIP_PENDING: "\u5f85\u89c6\u9891",
      CLIP_RUNNING: "\u89c6\u9891\u4e2d",
      CLIP_READY: "\u7247\u6bb5\u5c31\u7eea",
      CLIP_APPROVED: "\u7247\u6bb5\u9501\u5b9a",
      FAILED: "\u5931\u8d25",
    },
    stages: {
      PLAN_REVIEW: "\u811a\u672c",
      IMAGE_REVIEW: "\u5173\u952e\u5e27",
      CLIP_REVIEW: "\u7247\u6bb5",
      FINAL_REVIEW: "\u6210\u7247",
    },
  },
  en: {
    title: "One Prompt Video Studio",
    defaultPrompt: "Create a 30-second premium guofeng skincare ad. The main character uses the product in a quiet morning courtyard.",
    updated: "Updated",
    projects: "Projects",
    newProject: "New project",
    noProjects: "No projects",
    activeProject: "Active",
    referenceImages: "Reference images",
    uploadReference: "Upload references",
    uploadingReference: "Uploading",
    referenceImageHint: "Upload product, character, scene, or style references. Up to 4 images will be passed to the storyboard model.",
    removeReference: "Remove reference",
    renameProject: "Rename",
    deleteProject: "Delete",
    saveProject: "Save",
    cancel: "Cancel",
    saveKeyframe: "Save keyframe",
    projectRenamed: "Project renamed",
    projectDeleted: "Project deleted",
    deleteProjectConfirm: "Delete this project? Storyboard, frame, and clip records will be removed.",
    generatePlan: "Generate plan",
    generating: "Generating",
    approveScript: "Approve script",
    approveFrames: "Approve frames",
    approveClips: "Approve clips and compose",
    confirmFinal: "Approve final",
    shots: "Shots",
    frames: "frames",
    shot: "Shot",
    noShot: "No shot selected",
    untitled: "Untitled project",
    purpose: "Purpose",
    action: "Action",
    camera: "Camera",
    subtitle: "Subtitle",
    imagePrompt: "Image prompt",
    videoPrompt: "Video prompt",
    clipPreview: "Clip preview",
    keyframePreview: "Keyframe",
    finalVideo: "Final video",
    downloadClip: "Download clip",
    saveShot: "Save shot",
    regenerate: "Regenerate",
    languageButton: "\u4e2d\u6587",
    planned: "Storyboard plan generated",
    saved: (shotNo) => `Shot ${shotNo} saved`,
    keyframesReady: "Keyframe generation tasks submitted. Polling results.",
    keyframeRegenerated: "Keyframe regenerated",
    framesApproved: "Keyframes approved. Clip generation tasks submitted.",
    clipsComposed: "Clips approved. IMS composition task submitted.",
    finalApproved: "Final approved. Project is complete.",
    loadFailed: "Load failed",
    createFailed: "Create failed",
    planFailed: "Plan failed",
    saveFailed: "Save failed",
    uploadReferenceFailed: "Reference image upload failed",
    keyframeFailed: "Keyframe generation failed",
    regenerateFailed: "Regenerate failed",
    lockFailed: "Lock update failed",
    approveFailed: "Approve failed",
    actionFailed: "Action failed",
    emptyServer: "Empty server response",
    nonJsonServer: "Server returned a non-JSON response",
    requestFailed: (status) => `Request failed ${status}`,
    styles: {
      cinematic: "Cinematic ad",
      product: "Product",
      guofeng: "Guofeng",
      short_drama: "Short drama",
      ecommerce: "E-commerce",
    },
    status: {
      DRAFT: "Draft",
      PLANNING: "Planning",
      PLAN_REVIEW: "Script review",
      IMAGE_GENERATING: "Keyframes",
      IMAGE_REVIEW: "Image review",
      CLIP_GENERATING: "Clips",
      CLIP_REVIEW: "Clip review",
      COMPOSING: "Composing",
      FINAL_REVIEW: "Final review",
      DONE: "Done",
      FAILED: "Failed",
    },
    shotStatus: {
      SCRIPT_READY: "Script",
      IMAGE_PENDING: "Image pending",
      IMAGE_RUNNING: "Image running",
      IMAGE_READY: "Image ready",
      IMAGE_APPROVED: "Locked",
      CLIP_PENDING: "Clip pending",
      CLIP_RUNNING: "Clip running",
      CLIP_READY: "Clip ready",
      CLIP_APPROVED: "Clip locked",
      FAILED: "Failed",
    },
    stages: {
      PLAN_REVIEW: "Script",
      IMAGE_REVIEW: "Frames",
      CLIP_REVIEW: "Clips",
      FINAL_REVIEW: "Final",
    },
  },
};

const STAGES = [
  { key: "PLAN_REVIEW", icon: FileText },
  { key: "IMAGE_REVIEW", icon: ImageIcon },
  { key: "CLIP_REVIEW", icon: Clapperboard },
  { key: "FINAL_REVIEW", icon: Check },
] as const;

const DEFAULT_PROMPTS = [TEXT.zh.defaultPrompt, TEXT.en.defaultPrompt];
const PROJECT_STORAGE_KEY = "one-prompt-video-active-project-id";
const RUNNING_PROJECT_STATUSES: ProjectStatus[] = ["IMAGE_GENERATING", "CLIP_GENERATING", "COMPOSING"];

export default function OnePromptVideoPage() {
  const { lang, toggleLang } = useLanguage();
  const pageLang: PageLang = lang === "en" ? "en" : "zh";
  const copy = TEXT[pageLang];
  const [prompt, setPrompt] = useState(copy.defaultPrompt);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [stylePreset, setStylePreset] = useState("guofeng");
  const [shotCount, setShotCount] = useState(6);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [project, setProject] = useState<VideoProject | null>(null);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("");
  const [draft, setDraft] = useState<Partial<VideoShot>>({});
  const [keyframeDraft, setKeyframeDraft] = useState<Partial<VideoKeyframe>>({});
  const [loading, setLoading] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selectedShot = useMemo(
    () => project?.shots.find((shot) => shot.id === selectedShotId) ?? project?.shots[0],
    [project, selectedShotId],
  );
  const selectedKeyframe = useMemo(
    () => project?.keyframes?.find((keyframe) => keyframe.id === selectedKeyframeId),
    [project?.keyframes, selectedKeyframeId],
  );
  const keyframeByNo = useMemo(
    () => new Map((project?.keyframes ?? []).map((keyframe) => [keyframe.keyframeNo, keyframe])),
    [project?.keyframes],
  );
  const selectedStartKeyframe = selectedShot?.startKeyframeNo ? keyframeByNo.get(selectedShot.startKeyframeNo) : undefined;
  const selectedEndKeyframe = selectedShot?.endKeyframeNo ? keyframeByNo.get(selectedShot.endKeyframeNo) : undefined;
  const keyframeTotal = project?.keyframes?.length || project?.shots.length || 0;
  const segmentTotal = project?.segments?.length || project?.shots.length || 0;
  const completeImages = project?.keyframes?.length
    ? project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project?.shots.filter((shot) => Boolean(shot.imageUrl)).length ?? 0;
  const completeClips = project?.segments?.length
    ? project.segments.filter((segment) => Boolean(segment.clipUrl) || segment.status === "CLIP_READY" || segment.status === "CLIP_APPROVED").length
    : project?.shots.filter((shot) => Boolean(shot.clipUrl) || shot.status === "CLIP_READY" || shot.status === "CLIP_APPROVED").length ?? 0;
  const runningProjectIds = useMemo(
    () => projects.filter((item) => RUNNING_PROJECT_STATUSES.includes(item.status)).map((item) => item.id),
    [projects],
  );
  const canApproveScript = Boolean(project && project.shots.length > 0 && project.status === "PLAN_REVIEW");
  const canApproveFrames = Boolean(project && keyframeTotal > 0 && completeImages === keyframeTotal && project.status === "IMAGE_REVIEW");
  const canApproveClips = Boolean(project && segmentTotal > 0 && completeClips === segmentTotal && project.status === "CLIP_REVIEW");
  const canConfirmFinal = Boolean(project && project.status === "FINAL_REVIEW");

  useEffect(() => {
    setPrompt((current) => (DEFAULT_PROMPTS.includes(current) ? copy.defaultPrompt : current));
  }, [copy.defaultPrompt]);

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!project?.shots.length) return;
    if (!selectedShotId || !project.shots.some((shot) => shot.id === selectedShotId)) {
      setSelectedShotId(project.shots[0].id);
    }
  }, [project, selectedShotId]);

  useEffect(() => {
    if (!selectedKeyframeId) return;
    if (!project?.keyframes?.some((keyframe) => keyframe.id === selectedKeyframeId)) {
      setSelectedKeyframeId("");
    }
  }, [project, selectedKeyframeId]);

  useEffect(() => {
    if (!selectedShot) return;
    setDraft({
      purpose: selectedShot.purpose,
      camera: selectedShot.camera,
      action: selectedShot.action,
      imagePrompt: localizedShotPrompt(selectedShot, "image", pageLang),
      videoPrompt: localizedShotPrompt(selectedShot, "video", pageLang),
      negativePrompt: selectedShot.negativePrompt,
      subtitle: selectedShot.subtitle,
      durationSeconds: selectedShot.durationSeconds,
    });
  }, [selectedShot, pageLang]);

  useEffect(() => {
    if (!selectedKeyframe) return;
    setKeyframeDraft({
      purpose: selectedKeyframe.purpose,
      imagePrompt: selectedKeyframe.imagePrompt,
      negativePrompt: selectedKeyframe.negativePrompt ?? "",
    });
  }, [selectedKeyframe]);

  const rememberProject = useCallback((nextProject: VideoProject) => {
    setProjects((current) => sortProjects(upsertProject(current, nextProject)));
    setProject((current) => {
      if (current?.id === nextProject.id || selectedProjectId === nextProject.id) return nextProject;
      return current;
    });
  }, [selectedProjectId]);

  const syncProject = useCallback(async (projectId: string, options?: { silent?: boolean }) => {
    try {
      const res = await fetchJson(`/api/video-projects/${projectId}/sync`, copy, { method: "POST" });
      if (res.project) rememberProject(res.project);
    } catch (err) {
      if (!options?.silent) setError(err instanceof Error ? err.message : copy.actionFailed);
    }
  }, [copy, rememberProject]);

  useEffect(() => {
    if (!runningProjectIds.length) return;
    const timer = window.setInterval(() => {
      for (const projectId of runningProjectIds) void syncProject(projectId, { silent: projectId !== selectedProjectId });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [runningProjectIds, selectedProjectId, syncProject]);

  async function loadProjects() {
    try {
      const res = await fetchJson("/api/video-projects", copy);
      const nextProjects = sortProjects(res.projects ?? []);
      setProjects(nextProjects);
      if (!nextProjects.length) return;
      const storedId = typeof window !== "undefined" ? window.localStorage.getItem(PROJECT_STORAGE_KEY) || "" : "";
      const active = nextProjects.find((item) => item.id === storedId) ?? nextProjects[0];
      activateProject(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadFailed);
    }
  }

  function activateProject(nextProject: VideoProject) {
    setSelectedProjectId(nextProject.id);
    setProject(nextProject);
    setSelectedShotId(nextProject.shots[0]?.id ?? "");
    setSelectedKeyframeId("");
    setPrompt(nextProject.userPrompt);
    setReferenceImageUrls(nextProject.referenceImageUrls ?? []);
    setAspectRatio(nextProject.aspectRatio);
    setStylePreset(nextProject.stylePreset || "cinematic");
    if (typeof window !== "undefined") window.localStorage.setItem(PROJECT_STORAGE_KEY, nextProject.id);
  }

  function beginEditProject(nextProject: VideoProject) {
    setEditingProjectId(nextProject.id);
    setEditingTitle(nextProject.title || nextProject.userPrompt.slice(0, 32));
  }

  function cancelEditProject() {
    setEditingProjectId("");
    setEditingTitle("");
  }

  async function saveProjectTitle(projectId: string) {
    const title = editingTitle.trim();
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${projectId}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      cancelEditProject();
      setMessage(copy.projectRenamed);
    });
  }

  async function deleteProject(projectId: string) {
    if (typeof window !== "undefined" && !window.confirm(copy.deleteProjectConfirm)) return;
    await runAction(async () => {
      await fetchJson(`/api/video-projects/${projectId}`, copy, { method: "DELETE" });
      const remainingProjects = sortProjects(projects.filter((item) => item.id !== projectId));
      setProjects(remainingProjects);
      cancelEditProject();
      if (selectedProjectId === projectId) {
        const nextProject = remainingProjects[0];
        if (nextProject) {
          activateProject(nextProject);
        } else {
          setSelectedProjectId("");
          setProject(null);
          setSelectedShotId("");
          setSelectedKeyframeId("");
          setDraft({});
          setKeyframeDraft({});
          setPrompt(copy.defaultPrompt);
          setReferenceImageUrls([]);
          setAspectRatio("9:16");
          setStylePreset("guofeng");
          setShotCount(6);
          if (typeof window !== "undefined") window.localStorage.removeItem(PROJECT_STORAGE_KEY);
        }
      }
      setMessage(copy.projectDeleted);
    });
  }

  function startNewProject() {
    setSelectedProjectId("");
    setProject(null);
    setSelectedShotId("");
    setSelectedKeyframeId("");
    setDraft({});
    setKeyframeDraft({});
    cancelEditProject();
    setPrompt(copy.defaultPrompt);
    setReferenceImageUrls([]);
    setAspectRatio("9:16");
    setStylePreset("guofeng");
    setShotCount(6);
    setError("");
    setMessage("");
    if (typeof window !== "undefined") window.localStorage.removeItem(PROJECT_STORAGE_KEY);
  }

  async function uploadReferenceImages(files: FileList | null) {
    if (!files?.length) return;
    const remaining = Math.max(0, 4 - referenceImageUrls.length);
    const images = Array.from(files).filter((file) => file.type.startsWith("image/")).slice(0, remaining);
    if (!images.length) return;
    setUploadingReferences(true);
    setError("");
    setMessage("");
    try {
      const uploaded: string[] = [];
      for (const file of images) {
        uploaded.push(await uploadReferenceImage(file));
      }
      setReferenceImageUrls((current) => [...current, ...uploaded].slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.uploadReferenceFailed);
    } finally {
      setUploadingReferences(false);
    }
  }

  function removeReferenceImage(url: string) {
    setReferenceImageUrls((current) => current.filter((item) => item !== url));
  }

  async function createAndPlan() {
    await runAction(async () => {
      const created = await fetchJson("/api/video-projects", copy, {
        method: "POST",
        body: JSON.stringify({ userPrompt: prompt, aspectRatio, durationSeconds: 30, shotCount, stylePreset, referenceImageUrls }),
      });
      if (!created.project) throw new Error(copy.createFailed);
      const planned = await fetchJson(`/api/video-projects/${created.project.id}/plan`, copy, {
        method: "POST",
        body: JSON.stringify({ userPrompt: prompt, aspectRatio, durationSeconds: 30, shotCount, stylePreset, referenceImageUrls }),
      });
      if (!planned.project) throw new Error(copy.planFailed);
      rememberProject(planned.project);
      activateProject(planned.project);
      setMessage(copy.planned);
    });
  }

  async function saveShot() {
    if (!project || !selectedShot) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${selectedShot.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({
          purpose: draft.purpose,
          camera: draft.camera,
          action: draft.action,
          videoPrompt: draft.videoPrompt,
          negativePrompt: draft.negativePrompt,
          subtitle: draft.subtitle,
          durationSeconds: draft.durationSeconds,
          locale: pageLang,
        }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(copy.saved(selectedShot.shotNo));
    });
  }

  async function saveKeyframe() {
    if (!project || !selectedKeyframe) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${selectedKeyframe.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ ...keyframeDraft, locale: pageLang }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(copy.saveKeyframe);
    });
  }

  async function approvePlan() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-plan`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.keyframeFailed);
      rememberProject(res.project);
      setMessage(copy.keyframesReady);
    });
  }

  async function regenerateImage(shotId: string) {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${shotId}/image`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.regenerateFailed);
      rememberProject(res.project);
      setMessage(copy.keyframeRegenerated);
    });
  }

  async function toggleLock(shot: VideoShot) {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/shots/${shot.id}`, copy, {
        method: "PATCH",
        body: JSON.stringify({ locked: !shot.locked }),
      });
      if (!res.project) throw new Error(copy.lockFailed);
      rememberProject(res.project);
    });
  }

  async function approveImages() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-images`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.framesApproved);
    });
  }

  async function approveClips() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/compose`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.clipsComposed);
    });
  }

  async function confirmFinal() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/finish`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.finalApproved);
    });
  }

  async function runAction(action: () => Promise<void>) {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.actionFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              ONE_PROMPT_30S_VIDEO
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-white">{copy.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
            >
              <Languages className="h-4 w-4" />
              {copy.languageButton}
            </button>
            {project && (
              <>
                <span className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200">{copy.status[project.status]}</span>
                <span className="text-slate-500">{copy.updated} {new Date(project.updatedAt).toLocaleString()}</span>
              </>
            )}
          </div>
        </header>

        <section className="space-y-3 border-b border-white/10 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-300">
              <FolderOpen className="h-4 w-4 text-cyan-300" />
              {copy.projects}
              <span className="rounded-md border border-white/10 px-2 py-0.5 text-xs text-slate-500">{projects.length}</span>
            </div>
            <button
              type="button"
              onClick={startNewProject}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:bg-white/[0.08]"
            >
              <Plus className="h-4 w-4" />
              {copy.newProject}
            </button>
          </div>
          {projects.length ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {projects.map((item) => {
                const progress = projectProgress(item);
                const active = item.id === project?.id;
                const editing = editingProjectId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`min-h-28 rounded-md border px-3 py-3 transition ${active ? "border-cyan-400/60 bg-cyan-400/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      {editing ? (
                        <input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveProjectTitle(item.id);
                            if (event.key === "Escape") cancelEditProject();
                          }}
                          className="min-w-0 flex-1 rounded-md border border-cyan-400/40 bg-slate-950 px-2 py-1.5 text-sm font-semibold text-white outline-none"
                          autoFocus
                        />
                      ) : (
                        <button type="button" onClick={() => activateProject(item)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-semibold text-white">{item.title || copy.untitled}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">{item.userPrompt}</p>
                        </button>
                      )}
                      <div className="flex shrink-0 items-center gap-1">
                        {active && <span className="rounded-md border border-cyan-400/30 px-2 py-0.5 text-[11px] text-cyan-100">{copy.activeProject}</span>}
                        {editing ? (
                          <>
                            <button type="button" onClick={() => saveProjectTitle(item.id)} disabled={loading} title={copy.saveProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-emerald-400/30 text-emerald-200 hover:bg-emerald-400/10 disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={cancelEditProject} disabled={loading} title={copy.cancel} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06] disabled:opacity-50">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" onClick={() => beginEditProject(item)} disabled={loading} title={copy.renameProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06] disabled:opacity-50">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => deleteProject(item.id)} disabled={loading} title={copy.deleteProject} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-400/20 text-red-200 hover:bg-red-400/10 disabled:opacity-50">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="text-slate-400">{copy.status[item.status]}</span>
                      <span className="text-slate-500">{copy.frames} {progress.images}/{progress.imageTotal} / {copy.stages.CLIP_REVIEW} {progress.clips}/{progress.clipTotal}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-cyan-400" style={{ width: `${progress.percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-white/10 px-4 py-4 text-sm text-slate-500">{copy.noProjects}</div>
          )}
        </section>

        <section className="grid gap-3 border-b border-white/10 pb-5 lg:grid-cols-[minmax(0,1fr)_170px_150px_120px]">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-24 resize-none rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm leading-6 text-slate-100 outline-none focus:border-cyan-400" />
          <select value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400">
            {Object.entries(copy.styles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)} className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400">
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
          <input
            type="number"
            min={2}
            max={10}
            step={1}
            value={shotCount}
            onChange={(event) => setShotCount(clampShotCount(Number(event.target.value)))}
            onBlur={() => setShotCount((value) => clampShotCount(value))}
            aria-label={copy.shots}
            className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400"
          />
          <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3 lg:col-span-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">{copy.referenceImages}</p>
                <p className="mt-1 text-xs text-slate-500">{copy.referenceImageHint}</p>
              </div>
              <label className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-white/10 px-3 text-sm font-medium text-slate-200 hover:bg-white/[0.08] ${referenceImageUrls.length >= 4 || uploadingReferences ? "pointer-events-none opacity-50" : "bg-white/[0.04]"}`}>
                {uploadingReferences ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-4 w-4" />}
                {uploadingReferences ? copy.uploadingReference : copy.uploadReference}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={referenceImageUrls.length >= 4 || uploadingReferences}
                  onChange={(event) => {
                    void uploadReferenceImages(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            {referenceImageUrls.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {referenceImageUrls.map((url) => (
                  <div key={url} className="group relative overflow-hidden rounded-md border border-white/10 bg-slate-900">
                    <img src={url} alt={copy.referenceImages} className="h-28 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReferenceImage(url)}
                      title={copy.removeReference}
                      className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-black/30 bg-black/60 text-white opacity-90 hover:bg-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="lg:col-span-4">
            <button type="button" onClick={createAndPlan} disabled={loading || prompt.trim().length < 4} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? copy.generating : copy.generatePlan}
            </button>
          </div>
        </section>

        {(error || message || project?.errorMessage) && (
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm">
            {error && <p className="text-red-300">{error}</p>}
            {message && <p className="text-emerald-300">{message}</p>}
            {project?.errorMessage && <p className="text-amber-300">{project.errorMessage}</p>}
          </div>
        )}

        {project && (
          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[250px_minmax(0,1fr)_360px]">
            <aside className="border-r border-white/10 pr-4">
              <div className="mb-4 grid grid-cols-4 gap-2">
                {STAGES.map((stage) => {
                  const Icon = stage.icon;
                  const active = stage.key === project.status;
                  return (
                    <div key={stage.key} className={`flex h-16 flex-col items-center justify-center rounded-md border text-xs ${active ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.03] text-slate-500"}`}>
                      <Icon className="mb-1 h-4 w-4" />
                      {copy.stages[stage.key]}
                    </div>
                  );
                })}
              </div>
              <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                <span>{copy.shots}</span>
                <span>{completeImages}/{keyframeTotal} {copy.frames} / {completeClips}/{segmentTotal} {copy.stages.CLIP_REVIEW}</span>
              </div>
              <div className="space-y-2">
                {project.shots.map((shot) => (
                  <button key={shot.id} type="button" onClick={() => { setSelectedShotId(shot.id); setSelectedKeyframeId(""); }} className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${!selectedKeyframe && selectedShot?.id === shot.id ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"}`}>
                    <span className="font-medium">{copy.shot} {String(shot.shotNo).padStart(2, "0")}</span>
                    <span className="text-xs text-slate-500">{copy.shotStatus[shot.status]}</span>
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-w-0 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold text-white">{project.title || copy.untitled}</h2>
                  <p className="mt-1 text-sm text-slate-500">{project.durationSeconds}s / {project.aspectRatio} / {keyframeTotal} {copy.frames} / {segmentTotal} {copy.shots}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={approvePlan} disabled={loading || !canApproveScript} className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 text-sm font-medium text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-50">
                    <ImageIcon className="h-4 w-4" /> {copy.approveScript}
                  </button>
                  <button type="button" onClick={approveImages} disabled={loading || !canApproveFrames} className="inline-flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-slate-200 hover:bg-white/[0.08] disabled:opacity-50">
                    <Check className="h-4 w-4" /> {copy.approveFrames}
                  </button>
                  <button type="button" onClick={approveClips} disabled={loading || !canApproveClips} className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-50">
                    <Clapperboard className="h-4 w-4" /> {copy.approveClips}
                  </button>
                  <button type="button" onClick={confirmFinal} disabled={loading || !canConfirmFinal || project.status === "DONE"} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 hover:bg-amber-300/15 disabled:opacity-50">
                    <Check className="h-4 w-4" /> {copy.confirmFinal}
                  </button>
                </div>
              </div>

              {project.finalVideoUrl && (
                <section className="space-y-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
                    <Clapperboard className="h-4 w-4" />
                    {copy.finalVideo}
                  </div>
                  <video src={project.finalVideoUrl} controls playsInline preload="metadata" className={`w-full rounded-md border border-white/10 bg-black ${aspectClass(project.aspectRatio)}`} />
                </section>
              )}

              {project.keyframes?.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-200">{copy.frames} {completeImages}/{keyframeTotal}</h3>
                    <span className="text-xs text-slate-500">{keyframeTotal} boundary keyframes</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {project.keyframes.map((keyframe) => (
                      <div key={keyframe.id} className={`overflow-hidden rounded-md border bg-white/[0.03] ${selectedKeyframe?.id === keyframe.id ? "border-cyan-400/60" : "border-white/10"}`}>
                        <button type="button" onClick={() => setSelectedKeyframeId(keyframe.id)} className={`relative block w-full bg-slate-900 text-left ${aspectClass(project.aspectRatio)}`}>
                          {keyframe.imageUrl ? (
                            <img src={keyframe.imageUrl} alt={`KF ${keyframe.keyframeNo}`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-600">KF{String(keyframe.keyframeNo).padStart(2, "0")}</div>
                          )}
                          <span className="absolute left-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                            KF{String(keyframe.keyframeNo).padStart(2, "0")} · {keyframe.timeSeconds}s
                          </span>
                          <span className="absolute right-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                            {copy.shotStatus[keyframe.status]}
                          </span>
                        </button>
                        <div className="space-y-2 px-3 py-3">
                          <p className="text-sm font-semibold text-white">{keyframe.purpose}</p>
                          <p className="line-clamp-4 text-xs leading-5 text-slate-400">{keyframe.imagePrompt}</p>
                          <button type="button" onClick={() => regenerateImage(keyframe.id)} disabled={loading || keyframe.locked} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50">
                            <RefreshCw className="h-3.5 w-3.5" /> {copy.regenerate}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">{copy.shots} {completeClips}/{segmentTotal}</h3>
                  <span className="text-xs text-slate-500">{segmentTotal} first-last-frame clips</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {project.shots.map((shot) => (
                  <div key={shot.id} className="overflow-hidden rounded-md border border-white/10 bg-white/[0.03]">
                    <div className={`relative bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {shot.clipUrl ? (
                        <video src={shot.clipUrl} controls playsInline preload="metadata" poster={shot.imageUrl || undefined} className="h-full w-full object-cover" />
                      ) : (
                        <button type="button" onClick={() => { setSelectedShotId(shot.id); setSelectedKeyframeId(""); }} className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.shot} {String(shot.shotNo).padStart(2, "0")}</span>
                          {shot.startKeyframeNo && shot.endKeyframeNo && (
                            <span className="text-xs text-cyan-200/80">KF{String(shot.startKeyframeNo).padStart(2, "0")} - KF{String(shot.endKeyframeNo).padStart(2, "0")}</span>
                          )}
                        </button>
                      )}
                      <span className="absolute left-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                        {shot.clipUrl ? copy.clipPreview : copy.videoPrompt}
                      </span>
                    </div>
                    <div className="space-y-2 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white">{copy.shot} {String(shot.shotNo).padStart(2, "0")}</p>
                        <span className="text-xs text-slate-500">{shot.durationSeconds}s</span>
                      </div>
                      {shot.startKeyframeNo && shot.endKeyframeNo && (
                        <p className="text-xs text-cyan-200/80">KF{String(shot.startKeyframeNo).padStart(2, "0")} - KF{String(shot.endKeyframeNo).padStart(2, "0")}</p>
                      )}
                      <p className="min-h-10 overflow-hidden text-sm leading-5 text-slate-400">{shot.purpose}</p>
                      <p className="line-clamp-4 text-xs leading-5 text-slate-500">{localizedShotPrompt(shot, "video", pageLang)}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => regenerateImage(shot.id)} disabled={loading || shot.locked} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> {copy.regenerate}</button>
                        {shot.clipUrl && (
                          <a href={shotClipDownloadUrl(project.id, shot.id)} title={copy.downloadClip} className="inline-flex h-8 w-10 items-center justify-center rounded-md border border-cyan-400/30 text-cyan-100 hover:bg-cyan-400/10">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button type="button" onClick={() => toggleLock(shot)} disabled={loading} className="inline-flex h-8 w-10 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/[0.06]">{shot.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}</button>
                      </div>
                    </div>
                  </div>
                ))}
                </div>
              </section>
            </main>

            <aside className="border-l border-white/10 pl-4">
              {selectedKeyframe ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">KF{String(selectedKeyframe.keyframeNo).padStart(2, "0")}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{copy.shotStatus[selectedKeyframe.status]}</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">{copy.keyframePreview}</p>
                    <div className={`overflow-hidden rounded-md border border-white/10 bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {selectedKeyframe.imageUrl ? (
                        <img src={selectedKeyframe.imageUrl} alt={`KF ${selectedKeyframe.keyframeNo}`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-600">KF{String(selectedKeyframe.keyframeNo).padStart(2, "0")}</div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">KF{String(selectedKeyframe.keyframeNo).padStart(2, "0")} · {selectedKeyframe.timeSeconds}s</p>
                  </div>
                  <Field label={copy.purpose}><textarea value={String(keyframeDraft.purpose ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, purpose: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.imagePrompt}><textarea value={String(keyframeDraft.imagePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, imagePrompt: event.target.value }))} className="min-h-40 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label="Negative Prompt"><textarea value={String(keyframeDraft.negativePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, negativePrompt: event.target.value }))} className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <div className="flex gap-2">
                    <button type="button" onClick={saveKeyframe} disabled={loading} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-cyan-500 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"><Save className="h-4 w-4" /> {copy.saveKeyframe}</button>
                    <button type="button" onClick={() => regenerateImage(selectedKeyframe.id)} disabled={loading || selectedKeyframe.locked} className="inline-flex h-10 w-12 items-center justify-center rounded-md border border-white/10 text-slate-300 hover:bg-white/[0.06] disabled:opacity-50"><RefreshCw className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : selectedShot ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{copy.shot} {String(selectedShot.shotNo).padStart(2, "0")}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{copy.shotStatus[selectedShot.status]}</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">{selectedShot.clipUrl ? copy.clipPreview : copy.videoPrompt}</p>
                    <div className={`overflow-hidden rounded-md border border-white/10 bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {selectedShot.clipUrl ? (
                        <video src={selectedShot.clipUrl} controls playsInline preload="metadata" poster={selectedShot.imageUrl || undefined} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-600">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.clipPreview}</span>
                        </div>
                      )}
                    </div>
                    {selectedShot.startKeyframeNo && selectedShot.endKeyframeNo && (
                      <p className="text-xs text-slate-500">KF{String(selectedShot.startKeyframeNo).padStart(2, "0")} - KF{String(selectedShot.endKeyframeNo).padStart(2, "0")}</p>
                    )}
                    {(selectedStartKeyframe || selectedEndKeyframe) && (
                      <div className="grid grid-cols-2 gap-2">
                        {[selectedStartKeyframe, selectedEndKeyframe].map((keyframe) => (
                          <div key={keyframe?.id ?? "empty"} className="overflow-hidden rounded-md border border-white/10 bg-slate-900">
                            <div className={`relative ${aspectClass(project.aspectRatio)}`}>
                              {keyframe?.imageUrl ? (
                                <img src={keyframe.imageUrl} alt={`KF ${keyframe.keyframeNo}`} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-600">KF</div>
                              )}
                              {keyframe && (
                                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                  KF{String(keyframe.keyframeNo).padStart(2, "0")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {selectedShot.clipUrl && (
                      <a href={shotClipDownloadUrl(project.id, selectedShot.id)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15">
                        <Download className="h-4 w-4" />
                        {copy.downloadClip}
                      </a>
                    )}
                  </div>
                  <Field label={copy.purpose}><textarea value={String(draft.purpose ?? "")} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.action}><textarea value={String(draft.action ?? "")} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.camera}><input value={String(draft.camera ?? "")} onChange={(event) => setDraft((current) => ({ ...current, camera: event.target.value }))} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.subtitle}><input value={String(draft.subtitle ?? "")} onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.videoPrompt}><textarea value={String(draft.videoPrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, videoPrompt: event.target.value }))} className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <button type="button" onClick={saveShot} disabled={loading} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-500 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"><Save className="h-4 w-4" /> {copy.saveShot}</button>
                </div>
              ) : <div className="py-12 text-center text-sm text-slate-500">{copy.noShot}</div>}
            </aside>
          </section>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}

function sortProjects(items: VideoProject[]): VideoProject[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function upsertProject(items: VideoProject[], nextProject: VideoProject): VideoProject[] {
  const exists = items.some((item) => item.id === nextProject.id);
  if (!exists) return [nextProject, ...items];
  return items.map((item) => (item.id === nextProject.id ? nextProject : item));
}

function aspectClass(aspectRatio: AspectRatio): string {
  if (aspectRatio === "16:9") return "aspect-video";
  if (aspectRatio === "1:1") return "aspect-square";
  return "aspect-[9/16]";
}

function shotClipDownloadUrl(projectId: string, shotId: string): string {
  return `/api/video-projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(shotId)}/download`;
}

function localizedShotPrompt(shot: VideoShot, kind: "image" | "video", lang: PageLang): string {
  if (kind === "image") {
    return lang === "en"
      ? shot.imagePromptEn || shot.imagePrompt
      : shot.imagePromptZh || shot.imagePrompt;
  }
  return lang === "en"
    ? shot.videoPromptEn || shot.videoPrompt
    : shot.videoPromptZh || shot.videoPrompt;
}

function clampShotCount(value: number): number {
  if (!Number.isFinite(value)) return 6;
  return Math.max(2, Math.min(10, Math.round(value)));
}

function projectProgress(project: VideoProject): { images: number; clips: number; imageTotal: number; clipTotal: number; percent: number } {
  const imageTotal = project.keyframes?.length || project.shots.length;
  const clipTotal = project.segments?.length || project.shots.length;
  const safeImageTotal = Math.max(1, imageTotal);
  const safeClipTotal = Math.max(1, clipTotal);
  const images = project.keyframes?.length
    ? project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project.shots.filter((shot) => Boolean(shot.imageUrl)).length;
  const clips = project.segments?.length
    ? project.segments.filter((segment) => Boolean(segment.clipUrl) || segment.status === "CLIP_READY" || segment.status === "CLIP_APPROVED").length
    : project.shots.filter((shot) => Boolean(shot.clipUrl) || shot.status === "CLIP_READY" || shot.status === "CLIP_APPROVED").length;
  const stageWeight: Record<ProjectStatus, number> = {
    DRAFT: 0,
    PLANNING: 5,
    PLAN_REVIEW: 15,
    IMAGE_GENERATING: 20 + (images / safeImageTotal) * 25,
    IMAGE_REVIEW: 50,
    CLIP_GENERATING: 55 + (clips / safeClipTotal) * 30,
    CLIP_REVIEW: 86,
    COMPOSING: 92,
    FINAL_REVIEW: 97,
    DONE: 100,
    FAILED: Math.max(10, Math.round(((images / safeImageTotal + clips / safeClipTotal) / 2) * 85)),
  };
  return { images, clips, imageTotal, clipTotal, percent: Math.round(stageWeight[project.status] ?? 0) };
}

async function fetchJson(path: string, copy: Copy, init?: RequestInit): Promise<ApiResponse> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: ApiResponse;
  try {
    json = text ? (JSON.parse(text) as ApiResponse) : { ok: false, error: copy.emptyServer };
  } catch {
    json = { ok: false, error: text.slice(0, 240) || copy.nonJsonServer };
  }
  if (!res.ok || !json.ok) throw new Error(json.error || copy.requestFailed(res.status));
  return json;
}

async function uploadReferenceImage(file: File): Promise<string> {
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream" }),
  });
  const presignText = await presignRes.text();
  let presignJson: { uploadUrl?: string; publicUrl?: string; error?: string };
  try {
    presignJson = presignText ? JSON.parse(presignText) : {};
  } catch {
    presignJson = { error: presignText.slice(0, 240) };
  }
  if (!presignRes.ok || !presignJson.uploadUrl || !presignJson.publicUrl) {
    throw new Error(presignJson.error || `Upload presign failed ${presignRes.status}`);
  }

  const uploadRes = await fetch(presignJson.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(`Upload failed ${uploadRes.status}`);
  return presignJson.publicUrl;
}
