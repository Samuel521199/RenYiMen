"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  | "MICRO_SHOT_REVIEW"
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
type ProjectView = "frames" | "clips" | "final";
type OptimisticProgressPhase = "creating" | "understanding" | "storyboard" | "prompts" | "waiting" | "done" | "failed";

interface OptimisticProgress {
  active: boolean;
  phase: OptimisticProgressPhase;
  percent: number;
  startedAt: number;
}

interface WorkflowProgressView {
  percent: number;
  title: string;
  detail: string;
  tone: "running" | "success" | "failed" | "idle";
}

interface TimedPrompt {
  timeSeconds: number;
  startSeconds?: number;
  endSeconds?: number;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

interface MicroShot {
  microShotNo: number;
  localTimeSeconds: number;
  endSeconds?: number;
  absoluteTimeSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  scene: string;
  action: string;
  camera?: string;
  referenceType?: "text" | "image_prompt" | "mixed";
  imagePrompt?: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  imageUrl?: string;
  imageTaskId?: string;
  imageStatus?: "idle" | "pending" | "running" | "ready" | "failed";
  errorMessage?: string;
  prompt: string;
  promptZh?: string;
  promptEn?: string;
}

interface AudioPlan {
  mode: "ambient" | "voiceover" | "dialogue" | "mixed" | "silent";
  needsVoiceover: boolean;
  needsDialogue: boolean;
  language?: string;
  speaker?: string;
  voiceStyle?: string;
  lines?: string[];
  linesZh?: string[];
  linesEn?: string[];
  rationale?: string;
}

interface VideoShot {
  id: string;
  shotNo: number;
  status: ShotStatus;
  durationSeconds: number;
  purpose: string;
  purposeZh?: string;
  purposeEn?: string;
  camera: string;
  action: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  videoPrompt: string;
  videoPromptZh?: string;
  videoPromptEn?: string;
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut" | string;
  outputMode?: string;
  constraints?: string[];
  timedPrompts?: TimedPrompt[];
  microShots?: MicroShot[];
  audioPlan?: AudioPlan;
  negativePrompt: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
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
  purposeZh?: string;
  purposeEn?: string;
  imagePrompt: string;
  imagePromptZh?: string;
  imagePromptEn?: string;
  negativePrompt?: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
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
  boundaryMode?: "continuous" | "hard_cut" | "dissolve" | "match_cut" | string;
  purpose?: string;
  purposeZh?: string;
  purposeEn?: string;
  motion?: string;
  camera?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
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
  approveMicroShots: string;
  approveClips: string;
  confirmFinal: string;
  shots: string;
  frames: string;
  boundaryFrameHint: string;
  autoShotPlan: string;
  autoShotPlanHint: string;
  segmentDurationPolicy: string;
  totalDuration: string;
  totalDurationHint: string;
  duration: string;
  boundaryMode: string;
  outputMode: string;
  constraints: string;
  timedPrompts: string;
  microShots: string;
  microShot: string;
  microShotHint: string;
  addMicroShot: string;
  generateMicroShotImage: string;
  regenerateMicroShotImage: string;
  microShotImageHint: string;
  microShotImageRunning: string;
  microShotImageFailed: string;
  audioPlan: string;
  spokenLines: string;
  referenceType: string;
  scene: string;
  prompt: string;
  shot: string;
  noShot: string;
  untitled: string;
  purpose: string;
  action: string;
  camera: string;
  subtitle: string;
  subtitleHint: string;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  clipPreview: string;
  keyframePreview: string;
  finalVideo: string;
  preview: string;
  ready: string;
  pending: string;
  finalVideoNotReady: string;
  firstLastFrameClips: string;
  downloadClip: string;
  saveShot: string;
  regenerate: string;
  languageButton: string;
  planned: string;
  saved: (shotNo: number) => string;
  keyframesReady: string;
  keyframeRegenerated: string;
  framesApproved: string;
  microShotsApproved: string;
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
    saveKeyframe: "\u4fdd\u5b58\u8fb9\u754c\u53c2\u8003\u5e27",
    projectRenamed: "\u9879\u76ee\u5df2\u91cd\u547d\u540d",
    projectDeleted: "\u9879\u76ee\u5df2\u5220\u9664",
    deleteProjectConfirm: "\u786e\u5b9a\u5220\u9664\u8fd9\u4e2a\u9879\u76ee\u5417\uff1f\u5df2\u751f\u6210\u7684\u5206\u955c\u3001\u56fe\u7247\u548c\u7247\u6bb5\u8bb0\u5f55\u4f1a\u4e00\u8d77\u79fb\u9664\u3002",
    generatePlan: "\u751f\u6210\u5206\u955c\u8ba1\u5212",
    generating: "\u751f\u6210\u4e2d",
    approveScript: "\u786e\u8ba4\u811a\u672c",
    approveFrames: "\u786e\u8ba4\u8fb9\u754c\u53c2\u8003\u5e27",
    approveMicroShots: "\u786e\u8ba4\u5185\u90e8\u5b50\u5206\u955c",
    approveClips: "\u786e\u8ba4\u7247\u6bb5\u5e76\u5408\u6210",
    confirmFinal: "\u786e\u8ba4\u6210\u7247",
    shots: "\u955c\u5934",
    frames: "\u8fb9\u754c\u53c2\u8003\u5e27",
    boundaryFrameHint: "\u9759\u6001\u9996\u5c3e\u5e27\u53c2\u8003\u56fe\uff0c\u4e0d\u662f\u89c6\u9891\u65f6\u957f",
    autoShotPlan: "AI \u81ea\u52a8\u62c6\u955c",
    autoShotPlanHint: "\u5927\u6a21\u578b\u4f1a\u6309\u5267\u60c5\u81ea\u4e3b\u51b3\u5b9a\u955c\u5934\u6570\uff0cHappyHorse \u6bcf\u6bb5 3-15s",
    segmentDurationPolicy: "\u6bcf\u6bb5 3-15s",
    totalDuration: "\u603b\u65f6\u957f",
    totalDurationHint: "\u6210\u7247\u603b\u65f6\u957f\uff0c\u9ed8\u8ba4 30s",
    duration: "\u65f6\u957f",
    boundaryMode: "\u8fb9\u754c\u8f6c\u573a",
    outputMode: "\u8f93\u51fa\u7ea6\u675f",
    constraints: "\u9650\u5236",
    timedPrompts: "\u65f6\u95f4\u70b9\u63d0\u793a",
    microShots: "\u7247\u6bb5\u5185\u90e8\u5b50\u5206\u955c",
    microShot: "\u5b50\u5206\u955c",
    microShotHint: "\u7528\u4e8e\u9650\u5236\u8fd9\u4e00\u6bb5\u89c6\u9891\u5185\u90e8\u7684\u573a\u666f\u3001\u52a8\u4f5c\u3001\u955c\u5934\u548c\u53ef\u9009\u53c2\u8003\u56fe Prompt\uff0c\u4e0d\u662f\u989d\u5916\u89c6\u9891\u7247\u6bb5",
    addMicroShot: "\u6dfb\u52a0\u5b50\u5206\u955c",
    generateMicroShotImage: "\u751f\u6210\u53c2\u8003\u56fe",
    regenerateMicroShotImage: "\u91cd\u751f\u6210\u53c2\u8003\u56fe",
    microShotImageHint: "\u9009\u62e9 image_prompt / mixed \u540e\uff0c\u53ef\u5c06\u56fe\u7247 Prompt \u751f\u6210\u4e3a\u53ef\u9884\u89c8\u7684\u5185\u90e8\u53c2\u8003\u56fe",
    microShotImageRunning: "\u53c2\u8003\u56fe\u751f\u6210\u4e2d",
    microShotImageFailed: "\u53c2\u8003\u56fe\u751f\u6210\u5931\u8d25",
    audioPlan: "\u58f0\u97f3\u89c4\u5212",
    spokenLines: "\u53f0\u8bcd/\u65c1\u767d",
    referenceType: "\u53c2\u8003\u7c7b\u578b",
    scene: "\u573a\u666f",
    prompt: "Prompt",
    shot: "\u955c\u5934",
    noShot: "\u6682\u65e0\u9009\u4e2d\u955c\u5934",
    untitled: "\u672a\u547d\u540d\u9879\u76ee",
    purpose: "\u955c\u5934\u76ee\u7684",
    action: "\u52a8\u4f5c\u8bf4\u660e",
    camera: "\u8fd0\u955c",
    subtitle: "\u5b57\u5e55",
    subtitleHint: "\u53ef\u81ea\u5b9a\u4e49\u4fee\u6539\uff0c\u7528\u4e8e\u540e\u671f\u53e0\u52a0/\u5ba1\u6838\uff1b\u5efa\u8bae 8-18 \u5b57\uff0c\u6700\u591a 24 \u5b57",
    imagePrompt: "\u56fe\u7247 Prompt",
    videoPrompt: "\u89c6\u9891 Prompt",
    negativePrompt: "\u53cd\u5411\u63d0\u793a\u8bcd\uff08\u907f\u514d\u51fa\u73b0\uff09",
    clipPreview: "\u5206\u955c\u7247\u6bb5",
    keyframePreview: "\u8fb9\u754c\u53c2\u8003\u5e27",
    finalVideo: "\u6700\u7ec8\u6210\u7247",
    preview: "\u9884\u89c8",
    ready: "\u5df2\u5b8c\u6210",
    pending: "\u5f85\u5904\u7406",
    finalVideoNotReady: "\u6700\u7ec8\u6210\u7247\u5c1a\u672a\u751f\u6210\u3002",
    firstLastFrameClips: "\u9996\u5c3e\u5e27\u5206\u955c\u7247\u6bb5",
    downloadClip: "\u4e0b\u8f7d\u5206\u955c\u89c6\u9891",
    saveShot: "\u4fdd\u5b58\u955c\u5934",
    regenerate: "\u91cd\u751f\u6210",
    languageButton: "EN",
    planned: "\u5206\u955c\u811a\u672c\u5df2\u751f\u6210",
    saved: (shotNo) => `\u955c\u5934 ${shotNo} \u5df2\u4fdd\u5b58`,
    keyframesReady: "\u8fb9\u754c\u53c2\u8003\u5e27\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u6b63\u5728\u8f6e\u8be2\u7ed3\u679c",
    keyframeRegenerated: "\u8fb9\u754c\u53c2\u8003\u5e27\u5df2\u91cd\u751f\u6210",
    framesApproved: "\u8fb9\u754c\u53c2\u8003\u5e27\u5df2\u786e\u8ba4\uff0c\u8bf7\u5ba1\u6838\u5185\u90e8\u5b50\u5206\u955c\u6587\u5b57\u548c\u53c2\u8003\u56fe",
    microShotsApproved: "\u5185\u90e8\u5b50\u5206\u955c\u5df2\u786e\u8ba4\uff0c\u89c6\u9891\u7247\u6bb5\u751f\u6210\u4efb\u52a1\u5df2\u63d0\u4ea4",
    clipsComposed: "\u7247\u6bb5\u5df2\u786e\u8ba4\uff0c\u6210\u7247\u5df2\u5408\u6210",
    finalApproved: "\u6210\u7247\u5df2\u786e\u8ba4\uff0c\u9879\u76ee\u5df2\u5b8c\u6210",
    loadFailed: "\u9879\u76ee\u52a0\u8f7d\u5931\u8d25",
    createFailed: "\u9879\u76ee\u521b\u5efa\u5931\u8d25",
    planFailed: "\u5206\u955c\u89c4\u5212\u5931\u8d25",
    saveFailed: "\u4fdd\u5b58\u5931\u8d25",
    uploadReferenceFailed: "\u53c2\u8003\u56fe\u4e0a\u4f20\u5931\u8d25",
    keyframeFailed: "\u8fb9\u754c\u53c2\u8003\u5e27\u751f\u6210\u5931\u8d25",
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
      IMAGE_GENERATING: "\u8fb9\u754c\u5e27\u751f\u6210",
      IMAGE_REVIEW: "\u8fb9\u754c\u5e27\u5ba1\u6838",
      MICRO_SHOT_REVIEW: "\u5b50\u5206\u955c\u5ba1\u6838",
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
      IMAGE_REVIEW: "\u8fb9\u754c\u5e27",
      MICRO_SHOT_REVIEW: "\u5b50\u5206\u955c",
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
    saveKeyframe: "Save boundary frame",
    projectRenamed: "Project renamed",
    projectDeleted: "Project deleted",
    deleteProjectConfirm: "Delete this project? Storyboard, frame, and clip records will be removed.",
    generatePlan: "Generate plan",
    generating: "Generating",
    approveScript: "Approve script",
    approveFrames: "Approve boundary frames",
    approveMicroShots: "Approve internal micro-shots",
    approveClips: "Approve clips and compose",
    confirmFinal: "Approve final",
    shots: "Shots",
    frames: "boundary frames",
    boundaryFrameHint: "Static first/end-frame reference images, not video durations",
    autoShotPlan: "AI decides shots",
    autoShotPlanHint: "The storyboard model chooses the count by story rhythm. HappyHorse clips are 3-15s each.",
    segmentDurationPolicy: "3-15s per clip",
    totalDuration: "Total duration",
    totalDurationHint: "Final video duration, default 30s",
    duration: "Duration",
    boundaryMode: "Boundary mode",
    outputMode: "Output mode",
    constraints: "Constraints",
    timedPrompts: "Timed prompts",
    microShots: "Internal micro-shots",
    microShot: "Micro-shot",
    microShotHint: "Controls scene, action, camera, and optional reference-image prompts inside this one video segment. These are not extra video clips.",
    addMicroShot: "Add micro-shot",
    generateMicroShotImage: "Generate reference image",
    regenerateMicroShotImage: "Regenerate reference image",
    microShotImageHint: "Choose image_prompt or mixed to turn the image prompt into a previewable internal reference image.",
    microShotImageRunning: "Reference image generating",
    microShotImageFailed: "Reference image failed",
    audioPlan: "Audio plan",
    spokenLines: "Spoken lines",
    referenceType: "Reference type",
    scene: "Scene",
    prompt: "Prompt",
    shot: "Shot",
    noShot: "No shot selected",
    untitled: "Untitled project",
    purpose: "Purpose",
    action: "Action",
    camera: "Camera",
    subtitle: "Subtitle",
    subtitleHint: "Custom editable overlay copy for review/composition. Aim for 3-8 words, max 72 characters.",
    imagePrompt: "Image prompt",
    videoPrompt: "Video prompt",
    negativePrompt: "Negative prompt",
    clipPreview: "Clip preview",
    keyframePreview: "Boundary frame",
    finalVideo: "Final video",
    preview: "Preview",
    ready: "ready",
    pending: "pending",
    finalVideoNotReady: "Final video is not ready yet.",
    firstLastFrameClips: "first-last-frame clips",
    downloadClip: "Download clip",
    saveShot: "Save shot",
    regenerate: "Regenerate",
    languageButton: "\u4e2d\u6587",
    planned: "Storyboard plan generated",
    saved: (shotNo) => `Shot ${shotNo} saved`,
    keyframesReady: "Boundary reference frame generation tasks submitted. Polling results.",
    keyframeRegenerated: "Boundary reference frame regenerated",
    framesApproved: "Boundary reference frames approved. Review internal micro-shot text and reference images next.",
    microShotsApproved: "Internal micro-shots approved. Clip generation tasks submitted.",
    clipsComposed: "Clips approved. Final video composed.",
    finalApproved: "Final approved. Project is complete.",
    loadFailed: "Load failed",
    createFailed: "Create failed",
    planFailed: "Plan failed",
    saveFailed: "Save failed",
    uploadReferenceFailed: "Reference image upload failed",
    keyframeFailed: "Boundary reference frame generation failed",
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
      IMAGE_GENERATING: "Boundary frames",
      IMAGE_REVIEW: "Boundary frame review",
      MICRO_SHOT_REVIEW: "Micro-shot review",
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
      MICRO_SHOT_REVIEW: "Micro-shots",
      CLIP_REVIEW: "Clips",
      FINAL_REVIEW: "Final",
    },
  },
};

const STAGES = [
  { key: "PLAN_REVIEW", icon: FileText },
  { key: "IMAGE_REVIEW", icon: ImageIcon },
  { key: "MICRO_SHOT_REVIEW", icon: FileText },
  { key: "CLIP_REVIEW", icon: Clapperboard },
  { key: "FINAL_REVIEW", icon: Check },
] as const;

const DEFAULT_PROMPTS = [TEXT.zh.defaultPrompt, TEXT.en.defaultPrompt];
const PROJECT_STORAGE_KEY = "one-prompt-video-active-project-id";
const DETAIL_PANEL_WIDTH_STORAGE_KEY = "one-prompt-video-detail-panel-width";
const DETAIL_PANEL_MIN_WIDTH = 280;
const DETAIL_PANEL_MAX_WIDTH = 720;
const RUNNING_PROJECT_STATUSES: ProjectStatus[] = ["IMAGE_GENERATING", "CLIP_GENERATING", "COMPOSING"];

function clampProjectDuration(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(3, Math.min(180, Math.round(value)));
}

function clampDetailPanelWidth(value: number): number {
  if (!Number.isFinite(value)) return 360;
  return Math.max(DETAIL_PANEL_MIN_WIDTH, Math.min(DETAIL_PANEL_MAX_WIDTH, Math.round(value)));
}

export default function OnePromptVideoPage() {
  const { lang, toggleLang } = useLanguage();
  const pageLang: PageLang = lang === "en" ? "en" : "zh";
  const copy = TEXT[pageLang];
  const [prompt, setPrompt] = useState(copy.defaultPrompt);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [durationSeconds, setDurationSeconds] = useState(30);
  const [stylePreset, setStylePreset] = useState("guofeng");
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [editingProjectId, setEditingProjectId] = useState("");
  const [editingTitle, setEditingTitle] = useState("");
  const [project, setProject] = useState<VideoProject | null>(null);
  const [selectedShotId, setSelectedShotId] = useState("");
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("");
  const [previewKeyframeId, setPreviewKeyframeId] = useState("");
  const [projectView, setProjectView] = useState<ProjectView>("clips");
  const [draft, setDraft] = useState<Partial<VideoShot>>({});
  const [keyframeDraft, setKeyframeDraft] = useState<Partial<VideoKeyframe>>({});
  const [loading, setLoading] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [optimisticProgress, setOptimisticProgress] = useState<OptimisticProgress | null>(null);
  const [detailPanelWidth, setDetailPanelWidth] = useState(360);
  const [resizingDetailPanel, setResizingDetailPanel] = useState(false);
  const projectLayoutRef = useRef<HTMLElement | null>(null);

  const selectedShot = useMemo(
    () => project?.shots.find((shot) => shot.id === selectedShotId) ?? project?.shots[0],
    [project, selectedShotId],
  );
  const selectedKeyframe = useMemo(
    () => project?.keyframes?.find((keyframe) => keyframe.id === selectedKeyframeId),
    [project?.keyframes, selectedKeyframeId],
  );
  const previewKeyframe = useMemo(
    () => project?.keyframes?.find((keyframe) => keyframe.id === previewKeyframeId),
    [project?.keyframes, previewKeyframeId],
  );
  const keyframeByNo = useMemo(
    () => new Map((project?.keyframes ?? []).map((keyframe) => [keyframe.keyframeNo, keyframe])),
    [project?.keyframes],
  );
  const selectedStartKeyframe = selectedShot?.startKeyframeNo ? keyframeByNo.get(selectedShot.startKeyframeNo) : undefined;
  const selectedEndKeyframe = selectedShot?.endKeyframeNo ? keyframeByNo.get(selectedShot.endKeyframeNo) : undefined;
  const keyframeTotal = project?.keyframes?.length || project?.shots.length || 0;
  const previewTotalDuration = project?.durationSeconds ?? previewKeyframe?.timeSeconds ?? 30;
  const segmentTotal = project?.segments?.length || project?.shots.length || 0;
  const completeImages = project?.keyframes?.length
    ? project.keyframes.filter((keyframe) => Boolean(keyframe.imageUrl)).length
    : project?.shots.filter((shot) => Boolean(shot.imageUrl)).length ?? 0;
  const completeClips = project?.segments?.length
    ? project.segments.filter((segment) => Boolean(segment.clipUrl) || segment.status === "CLIP_READY" || segment.status === "CLIP_APPROVED").length
    : project?.shots.filter((shot) => Boolean(shot.clipUrl) || shot.status === "CLIP_READY" || shot.status === "CLIP_APPROVED").length ?? 0;
  const microShotImageStats = project ? microShotImageProgress(project) : { required: 0, ready: 0, running: 0, failed: 0, missing: 0 };
  const keyframesApproved = Boolean(project?.keyframes?.length && project.keyframes.every((keyframe) => keyframe.status === "IMAGE_APPROVED" || keyframe.locked));
  const runningProjectIds = useMemo(
    () => projects
      .filter((item) => RUNNING_PROJECT_STATUSES.includes(item.status) || hasRunningMicroShotImage(item))
      .map((item) => item.id),
    [projects],
  );
  const canApproveScript = Boolean(project && project.shots.length > 0 && project.status === "PLAN_REVIEW");
  const canApproveFrames = Boolean(project && keyframeTotal > 0 && completeImages === keyframeTotal && project.status === "IMAGE_REVIEW" && !keyframesApproved);
  const canApproveMicroShots = Boolean(project && (project.status === "MICRO_SHOT_REVIEW" || (project.status === "IMAGE_REVIEW" && keyframesApproved)) && microShotImageStats.running === 0 && microShotImageStats.failed === 0 && microShotImageStats.missing === 0);
  const canApproveClips = Boolean(project && segmentTotal > 0 && completeClips === segmentTotal && project.status === "CLIP_REVIEW");
  const canConfirmFinal = Boolean(project && project.status === "FINAL_REVIEW");
  const workflowProgress = useMemo(() => {
    if (optimisticProgress) return optimisticWorkflowProgressView(optimisticProgress, pageLang);
    if (!project) return null;
    return projectWorkflowProgressView(project, projectProgress(project), pageLang);
  }, [optimisticProgress, pageLang, project]);
  const workflowProgressBarClass =
    workflowProgress?.tone === "failed"
      ? "bg-red-400"
      : workflowProgress?.tone === "success"
        ? "bg-emerald-400"
        : "bg-cyan-400";
  const workflowProgressBorderClass =
    workflowProgress?.tone === "failed"
      ? "border-red-400/25 bg-red-400/10"
      : workflowProgress?.tone === "success"
        ? "border-emerald-400/25 bg-emerald-400/10"
        : "border-cyan-400/25 bg-cyan-400/10";

  useEffect(() => {
    setPrompt((current) => (DEFAULT_PROMPTS.includes(current) ? copy.defaultPrompt : current));
  }, [copy.defaultPrompt]);

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(DETAIL_PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved > 0) setDetailPanelWidth(clampDetailPanelWidth(saved));
  }, []);

  useEffect(() => {
    if (!resizingDetailPanel) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onPointerMove(event: PointerEvent) {
      const rect = projectLayoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDetailPanelWidth(clampDetailPanelWidth(rect.right - event.clientX));
    }

    function onPointerUp() {
      setResizingDetailPanel(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [resizingDetailPanel]);

  useEffect(() => {
    window.localStorage.setItem(DETAIL_PANEL_WIDTH_STORAGE_KEY, String(detailPanelWidth));
  }, [detailPanelWidth]);

  useEffect(() => {
    if (!optimisticProgress?.active) return;
    const timer = window.setInterval(() => {
      setOptimisticProgress((current) => {
        if (!current?.active) return current;
        const next = estimatePlanningProgress(Date.now() - current.startedAt);
        return {
          ...current,
          phase: next.phase,
          percent: Math.max(current.percent, next.percent),
        };
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [optimisticProgress?.active]);

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
    if (!previewKeyframeId) return;
    if (!project?.keyframes?.some((keyframe) => keyframe.id === previewKeyframeId)) {
      setPreviewKeyframeId("");
    }
  }, [project, previewKeyframeId]);

  useEffect(() => {
    if (!previewKeyframeId) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewKeyframeId("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewKeyframeId]);

  useEffect(() => {
    if (!selectedShot) return;
    setDraft({
      purpose: localizedShotPurpose(selectedShot, pageLang),
      camera: selectedShot.camera,
      action: selectedShot.action,
      imagePrompt: localizedShotPrompt(selectedShot, "image", pageLang),
      videoPrompt: localizedShotPrompt(selectedShot, "video", pageLang),
      negativePrompt: localizedShotNegativePrompt(selectedShot, pageLang),
      subtitle: selectedShot.subtitle,
      durationSeconds: selectedShot.durationSeconds,
      microShots: selectedShot.microShots ?? [],
    });
  }, [selectedShot, pageLang]);

  useEffect(() => {
    if (!selectedKeyframe) return;
    setKeyframeDraft({
      purpose: localizedKeyframePurpose(selectedKeyframe, pageLang),
      imagePrompt: localizedKeyframeImagePrompt(selectedKeyframe, pageLang),
      negativePrompt: localizedKeyframeNegativePrompt(selectedKeyframe, pageLang),
    });
  }, [selectedKeyframe, pageLang]);

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
    setProjectView(nextProject.finalVideoUrl ? "final" : "clips");
    setPrompt(nextProject.userPrompt);
    setReferenceImageUrls(nextProject.referenceImageUrls ?? []);
    setAspectRatio(nextProject.aspectRatio);
    setDurationSeconds(nextProject.durationSeconds || 30);
    setStylePreset(nextProject.stylePreset || "cinematic");
    if (typeof window !== "undefined") window.localStorage.setItem(PROJECT_STORAGE_KEY, nextProject.id);
  }

  function selectShot(shotId: string) {
    setProjectView("clips");
    setSelectedShotId(shotId);
    setSelectedKeyframeId("");
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
          setDurationSeconds(30);
          setStylePreset("guofeng");
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
    setDurationSeconds(30);
    setStylePreset("guofeng");
    setError("");
    setMessage("");
    setOptimisticProgress(null);
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
    let completed = false;
    setOptimisticProgress({ active: true, phase: "creating", percent: 3, startedAt: Date.now() });
    await runAction(async () => {
      const totalDurationSeconds = clampProjectDuration(durationSeconds);
      const created = await fetchJson("/api/video-projects", copy, {
        method: "POST",
        body: JSON.stringify({ userPrompt: prompt, aspectRatio, durationSeconds: totalDurationSeconds, stylePreset, referenceImageUrls }),
      });
      if (!created.project) throw new Error(copy.createFailed);
      const planned = await fetchJson(`/api/video-projects/${created.project.id}/plan`, copy, {
        method: "POST",
        body: JSON.stringify({ userPrompt: prompt, aspectRatio, durationSeconds: totalDurationSeconds, stylePreset, referenceImageUrls }),
      });
      if (!planned.project) throw new Error(copy.planFailed);
      rememberProject(planned.project);
      activateProject(planned.project);
      completed = true;
      setOptimisticProgress({ active: false, phase: "done", percent: 100, startedAt: Date.now() });
      window.setTimeout(() => {
        setOptimisticProgress((current) => (current?.phase === "done" ? null : current));
      }, 1200);
      setMessage(copy.planned);
    });
    if (!completed) {
      setOptimisticProgress((current) => current && current.phase !== "done"
        ? { ...current, active: false, phase: "failed", percent: Math.max(current.percent, 8) }
        : current,
      );
    }
  }

  function updateDraftMicroShot(index: number, patch: Partial<MicroShot>) {
    setDraft((current) => {
      const items = [...((current.microShots as MicroShot[] | undefined) ?? [])];
      const existing = items[index];
      if (!existing) return current;
      items[index] = { ...existing, ...patch };
      return { ...current, microShots: items };
    });
  }

  function addDraftMicroShot() {
    setDraft((current) => {
      const items = [...((current.microShots as MicroShot[] | undefined) ?? [])];
      const duration = Number(current.durationSeconds ?? selectedShot?.durationSeconds ?? 3);
      const localTimeSeconds = Math.max(0, Math.min(duration, items.length ? Math.round(duration / 2) : 0));
      items.push({
        microShotNo: items.length + 1,
        localTimeSeconds,
        absoluteTimeSeconds: (selectedShot?.startTimeSeconds ?? 0) + localTimeSeconds,
        purpose: "",
        scene: "",
        action: "",
        camera: "",
        referenceType: "mixed",
        imagePrompt: "",
        prompt: "",
      });
      return { ...current, microShots: items };
    });
  }

  function removeDraftMicroShot(index: number) {
    setDraft((current) => ({
      ...current,
      microShots: ((current.microShots as MicroShot[] | undefined) ?? [])
        .filter((_, itemIndex) => itemIndex !== index)
        .map((item, itemIndex) => ({ ...item, microShotNo: itemIndex + 1 })),
    }));
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
          microShots: draft.microShots,
          locale: pageLang,
        }),
      });
      if (!res.project) throw new Error(copy.saveFailed);
      rememberProject(res.project);
      setMessage(copy.saved(selectedShot.shotNo));
    });
  }

  async function generateMicroShotImage(index: number) {
    if (!project || !selectedShot) return;
    const microShot = ((draft.microShots as MicroShot[] | undefined) ?? [])[index];
    if (!microShot) return;
    await runAction(async () => {
      const res = await fetchJson(
        `/api/video-projects/${project.id}/shots/${selectedShot.id}/micro-shots/${index + 1}/image`,
        copy,
        {
          method: "POST",
          body: JSON.stringify({
            locale: pageLang,
            microShot: {
              ...microShot,
              microShotNo: index + 1,
            },
          }),
        },
      );
      if (!res.project) throw new Error(copy.regenerateFailed);
      rememberProject(res.project);
      setMessage(copy.microShotImageRunning);
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

  async function approveMicroShots() {
    if (!project) return;
    await runAction(async () => {
      const res = await fetchJson(`/api/video-projects/${project.id}/approve-micro-shots`, copy, { method: "POST" });
      if (!res.project) throw new Error(copy.approveFailed);
      rememberProject(res.project);
      setMessage(copy.microShotsApproved);
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

        <section className="grid gap-3 border-b border-white/10 pb-5 lg:grid-cols-[minmax(0,1fr)_160px_120px_130px_190px]">
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-24 resize-none rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm leading-6 text-slate-100 outline-none focus:border-cyan-400" />
          <select value={stylePreset} onChange={(event) => setStylePreset(event.target.value)} className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400">
            {Object.entries(copy.styles).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as AspectRatio)} className="h-11 rounded-md border border-white/10 bg-slate-900 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400">
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
          <label className="flex h-11 items-center gap-2 rounded-md border border-white/10 bg-slate-900 px-3 focus-within:border-cyan-400">
            <span className="shrink-0 text-xs text-slate-500">{copy.totalDuration}</span>
            <input
              type="number"
              min={3}
              max={180}
              step={1}
              value={durationSeconds}
              onChange={(event) => setDurationSeconds(Number(event.target.value))}
              onBlur={() => setDurationSeconds((value) => clampProjectDuration(value))}
              title={copy.totalDurationHint}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 outline-none"
            />
            <span className="text-xs text-slate-500">s</span>
          </label>
          <div className="flex min-h-11 items-center gap-2 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-3">
            <Sparkles className="h-4 w-4 shrink-0 text-cyan-200" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-cyan-100">{copy.autoShotPlan}</p>
              <p className="truncate text-[11px] text-cyan-100/60">{copy.totalDuration}: {clampProjectDuration(durationSeconds)}s / {copy.segmentDurationPolicy}</p>
            </div>
          </div>
          <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-3 lg:col-span-5">
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
          <div className="lg:col-span-5">
            <button type="button" onClick={createAndPlan} disabled={loading || prompt.trim().length < 4} className="inline-flex h-10 items-center gap-2 rounded-md bg-cyan-500 px-4 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? copy.generating : copy.generatePlan}
            </button>
          </div>
        </section>

        {workflowProgress && (
          <section className={`rounded-md border px-4 py-3 text-sm ${workflowProgressBorderClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-white">{workflowProgress.title}</p>
                <p className="mt-1 text-xs text-slate-400">{workflowProgress.detail}</p>
              </div>
              <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1 text-sm font-semibold text-white">
                {workflowProgress.percent}%
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/30">
              <div
                className={`h-full rounded-full transition-all duration-500 ${workflowProgressBarClass}`}
                style={{ width: `${workflowProgress.percent}%` }}
              />
            </div>
          </section>
        )}

        {(error || message || project?.errorMessage) && (
          <div className="rounded-md border border-white/10 bg-slate-900 px-4 py-3 text-sm">
            {error && <p className="text-red-300">{error}</p>}
            {message && <p className="text-emerald-300">{message}</p>}
            {project?.errorMessage && <p className="text-amber-300">{project.errorMessage}</p>}
          </div>
        )}

        {project && (
          <section ref={projectLayoutRef} className="grid grid-cols-1 gap-5 xl:flex xl:items-start">
            <aside className="border-r border-white/10 pr-4 xl:w-[250px] xl:shrink-0">
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
                  <button key={shot.id} type="button" onClick={() => selectShot(shot.id)} className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm ${!selectedKeyframe && selectedShot?.id === shot.id ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"}`}>
                    <span className="font-medium">{copy.shot} {String(shot.shotNo).padStart(2, "0")}</span>
                    <span className="text-xs text-slate-500">{copy.shotStatus[shot.status]}</span>
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-w-0 space-y-5 xl:flex-1">
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
                  <button type="button" onClick={approveMicroShots} disabled={loading || !canApproveMicroShots} className="inline-flex h-9 items-center gap-2 rounded-md border border-fuchsia-300/30 bg-fuchsia-300/10 px-3 text-sm font-medium text-fuchsia-100 hover:bg-fuchsia-300/15 disabled:opacity-50">
                    <ImageIcon className="h-4 w-4" /> {copy.approveMicroShots}
                  </button>
                  <button type="button" onClick={approveClips} disabled={loading || !canApproveClips} className="inline-flex h-9 items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 hover:bg-cyan-400/15 disabled:opacity-50">
                    <Clapperboard className="h-4 w-4" /> {copy.approveClips}
                  </button>
                  <button type="button" onClick={confirmFinal} disabled={loading || !canConfirmFinal || project.status === "DONE"} className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-300/30 bg-amber-300/10 px-3 text-sm font-medium text-amber-100 hover:bg-amber-300/15 disabled:opacity-50">
                    <Check className="h-4 w-4" /> {copy.confirmFinal}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
                {([
                  { key: "frames" as const, label: copy.frames, meta: `${completeImages}/${keyframeTotal}` },
                  { key: "clips" as const, label: copy.shots, meta: `${completeClips}/${segmentTotal}` },
      { key: "final" as const, label: copy.finalVideo, meta: project.finalVideoUrl ? copy.ready : copy.pending },
                ]).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setProjectView(item.key);
                      if (item.key === "frames") {
                        setSelectedKeyframeId(project.keyframes?.[0]?.id ?? "");
                      } else {
                        setSelectedKeyframeId("");
                      }
                    }}
                    className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium ${
                      projectView === item.key
                        ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span>{item.label}</span>
                    <span className="rounded bg-black/20 px-1.5 py-0.5 text-[11px] text-slate-400">{item.meta}</span>
                  </button>
                ))}
              </div>

              {projectView === "final" && project.finalVideoUrl && (
                <section className="space-y-2 rounded-md border border-emerald-400/20 bg-emerald-400/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-100">
                    <Clapperboard className="h-4 w-4" />
                    {copy.finalVideo}
                  </div>
                  <video src={project.finalVideoUrl} controls playsInline preload="metadata" className={`w-full rounded-md border border-white/10 bg-black ${aspectClass(project.aspectRatio)}`} />
                </section>
              )}

              {projectView === "final" && !project.finalVideoUrl && (
                <section className="rounded-md border border-white/10 bg-white/[0.03] px-4 py-12 text-center text-sm text-slate-500">
                  {copy.finalVideoNotReady}
                </section>
              )}

              {projectView === "frames" && project.keyframes?.length ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-200">{copy.frames} {completeImages}/{keyframeTotal}</h3>
                    <span className="text-xs text-slate-500">{copy.boundaryFrameHint}</span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {project.keyframes.map((keyframe) => (
                      <div key={keyframe.id} className={`overflow-hidden rounded-md border bg-white/[0.03] ${selectedKeyframe?.id === keyframe.id ? "border-cyan-400/60" : "border-white/10"}`}>
                        <button
                          type="button"
                          onClick={() => {
                            setProjectView("frames");
                            setSelectedKeyframeId(keyframe.id);
                            if (keyframe.imageUrl) setPreviewKeyframeId(keyframe.id);
                          }}
                          className={`relative block w-full bg-slate-900 text-left ${aspectClass(project.aspectRatio)}`}
                        >
                          {keyframe.imageUrl ? (
                            <img src={keyframe.imageUrl} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full items-center justify-center text-sm text-slate-600">{safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}</div>
                          )}
                          <span className="absolute left-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
                            {safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)}
                          </span>
                          <span className="absolute right-2 top-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                            {copy.shotStatus[keyframe.status]}
                          </span>
                          {keyframe.imageUrl && (
                            <span className="absolute bottom-2 right-2 rounded-md border border-black/30 bg-black/60 px-2 py-1 text-[11px] text-white">
                              {copy.preview}
                            </span>
                          )}
                        </button>
                        <div className="space-y-2 px-3 py-3">
                          <p className="text-sm font-semibold text-white">{localizedKeyframePurpose(keyframe, pageLang)}</p>
                          <p className="line-clamp-4 text-xs leading-5 text-slate-400">{localizedKeyframeImagePrompt(keyframe, pageLang)}</p>
                          <button type="button" onClick={() => regenerateImage(keyframe.id)} disabled={loading || keyframe.locked} className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-white/10 text-xs text-slate-300 hover:bg-white/[0.06] disabled:opacity-50">
                            <RefreshCw className="h-3.5 w-3.5" /> {copy.regenerate}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {projectView === "clips" && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-200">{copy.shots} {completeClips}/{segmentTotal}</h3>
                  <span className="text-xs text-slate-500">{segmentTotal} {copy.firstLastFrameClips}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {project.shots.map((shot) => (
                  <div
                    key={shot.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectShot(shot.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectShot(shot.id);
                      }
                    }}
                    className={`overflow-hidden rounded-md border bg-white/[0.03] outline-none transition ${
                      selectedShot?.id === shot.id && !selectedKeyframe
                        ? "border-cyan-400/60 ring-1 ring-cyan-400/30"
                        : "border-white/10 hover:border-cyan-400/35 focus-visible:border-cyan-400/60"
                    }`}
                  >
                    <div className={`relative bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {shot.clipUrl ? (
                        <video src={shot.clipUrl} controls playsInline preload="metadata" poster={shot.imageUrl || undefined} className="h-full w-full object-cover" />
                      ) : (
                        <button type="button" onClick={() => selectShot(shot.id)} className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
                          <Clapperboard className="h-5 w-5" />
                          <span>{copy.shot} {String(shot.shotNo).padStart(2, "0")}</span>
                          {shot.startKeyframeNo && shot.endKeyframeNo && (
                            <span className="text-xs text-cyan-200/80">{safeBoundaryRangeLabel(shot, keyframeByNo, project.durationSeconds, pageLang)}</span>
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
                        <p className="text-xs text-cyan-200/80">{safeBoundaryRangeLabel(shot, keyframeByNo, project.durationSeconds, pageLang)}</p>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {shot.boundaryMode && (
                          <span className="rounded-md border border-indigo-300/20 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100/80">
                            {copy.boundaryMode}: {shot.boundaryMode}
                          </span>
                        )}
                        {shot.outputMode && (
                          <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
                            {copy.outputMode}: {shot.outputMode}
                          </span>
                        )}
                        {Boolean(shot.microShots?.length) && (
                          <span className="rounded-md border border-fuchsia-300/20 bg-fuchsia-300/10 px-2 py-1 text-[11px] text-fuchsia-100/80">
                            {copy.microShots}: {shot.microShots?.length}
                          </span>
                        )}
                        {shot.audioPlan && (
                          <span className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] text-amber-100/80">
                            {copy.audioPlan}: {shot.audioPlan.mode}
                          </span>
                        )}
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400">
                          {copy.segmentDurationPolicy}
                        </span>
                      </div>
                      <p className="min-h-10 overflow-hidden text-sm leading-5 text-slate-400">{localizedShotPurpose(shot, pageLang)}</p>
                      {Boolean(shot.constraints?.length) && (
                        <div className="flex flex-wrap gap-1.5">
                          {shot.constraints?.slice(0, 3).map((constraint) => (
                            <span key={constraint} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100/80">
                              {constraint}
                            </span>
                          ))}
                        </div>
                      )}
                      {Boolean(shot.timedPrompts?.length) && (
                        <p className="line-clamp-2 text-xs leading-5 text-amber-100/70">
                          {copy.timedPrompts}: {shot.timedPrompts?.slice(0, 2).map((item) => `${timedPromptRangeLabel(item)} ${localizedTimedPrompt(item, pageLang)}`).join(" / ")}
                        </p>
                      )}
                      {Boolean(shot.microShots?.length) && (
                        <p className="line-clamp-2 text-xs leading-5 text-fuchsia-100/70">
                          {copy.microShots}: {shot.microShots?.slice(0, 2).map((item) => `+${item.localTimeSeconds}s ${localizedMicroShotPrompt(item, pageLang)}`).join(" / ")}
                        </p>
                      )}
                      {shot.audioPlan && (
                        <p className="line-clamp-2 text-xs leading-5 text-amber-100/70">
                          {copy.audioPlan}: {localizedAudioPlanSummary(shot.audioPlan, pageLang)}
                        </p>
                      )}
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
              )}
            </main>

            <button
              type="button"
              aria-label={pageLang === "en" ? "Resize details panel" : "调整详情面板宽度"}
              title={pageLang === "en" ? "Drag to resize the details panel" : "拖动调整右侧详情面板宽度"}
              onPointerDown={(event) => {
                event.preventDefault();
                setResizingDetailPanel(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setDetailPanelWidth((width) => clampDetailPanelWidth(width + 24));
                } else if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setDetailPanelWidth((width) => clampDetailPanelWidth(width - 24));
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setDetailPanelWidth(DETAIL_PANEL_MIN_WIDTH);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setDetailPanelWidth(DETAIL_PANEL_MAX_WIDTH);
                }
              }}
              className={`hidden self-stretch px-1 outline-none xl:flex xl:w-3 xl:shrink-0 xl:cursor-col-resize xl:items-stretch xl:justify-center ${resizingDetailPanel ? "text-cyan-200" : "text-slate-700 hover:text-cyan-300 focus-visible:text-cyan-300"}`}
            >
              <span className={`my-1 w-px rounded-full bg-current ${resizingDetailPanel ? "shadow-[0_0_0_3px_rgba(34,211,238,0.18)]" : ""}`} />
            </button>

            <aside
              className="w-full border-l border-white/10 pl-4 xl:w-[var(--detail-panel-width)] xl:shrink-0"
              style={{ "--detail-panel-width": `${detailPanelWidth}px` } as CSSProperties}
            >
              {selectedKeyframe ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{safeBoundaryFrameLabel(selectedKeyframe, project.durationSeconds, pageLang)}</h3>
                    <span className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400">{copy.shotStatus[selectedKeyframe.status]}</span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500">{copy.keyframePreview}</p>
                    <div className={`overflow-hidden rounded-md border border-white/10 bg-slate-900 ${aspectClass(project.aspectRatio)}`}>
                      {selectedKeyframe.imageUrl ? (
                        <button type="button" onClick={() => setPreviewKeyframeId(selectedKeyframe.id)} className="block h-full w-full">
                          <img src={selectedKeyframe.imageUrl} alt={safeBoundaryFrameLabel(selectedKeyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className="flex h-full items-center justify-center text-sm text-slate-600">{safeBoundaryFrameShortLabel(selectedKeyframe, project.durationSeconds, pageLang)}</div>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{copy.boundaryFrameHint}</p>
                  </div>
                  <Field label={copy.purpose}><textarea value={String(keyframeDraft.purpose ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, purpose: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.imagePrompt}><textarea value={String(keyframeDraft.imagePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, imagePrompt: event.target.value }))} className="min-h-40 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.negativePrompt}><textarea value={String(keyframeDraft.negativePrompt ?? "")} onChange={(event) => setKeyframeDraft((current) => ({ ...current, negativePrompt: event.target.value }))} className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
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
                      <p className="text-xs text-slate-500">{safeBoundaryRangeLabel(selectedShot, keyframeByNo, project.durationSeconds, pageLang)}</p>
                    )}
                    {(selectedStartKeyframe || selectedEndKeyframe) && (
                      <div className="grid grid-cols-2 gap-2">
                        {[selectedStartKeyframe, selectedEndKeyframe].map((keyframe) => (
                          <div key={keyframe?.id ?? "empty"} className="overflow-hidden rounded-md border border-white/10 bg-slate-900">
                            <div className={`relative ${aspectClass(project.aspectRatio)}`}>
                              {keyframe?.imageUrl ? (
                                <img src={keyframe.imageUrl} alt={safeBoundaryFrameLabel(keyframe, project.durationSeconds, pageLang)} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-slate-600">KF</div>
                              )}
                              {keyframe && (
                                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                                  {safeBoundaryFrameShortLabel(keyframe, project.durationSeconds, pageLang)}
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
                    <div className="space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
                      <div className="flex flex-wrap gap-1.5">
                        {selectedShot.boundaryMode && (
                          <span className="rounded-md border border-indigo-300/20 bg-indigo-300/10 px-2 py-1 text-[11px] text-indigo-100/80">
                            {copy.boundaryMode}: {selectedShot.boundaryMode}
                          </span>
                        )}
                        {selectedShot.outputMode && (
                          <span className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100">
                            {copy.outputMode}: {selectedShot.outputMode}
                          </span>
                        )}
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-400">
                          {copy.segmentDurationPolicy}
                        </span>
                      </div>
                      {Boolean(selectedShot.constraints?.length) && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.constraints}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {selectedShot.constraints?.map((constraint) => (
                              <span key={constraint} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[11px] text-emerald-100/80">
                                {constraint}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {Boolean(selectedShot.timedPrompts?.length) && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.timedPrompts}</p>
                          {selectedShot.timedPrompts?.map((item) => (
                            <p key={`${item.timeSeconds}-${item.prompt}`} className="text-xs leading-5 text-amber-100/75">
                              {timedPromptRangeLabel(item)}: {localizedTimedPrompt(item, pageLang)}
                            </p>
                          ))}
                        </div>
                      )}
                      {selectedShot.audioPlan && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-slate-500">{copy.audioPlan}</p>
                          <p className="text-xs leading-5 text-amber-100/75">{localizedAudioPlanSummary(selectedShot.audioPlan, pageLang)}</p>
                          {audioPlanLines(selectedShot.audioPlan, pageLang).length > 0 && (
                            <div className="space-y-1">
                              <p className="text-[11px] font-medium text-slate-500">{copy.spokenLines}</p>
                              {audioPlanLines(selectedShot.audioPlan, pageLang).map((line) => (
                                <p key={line} className="text-xs leading-5 text-slate-300">{line}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <section className="space-y-3 rounded-md border border-fuchsia-300/15 bg-fuchsia-300/[0.04] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-fuchsia-100">{copy.microShots}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{copy.microShotHint}</p>
                      </div>
                      <button type="button" onClick={addDraftMicroShot} className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-fuchsia-300/20 px-2 text-xs text-fuchsia-100 hover:bg-fuchsia-300/10">
                        <Plus className="h-3.5 w-3.5" /> {copy.addMicroShot}
                      </button>
                    </div>
                    <div className="space-y-3">
                      {((draft.microShots as MicroShot[] | undefined) ?? []).map((item, index) => (
                        <div key={`${item.microShotNo}-${index}`} className="space-y-2 rounded-md border border-white/10 bg-slate-950/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-200">{copy.microShot} {String(index + 1).padStart(2, "0")}</p>
                            <button type="button" onClick={() => removeDraftMicroShot(index)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-slate-400 hover:bg-white/[0.06]">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-[90px_minmax(0,1fr)] gap-2">
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-500">+s</span>
                              <input
                                type="number"
                                min={0}
                                max={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                                step={1}
                                value={Number(item.localTimeSeconds ?? 0)}
                                onChange={(event) => updateDraftMicroShot(index, { localTimeSeconds: Number(event.target.value) })}
                                className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                              />
                            </label>
                            <label className="space-y-1">
                              <span className="text-[11px] text-slate-500">{copy.referenceType}</span>
                              <select
                                value={item.referenceType ?? "mixed"}
                                onChange={(event) => updateDraftMicroShot(index, { referenceType: event.target.value as MicroShot["referenceType"] })}
                                className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300"
                              >
                                <option value="text">text</option>
                                <option value="image_prompt">image_prompt</option>
                                <option value="mixed">mixed</option>
                              </select>
                            </label>
                          </div>
                          {item.referenceType !== "text" && (
                            <div className="space-y-2 rounded-md border border-cyan-300/15 bg-cyan-300/[0.04] p-2">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-[11px] leading-5 text-slate-500">{copy.microShotImageHint}</p>
                                <button
                                  type="button"
                                  onClick={() => generateMicroShotImage(index)}
                                  disabled={
                                    loading ||
                                    item.imageStatus === "running" ||
                                    !localizedMicroShotImagePrompt(item, pageLang).trim()
                                  }
                                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-cyan-300/20 px-2 text-xs text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-50"
                                >
                                  {item.imageStatus === "running"
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : item.imageUrl
                                      ? <RefreshCw className="h-3.5 w-3.5" />
                                      : <ImageIcon className="h-3.5 w-3.5" />}
                                  {item.imageUrl ? copy.regenerateMicroShotImage : copy.generateMicroShotImage}
                                </button>
                              </div>
                              {item.imageStatus === "running" && (
                                <p className="text-xs text-cyan-100/75">{copy.microShotImageRunning}</p>
                              )}
                              {item.imageStatus === "failed" && (
                                <p className="text-xs text-rose-200">{item.errorMessage || copy.microShotImageFailed}</p>
                              )}
                              {item.imageUrl && (
                                <a href={item.imageUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-white/10 bg-slate-950">
                                  <img src={item.imageUrl} alt={`${copy.microShot} ${index + 1}`} className="max-h-52 w-full object-contain" />
                                </a>
                              )}
                            </div>
                          )}
                          <Field label={copy.purpose}><input value={localizedMicroShotPurpose(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { purposeEn: event.target.value, purpose: event.target.value } : { purposeZh: event.target.value, purpose: event.target.value })} className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.scene}><textarea value={item.scene ?? ""} onChange={(event) => updateDraftMicroShot(index, { scene: event.target.value })} className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.action}><textarea value={item.action ?? ""} onChange={(event) => updateDraftMicroShot(index, { action: event.target.value })} className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.imagePrompt}><textarea value={localizedMicroShotImagePrompt(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { imagePromptEn: event.target.value, imagePrompt: event.target.value } : { imagePromptZh: event.target.value, imagePrompt: event.target.value })} className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                          <Field label={copy.prompt}><textarea value={localizedMicroShotPrompt(item, pageLang)} onChange={(event) => updateDraftMicroShot(index, pageLang === "en" ? { promptEn: event.target.value, prompt: event.target.value } : { promptZh: event.target.value, prompt: event.target.value })} className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-fuchsia-300" /></Field>
                        </div>
                      ))}
                    </div>
                  </section>
                  <Field label={`${copy.duration} (${copy.segmentDurationPolicy})`}>
                    <input
                      type="number"
                      min={3}
                      max={15}
                      step={1}
                      value={Number(draft.durationSeconds ?? selectedShot.durationSeconds)}
                      onChange={(event) => setDraft((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}
                      className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                  </Field>
                  <Field label={copy.purpose}><textarea value={String(draft.purpose ?? "")} onChange={(event) => setDraft((current) => ({ ...current, purpose: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.action}><textarea value={String(draft.action ?? "")} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))} className="min-h-20 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.camera}><input value={String(draft.camera ?? "")} onChange={(event) => setDraft((current) => ({ ...current, camera: event.target.value }))} className="w-full rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <Field label={copy.subtitle}>
                    <textarea
                      maxLength={subtitleLimitForLang(pageLang)}
                      value={String(draft.subtitle ?? "")}
                      onChange={(event) => setDraft((current) => ({ ...current, subtitle: event.target.value }))}
                      className="min-h-16 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
                    />
                    <div className="flex items-center justify-between gap-3 text-[11px] leading-5 text-slate-500">
                      <span>{copy.subtitleHint}</span>
                      <span className="shrink-0">{String(draft.subtitle ?? "").length}/{subtitleLimitForLang(pageLang)}</span>
                    </div>
                  </Field>
                  <Field label={copy.videoPrompt}><textarea value={String(draft.videoPrompt ?? "")} onChange={(event) => setDraft((current) => ({ ...current, videoPrompt: event.target.value }))} className="min-h-24 w-full resize-y rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400" /></Field>
                  <button type="button" onClick={saveShot} disabled={loading} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-cyan-500 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"><Save className="h-4 w-4" /> {copy.saveShot}</button>
                </div>
              ) : <div className="py-12 text-center text-sm text-slate-500">{copy.noShot}</div>}
            </aside>
          </section>
        )}
      </div>

      {previewKeyframe?.imageUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" onClick={() => setPreviewKeyframeId("")}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col gap-3" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/95 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{safeBoundaryFrameLabel(previewKeyframe, previewTotalDuration, pageLang)}</p>
                <p className="truncate text-xs text-slate-400">{localizedKeyframePurpose(previewKeyframe, pageLang)}</p>
              </div>
              <button type="button" onClick={() => setPreviewKeyframeId("")} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-slate-200 hover:bg-white/[0.08]">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-md border border-white/10 bg-black">
                <img src={previewKeyframe.imageUrl} alt={safeBoundaryFrameLabel(previewKeyframe, previewTotalDuration, pageLang)} className="max-h-[78vh] max-w-full object-contain" />
              </div>
              <aside className="max-h-[78vh] overflow-y-auto rounded-md border border-white/10 bg-slate-950/95 p-3">
                <p className="text-xs font-medium text-slate-500">{copy.imagePrompt}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{localizedKeyframeImagePrompt(previewKeyframe, pageLang)}</p>
                {previewKeyframe.negativePrompt && (
                  <>
                    <p className="mt-4 text-xs font-medium text-slate-500">{copy.negativePrompt}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{localizedKeyframeNegativePrompt(previewKeyframe, pageLang)}</p>
                  </>
                )}
              </aside>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-slate-500">{label}</span>{children}</label>;
}

function subtitleLimitForLang(lang: PageLang): number {
  return lang === "en" ? 72 : 24;
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

function localizedShotPurpose(shot: VideoShot, lang: PageLang): string {
  if (lang === "en") return shot.purposeEn || titleFromPrompt(shot.videoPromptEn || shot.videoPrompt || shot.purpose, `Shot ${shot.shotNo}`);
  return shot.purposeZh || shot.purpose;
}

function localizedKeyframePurpose(keyframe: VideoKeyframe, lang: PageLang): string {
  if (lang === "en") return keyframe.purposeEn || titleFromPrompt(keyframe.imagePromptEn || keyframe.imagePrompt || keyframe.purpose, `Boundary frame ${keyframe.keyframeNo}`);
  return keyframe.purposeZh || keyframe.purpose;
}

function localizedMicroShotPurpose(microShot: MicroShot, lang: PageLang): string {
  if (lang === "en") return microShot.purposeEn || titleFromPrompt(microShot.promptEn || microShot.imagePromptEn || microShot.purpose, `Micro-shot ${microShot.microShotNo}`);
  return microShot.purposeZh || microShot.purpose;
}

function titleFromPrompt(text: string, fallback: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  const purposeMatch = cleaned.match(/\bPurpose:\s*([^.;。]+)/i);
  const source = purposeMatch?.[1]?.trim() || cleaned.split(/[.;。]/)[0]?.trim() || fallback;
  return source.length > 96 ? `${source.slice(0, 93)}...` : source;
}

function localizedShotNegativePrompt(shot: VideoShot, lang: PageLang): string {
  return localizedNegativePrompt(
    shot.negativePrompt,
    lang,
    shot.negativePromptZh,
    shot.negativePromptEn,
  );
}

function localizedKeyframeImagePrompt(keyframe: VideoKeyframe, lang: PageLang): string {
  return lang === "en"
    ? keyframe.imagePromptEn || keyframe.imagePrompt
    : keyframe.imagePromptZh || keyframe.imagePrompt;
}

function localizedKeyframeNegativePrompt(keyframe: VideoKeyframe, lang: PageLang): string {
  return localizedNegativePrompt(
    keyframe.negativePrompt ?? "",
    lang,
    keyframe.negativePromptZh,
    keyframe.negativePromptEn,
  );
}

function localizedNegativePrompt(base: string, lang: PageLang, zh?: string, en?: string): string {
  if (lang === "en") return en || base;
  return zh || translateNegativePromptToZh(base);
}

function translateNegativePromptToZh(prompt: string): string {
  const dictionary: Record<string, string> = {
    text: "文字",
    subtitles: "字幕",
    captions: "字幕",
    logos: "标志",
    logo: "标志",
    watermarks: "水印",
    watermark: "水印",
    ui: "界面元素",
    "modern objects": "现代物件",
    "harsh lighting": "刺眼光线",
    "oversaturated colors": "颜色过饱和",
    "deformed hands": "手部变形",
    "extra fingers": "多余手指",
    "random text": "随机文字",
    "logo distortion": "标志变形",
    "deformed face": "脸部变形",
    "low quality": "低质量",
    blurry: "模糊",
    "duplicated body": "身体重复",
  };
  return prompt
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => dictionary[item.toLowerCase()] ?? item)
    .join("，");
}

function localizedTimedPrompt(prompt: TimedPrompt, lang: PageLang): string {
  return lang === "en" ? prompt.promptEn || prompt.prompt : prompt.promptZh || prompt.prompt;
}

function timedPromptRangeLabel(prompt: TimedPrompt): string {
  if (typeof prompt.startSeconds === "number" && typeof prompt.endSeconds === "number") {
    return `${prompt.startSeconds}-${prompt.endSeconds}s`;
  }
  return `${prompt.timeSeconds}s`;
}

function localizedMicroShotPrompt(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.promptEn || microShot.prompt || microShot.action || localizedMicroShotPurpose(microShot, lang)
    : microShot.promptZh || microShot.prompt || microShot.action || localizedMicroShotPurpose(microShot, lang);
}

function localizedMicroShotImagePrompt(microShot: MicroShot, lang: PageLang): string {
  return lang === "en"
    ? microShot.imagePromptEn || microShot.imagePrompt || ""
    : microShot.imagePromptZh || microShot.imagePrompt || "";
}

function audioPlanLines(audioPlan: AudioPlan, lang: PageLang): string[] {
  const preferred = lang === "en" ? audioPlan.linesEn : audioPlan.linesZh;
  return (preferred?.length ? preferred : audioPlan.lines?.length ? audioPlan.lines : lang === "en" ? audioPlan.linesZh : audioPlan.linesEn) ?? [];
}

function localizedAudioPlanSummary(audioPlan: AudioPlan, lang: PageLang): string {
  const lines = audioPlanLines(audioPlan, lang);
  const speech = lines.length
    ? lines.slice(0, 2).join(" / ")
    : lang === "en"
      ? "no spoken lines"
      : "no spoken lines";
  const voice = [audioPlan.speaker, audioPlan.voiceStyle, audioPlan.language].filter(Boolean).join(" / ");
  const reason = audioPlan.rationale ? ` - ${audioPlan.rationale}` : "";
  return [audioPlan.mode, voice, speech].filter(Boolean).join(" | ") + reason;
}

function boundaryFrameLabel(frame: VideoKeyframe, totalSeconds: number, lang: PageLang): string {
  const consistencyLabel = consistencyFrameLabel(frame, lang);
  if (consistencyLabel) return consistencyLabel;
  if (frame.keyframeNo === 1) return lang === "en" ? "First-frame reference" : "首帧参考图";
  if (frame.timeSeconds >= totalSeconds) return lang === "en" ? "End-frame reference" : "尾帧参考图";
  return lang === "en"
    ? `Boundary frame ${String(frame.keyframeNo).padStart(2, "0")}`
    : `边界帧 ${String(frame.keyframeNo).padStart(2, "0")}`;
}

function boundaryFrameShortLabel(frame: VideoKeyframe | undefined, totalSeconds: number, lang: PageLang): string {
  if (!frame) return lang === "en" ? "Frame" : "参考帧";
  const consistencyLabel = consistencyFrameShortLabel(frame, lang);
  if (consistencyLabel) return consistencyLabel;
  if (frame.keyframeNo === 1) return lang === "en" ? "First" : "首帧";
  if (frame.timeSeconds >= totalSeconds) return lang === "en" ? "End" : "尾帧";
  return lang === "en" ? `F${String(frame.keyframeNo).padStart(2, "0")}` : `边界${String(frame.keyframeNo).padStart(2, "0")}`;
}

function safeBoundaryFrameLabel(frame: VideoKeyframe, totalSeconds: number, lang: PageLang): string {
  return boundaryFrameLabel(frame, totalSeconds, lang);
}

function safeBoundaryFrameShortLabel(frame: VideoKeyframe | undefined, totalSeconds: number, lang: PageLang): string {
  return boundaryFrameShortLabel(frame, totalSeconds, lang);
}

function consistencyFrameLabel(frame: VideoKeyframe, lang: PageLang): string {
  if (frame.keyframeNo === -2) return lang === "en" ? "Character consistency reference" : "人物一致性参考图";
  if (frame.keyframeNo === -1) return lang === "en" ? "Scene consistency reference" : "场景一致性参考图";
  return "";
}

function consistencyFrameShortLabel(frame: VideoKeyframe, lang: PageLang): string {
  if (frame.keyframeNo === -2) return lang === "en" ? "Character" : "人物参考";
  if (frame.keyframeNo === -1) return lang === "en" ? "Scene" : "场景参考";
  return "";
}

function safeBoundaryRangeLabel(
  shot: Pick<VideoShot, "startKeyframeNo" | "endKeyframeNo">,
  keyframeByNo: Map<number, VideoKeyframe>,
  totalSeconds: number,
  lang: PageLang,
): string {
  const start = shot.startKeyframeNo ? keyframeByNo.get(shot.startKeyframeNo) : undefined;
  const end = shot.endKeyframeNo ? keyframeByNo.get(shot.endKeyframeNo) : undefined;
  return `${safeBoundaryFrameShortLabel(start, totalSeconds, lang)} -> ${safeBoundaryFrameShortLabel(end, totalSeconds, lang)}`;
}

function estimatePlanningProgress(elapsedMs: number): Pick<OptimisticProgress, "phase" | "percent"> {
  const seconds = Math.max(0, elapsedMs / 1000);
  if (seconds < 2) return { phase: "creating", percent: Math.round(3 + seconds * 5) };
  if (seconds < 8) return { phase: "understanding", percent: Math.round(13 + (seconds - 2) * 4) };
  if (seconds < 20) return { phase: "storyboard", percent: Math.round(37 + (seconds - 8) * 2.25) };
  if (seconds < 38) return { phase: "prompts", percent: Math.round(64 + (seconds - 20) * 1.15) };
  return { phase: "waiting", percent: Math.min(94, Math.round(85 + Math.log1p(seconds - 38) * 3)) };
}

function optimisticWorkflowProgressView(progress: OptimisticProgress, lang: PageLang): WorkflowProgressView {
  const text: Record<OptimisticProgressPhase, { zh: [string, string]; en: [string, string]; tone: WorkflowProgressView["tone"] }> = {
    creating: {
      zh: ["正在创建项目", "已提交创作需求，正在准备进入剧本拆解。"],
      en: ["Creating project", "The request is submitted and the storyboard planner is warming up."],
      tone: "running",
    },
    understanding: {
      zh: ["大模型正在理解需求", "正在识别主题、人物/场景参考、色调锁和画幅约束。"],
      en: ["Understanding brief", "Reading the theme, references, tone locks, and aspect ratio constraints."],
      tone: "running",
    },
    storyboard: {
      zh: ["正在拆解剧本与边界关键帧", "规划首尾帧时间线、镜头数量和每段叙事节拍。"],
      en: ["Splitting script and boundary frames", "Planning the first-last-frame timeline, segment count, and story beats."],
      tone: "running",
    },
    prompts: {
      zh: ["正在生成结构化提示词", "整理图片 Prompt、视频 Prompt、负向约束和连续性锁定。"],
      en: ["Building structured prompts", "Preparing image prompts, video prompts, negative constraints, and continuity locks."],
      tone: "running",
    },
    waiting: {
      zh: ["等待模型返回完整结果", "复杂需求可能会多等一会儿，返回后会自动进入审核。"],
      en: ["Waiting for the model result", "Complex briefs can take longer. The review stage will open automatically when it returns."],
      tone: "running",
    },
    done: {
      zh: ["分镜计划已完成", "已拿到大模型返回的分镜、关键帧和片段提示词。"],
      en: ["Storyboard plan complete", "The model returned the storyboard, keyframes, and segment prompts."],
      tone: "success",
    },
    failed: {
      zh: ["分镜计划生成失败", "请查看下方错误信息，修正后可以重新生成。"],
      en: ["Storyboard planning failed", "Check the error below, then adjust and try again."],
      tone: "failed",
    },
  };
  const item = text[progress.phase];
  const [title, detail] = lang === "en" ? item.en : item.zh;
  return { percent: Math.max(0, Math.min(100, Math.round(progress.percent))), title, detail, tone: item.tone };
}

function projectWorkflowProgressView(
  project: VideoProject,
  progress: ReturnType<typeof projectProgress>,
  lang: PageLang,
): WorkflowProgressView {
  const zh: Record<ProjectStatus, [string, string, WorkflowProgressView["tone"]]> = {
    DRAFT: ["等待开始", "填写一句话需求后即可生成分镜计划。", "idle"],
    PLANNING: ["正在生成分镜计划", "大模型正在拆解剧本、关键帧和片段提示词。", "running"],
    PLAN_REVIEW: ["分镜计划待审核", `已生成 ${project.shots.length} 个镜头，请先确认脚本与关键帧规划。`, "idle"],
    IMAGE_GENERATING: ["正在生成边界参考帧", `已完成 ${progress.images}/${progress.imageTotal} 张关键帧图片。`, "running"],
    IMAGE_REVIEW: ["关键帧待审核", `已完成 ${progress.images}/${progress.imageTotal} 张关键帧图片，请确认后进入内部子分镜审核。`, "idle"],
    MICRO_SHOT_REVIEW: ["内部子分镜待审核", "请确认每个片段内部子分镜的文字和参考图，完成后再生成视频片段。", "idle"],
    CLIP_GENERATING: ["正在生成分镜视频片段", `已完成 ${progress.clips}/${progress.clipTotal} 段视频片段。`, "running"],
    CLIP_REVIEW: ["片段待审核", `已完成 ${progress.clips}/${progress.clipTotal} 段视频片段，请确认后合成成片。`, "idle"],
    COMPOSING: ["正在合成最终成片", "正在拼接所有分镜片段并处理转场与声音。", "running"],
    FINAL_REVIEW: ["最终成片待确认", "成片已生成，请预览确认。", "idle"],
    DONE: ["成片已完成", "这个项目已经完成，可以下载或继续新建项目。", "success"],
    FAILED: ["任务失败", "请查看错误信息，修改后重新发起对应步骤。", "failed"],
  };
  const en: Record<ProjectStatus, [string, string, WorkflowProgressView["tone"]]> = {
    DRAFT: ["Ready to start", "Enter a one-line brief to generate the storyboard plan.", "idle"],
    PLANNING: ["Planning storyboard", "The model is splitting the script, keyframes, and segment prompts.", "running"],
    PLAN_REVIEW: ["Storyboard awaiting review", `${project.shots.length} shots are ready. Review the script and keyframe plan first.`, "idle"],
    IMAGE_GENERATING: ["Generating boundary reference frames", `${progress.images}/${progress.imageTotal} keyframe images are ready.`, "running"],
    IMAGE_REVIEW: ["Keyframes awaiting review", `${progress.images}/${progress.imageTotal} keyframe images are ready. Approve them to review internal micro-shots.`, "idle"],
    MICRO_SHOT_REVIEW: ["Internal micro-shots awaiting review", "Review the internal micro-shot text and generated reference images before generating video clips.", "idle"],
    CLIP_GENERATING: ["Generating video clips", `${progress.clips}/${progress.clipTotal} clips are ready.`, "running"],
    CLIP_REVIEW: ["Clips awaiting review", `${progress.clips}/${progress.clipTotal} clips are ready. Approve them to compose the final video.`, "idle"],
    COMPOSING: ["Composing final video", "Joining all clips and applying transitions and audio.", "running"],
    FINAL_REVIEW: ["Final video awaiting review", "The final video is ready for preview.", "idle"],
    DONE: ["Final video complete", "This project is complete and ready to download.", "success"],
    FAILED: ["Task failed", "Check the error message, then retry the relevant step.", "failed"],
  };
  const [title, detail, tone] = lang === "en" ? en[project.status] : zh[project.status];
  return { percent: progress.percent, title, detail, tone };
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
    MICRO_SHOT_REVIEW: 54,
    CLIP_GENERATING: 55 + (clips / safeClipTotal) * 30,
    CLIP_REVIEW: 86,
    COMPOSING: 92,
    FINAL_REVIEW: 97,
    DONE: 100,
    FAILED: Math.max(10, Math.round(((images / safeImageTotal + clips / safeClipTotal) / 2) * 85)),
  };
  return { images, clips, imageTotal, clipTotal, percent: Math.round(stageWeight[project.status] ?? 0) };
}

function hasRunningMicroShotImage(project: VideoProject): boolean {
  return project.shots.some((shot) => shot.microShots?.some((item) => item.imageStatus === "running" && Boolean(item.imageTaskId)));
}

function microShotImageProgress(project: VideoProject): { required: number; ready: number; running: number; failed: number; missing: number } {
  const items = project.shots.flatMap((shot) => shot.microShots ?? []).filter((item) => item.referenceType === "image_prompt" || item.referenceType === "mixed");
  const ready = items.filter((item) => Boolean(item.imageUrl)).length;
  const running = items.filter((item) => item.imageStatus === "running" && Boolean(item.imageTaskId)).length;
  const failed = items.filter((item) => item.imageStatus === "failed").length;
  return {
    required: items.length,
    ready,
    running,
    failed,
    missing: items.length - ready - running - failed,
  };
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

