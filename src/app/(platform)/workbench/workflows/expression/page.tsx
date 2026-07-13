// @ts-nocheck
"use client";

import { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import PageHeader from "@workbench/components/common/PageHeader";
import GenerateButton from "@workbench/components/workflow/GenerateButton";
import ModelSelector from "@workbench/components/workflow/ModelSelector";
import StepLayout from "@workbench/components/workflow/StepLayout";
import WorkflowStepHeader from "@workbench/components/workflow/WorkflowStepHeader";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { apiGet, apiPost, apiUpload } from "@workbench/lib/api";
import { ASSET_CATEGORIES } from "@workbench/lib/constants";
import { getTagLabel } from "@workbench/lib/tag-display";
import {
  assignWorkflowImageIds,
  addTaskTag,
  buildArchiveImageFilename,
  buildConsistencyGenerationPayload,
  buildExpressionTaskStats,
  buildExpressionDraftPrompt,
  buildDefaultArchiveTags,
  buildFinalActionPrompt,
  buildNumberedCollageDraftPrompt,
  buildAssetQueryPath,
  buildAssetTagQueryPath,
  collectReviewImages,
  DEFAULT_ACTION_LIST,
  EXPRESSION_STEP_TITLES,
  getExpressionWorkflowCategoryOptions,
  filterExistingAssetIds,
  filterExpressionModelsForPurpose,
  getFilledActionList,
  getImageArchiveTags,
  getImageChoiceGridClasses,
  getNumberedCollageDraftRequestCount,
  moveGeneratedImageToReviewBucket,
  moveReviewImageBackToRefine,
  directPassRefineSourceImage,
  mergeUniqueNumbers,
  mergeDefaultArchiveImageTags,
  normalizeGeneratedImages,
  normalizeTags,
  recommendExpressionModels,
  resetDraftGenerationState,
  resolveSelectedModelId,
  resolveExpressionWorkflowCategory,
  resolveWorkflowSessionStep,
  skipRefineSourceImage,
  type AvailableExpressionModel,
  type GeneratedImageLike,
  type ImageChoiceGridVariant,
} from "@workbench/lib/expression-workflow";
import type { Asset, Task } from "@workbench/lib/types";

const API_BASE = "/api/workbench";

const STEP_TITLES = EXPRESSION_STEP_TITLES;
const TOTAL_STEPS = STEP_TITLES.length;

const SIZE_OPTIONS = ["1024x1024", "1080x1080", "1080x1350", "1080x1920"];
const COUNT_OPTIONS = [2, 4, 6, 8];
const DRAFT_GENERATION_TIMEOUT_MS = 300000;
const FINAL_GENERATION_TIMEOUT_MS = 660000;
const ARCHIVE_UPLOAD_TIMEOUT_MS = 120000;
const CONSISTENCY_GENERATION_TIMEOUT_MS = 660000;

interface AssetTagOption {
  name: string;
  group?: string | null;
}

interface WorkflowType {
  id: number;
  name: string;
  slug: string;
}

interface Instruction {
  id: number;
  workflow_type_id: number;
  name: string;
  content: string;
  tags?: string | null;
  active: boolean;
}

interface AvailableModel extends AvailableExpressionModel {}

interface GeneratedImage extends GeneratedImageLike {
  file?: File;
  assetId?: number;
  actionDescription?: string;
  sourceImageId?: number;
}

interface GenerateResponse {
  task_id: number;
  model_provider: string;
  model_name: string;
  images: Array<{ image_id?: number; id?: number; url?: string; image_url?: string; type?: string }>;
  token_used: number;
  cost_usd: number;
}

interface WorkflowSessionResponse {
  id: number;
  session_id: number;
  workflow_type: string;
  mode: "full" | "retouch" | string;
  status: "draft" | "completed" | string;
  current_step: number;
  state_json?: string | null;
  task_id?: number | null;
}

interface WorkflowState {
  sessionId: number | null;
  mode: "full" | "refine" | null;
  maxVisitedStep: number;
  taskId: number | null;
  taskName: string;
  category: string;
  tags: string[];
  taskTags: string[];
  instructionIds: number[];
  extraPrompt: string;
  selectedAssetIds: number[];
  assetFilterTags: string[];
  assetCategory: string;
  size: string;
  background: "white_png" | "transparent";
  count: number;
  actionList: string[];
  selectedActionIndices: number[];
  draftModelId: string;
  finalModelId: string;
  draftImages: GeneratedImage[];
  selectedDraftImageIds: number[];
  refineInstructionIds: number[];
  refinePrompt: string;
  uploadedRefineImages: GeneratedImage[];
  finalImages: GeneratedImage[];
  finalGeneratedCount: number;
  selectedConsistencySourceImageIds: number[];
  uploadedConsistencyImages: GeneratedImage[];
  consistencyInstructionIds: number[];
  consistencyPrompt: string;
  consistencyAssetIds: number[];
  consistencyAssetPanelOpen: boolean;
  consistencyModelId: string;
  consistencyCount: number;
  consistencyImages: GeneratedImage[];
  refinedImageCount: number;
  confirmedImages: GeneratedImage[];
  toRefineImages: GeneratedImage[];
  confirmedFinalImageIds: number[];
  archivedImageCount: number;
  archiveTags: string[];
  archiveImageTags: Record<string, string[]>;
  archived: boolean;
}

const initialWorkflowState: WorkflowState = {
  sessionId: null,
  mode: null,
  maxVisitedStep: 0,
  taskId: null,
  taskName: "",
  category: "expression",
  tags: [],
  taskTags: [],
  instructionIds: [],
  extraPrompt: "",
  selectedAssetIds: [],
  assetFilterTags: [],
  assetCategory: "expression",
  size: "1024x1024",
  background: "white_png",
  count: 4,
  actionList: DEFAULT_ACTION_LIST,
  selectedActionIndices: [],
  draftModelId: "",
  finalModelId: "",
  draftImages: [],
  selectedDraftImageIds: [],
  refineInstructionIds: [],
  refinePrompt: "",
  uploadedRefineImages: [],
  finalImages: [],
  finalGeneratedCount: 0,
  selectedConsistencySourceImageIds: [],
  uploadedConsistencyImages: [],
  consistencyInstructionIds: [],
  consistencyPrompt: "",
  consistencyAssetIds: [],
  consistencyAssetPanelOpen: false,
  consistencyModelId: "",
  consistencyCount: 2,
  consistencyImages: [],
  refinedImageCount: 0,
  confirmedImages: [],
  toRefineImages: [],
  confirmedFinalImageIds: [],
  archivedImageCount: 0,
  archiveTags: [],
  archiveImageTags: {},
  archived: false,
};

function getTagOptionName(tag: AssetTagOption | string): string {
  return typeof tag === "string" ? tag.trim() : String(tag?.name || "").trim();
}

function dedupeTagOptions<T extends AssetTagOption | string>(options: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const tag of options) {
    const name = getTagOptionName(tag);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(tag);
  }
  return result;
}

function normalizeAssetTagNames(tags: AssetTagOption[]) {
  return dedupeTagOptions(
    (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        ...tag,
        name: String(tag?.name || "").trim(),
      }))
      .filter((tag) => tag.name),
  );
}

function absoluteUrl(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:")) {
    return url;
  }
  return `${API_BASE}${url}`;
}

function toggleInList<T>(items: T[], item: T) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
}

function sessionModeFromWorkflowMode(mode: WorkflowState["mode"]) {
  return mode === "refine" ? "retouch" : "full";
}

function workflowModeFromSessionMode(mode?: string | null): WorkflowState["mode"] {
  return mode === "retouch" ? "refine" : "full";
}

function sanitizeWorkflowStateForSave(state: WorkflowState): WorkflowState {
  return {
    ...state,
    uploadedRefineImages: state.uploadedRefineImages.map(({ file, ...image }) => image),
    uploadedConsistencyImages: state.uploadedConsistencyImages.map(({ file, ...image }) => image),
  };
}

function parseWorkflowStatePayload(
  session: WorkflowSessionResponse,
  fallbackModels: { draftModelId: string; finalModelId: string },
  requestedStep?: string | null,
) {
  let parsed: Partial<WorkflowState> = {};
  try {
    parsed = session.state_json ? JSON.parse(session.state_json) : {};
  } catch {
    parsed = {};
  }

  const parsedMode = (parsed as Record<string, any>).mode;
  const mode = parsedMode === "retouch" ? "refine" : parsed.mode || workflowModeFromSessionMode(session.mode);
  const currentStep = resolveWorkflowSessionStep(session.current_step, mode, requestedStep, TOTAL_STEPS);
  const parsedRecord = parsed as Record<string, any>;
  const taskTags = normalizeTags(
    Array.isArray(parsedRecord.taskTags)
      ? parsedRecord.taskTags
      : Array.isArray(parsed.tags)
        ? parsed.tags
        : [],
  );
  const category = resolveExpressionWorkflowCategory(parsedRecord.category || parsedRecord.assetCategory);
  const restoredAssetCategory = String(parsedRecord.assetCategory || "");
  const assetCategory = restoredAssetCategory && restoredAssetCategory !== "all"
    ? restoredAssetCategory
    : category;
  const archiveTags = currentStep >= 9
    ? buildDefaultArchiveTags(taskTags)
    : normalizeTags(Array.isArray(parsed.archiveTags) ? parsed.archiveTags : []);
  const parsedArchiveImageTags =
    parsedRecord.archiveImageTags && typeof parsedRecord.archiveImageTags === "object"
      ? Object.entries(parsedRecord.archiveImageTags).reduce<Record<string, string[]>>((items, [imageId, tags]) => {
          const numericId = Number(imageId);
          if (Number.isFinite(numericId) && Array.isArray(tags)) {
            items[String(numericId)] = normalizeTags(tags);
          }
          return items;
        }, {})
      : {};
  const legacyReviewImages = collectReviewImages(
    Array.isArray(parsed.finalImages) ? parsed.finalImages : [],
    Array.isArray(parsed.consistencyImages) ? parsed.consistencyImages : [],
  );
  const parsedConfirmedImages = Array.isArray(parsed.confirmedImages)
    ? parsed.confirmedImages
    : legacyReviewImages.filter((image) =>
        (Array.isArray(parsed.confirmedFinalImageIds) ? parsed.confirmedFinalImageIds : []).includes(image.id),
      );
  const parsedToRefineImages = Array.isArray(parsed.toRefineImages) ? parsed.toRefineImages : [];
  const confirmedImageIds = parsedConfirmedImages.map((image) => image.id);
  const archiveImageTags = currentStep >= 9
    ? mergeDefaultArchiveImageTags(confirmedImageIds, taskTags, parsedArchiveImageTags)
    : parsedArchiveImageTags;
  return {
    state: {
      ...initialWorkflowState,
      ...parsed,
      mode,
      sessionId: session.session_id || session.id,
      taskId: parsed.taskId || session.task_id || null,
      category,
      assetCategory,
      tags: taskTags,
      taskTags,
      archiveTags,
      archiveImageTags,
      draftModelId: parsed.draftModelId || fallbackModels.draftModelId,
      finalModelId: parsed.finalModelId || fallbackModels.finalModelId,
      consistencyModelId: parsed.consistencyModelId || fallbackModels.finalModelId,
      confirmedImages: parsedConfirmedImages,
      toRefineImages: parsedToRefineImages,
      actionList: Array.isArray(parsed.actionList) ? parsed.actionList : DEFAULT_ACTION_LIST,
      selectedActionIndices: Array.isArray(parsed.selectedActionIndices) ? parsed.selectedActionIndices : [],
      maxVisitedStep: Math.max(Number(parsed.maxVisitedStep || 0), currentStep),
    },
    currentStep,
  };
}

function TagSelector({
  options,
  selected,
  onToggle,
  emptyText,
}: {
  options: Array<AssetTagOption | string>;
  selected: string[];
  onToggle: (tag: string) => void;
  emptyText?: string;
}) {
  const { t, lang } = useLanguage();
  const safeOptions = dedupeTagOptions(Array.isArray(options) ? options : []);
  const safeSelected = Array.isArray(selected) ? selected : [];

  if (safeOptions.length === 0) {
    return <p className="text-sm text-gray-400">{emptyText || t("暂无标签")}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {safeOptions.map((tag) => {
        const tagName = getTagOptionName(tag);
        const active = safeSelected.includes(tagName);
        return (
          <button
            key={tagName}
            type="button"
            onClick={() => onToggle(tagName)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {getTagLabel(tag, lang)}
          </button>
        );
      })}
    </div>
  );
}

function ArchiveTagEditor({
  options,
  selected,
  newTagValue,
  onNewTagChange,
  onAddTag,
  onRemoveTag,
}: {
  options: Array<AssetTagOption | string>;
  selected: string[];
  newTagValue: string;
  onNewTagChange: (value: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}) {
  const { t, lang } = useLanguage();
  const safeSelected = normalizeTags(selected);
  const selectableOptions = dedupeTagOptions(Array.isArray(options) ? options : []).filter((tag) => {
    const tagName = getTagOptionName(tag);
    return tagName && !safeSelected.includes(tagName);
  });

  return (
    <div className="space-y-3">
      {safeSelected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {safeSelected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white"
            >
              {getTagLabel(tag, lang)}
              <button
                type="button"
                onClick={() => onRemoveTag(tag)}
                className="rounded-full px-1 text-white/80 transition hover:bg-white/15 hover:text-white"
                aria-label={`移除 ${tag}`}
              >
                {t("移除")}
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">{t("暂无归档标签")}</p>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <select
          value=""
          onChange={(event) => {
            if (!event.target.value) return;
            onAddTag(event.target.value);
          }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
        >
          <option value="">{t("从已有标签选择")}</option>
          {selectableOptions.map((tag) => (
            <option key={typeof tag === "string" ? tag : tag.name} value={typeof tag === "string" ? tag : tag.name}>
              {getTagLabel(tag, lang)}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <input
            value={newTagValue}
            onChange={(event) => onNewTagChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onAddTag(newTagValue);
            }}
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            placeholder={t("输入新标签")}
          />
          <button
            type="button"
            onClick={() => onAddTag(newTagValue)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {t("添加")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstructionSelector({
  instructions,
  selectedIds,
  onToggle,
}: {
  instructions: Instruction[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}) {
  const { t } = useLanguage();
  const safeInstructions = Array.isArray(instructions) ? instructions : [];
  if (safeInstructions.length === 0) {
    return <p className="text-sm text-gray-400">{t("当前工作流暂无可用指令")}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {safeInstructions.map((instruction) => {
        const active = selectedIds.includes(instruction.id);
        return (
          <button
            key={instruction.id}
            type="button"
            onClick={() => onToggle(instruction.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {instruction.name}
          </button>
        );
      })}
    </div>
  );
}

export default function ExpressionWorkflowPage() {
  const { t } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);
  const [workflowState, setWorkflowState] = useState<WorkflowState>(initialWorkflowState);
  const [workflowTypeId, setWorkflowTypeId] = useState<number | null>(null);
  const [assetTags, setAssetTags] = useState<AssetTagOption[]>([]);
  const [referenceAssetTags, setReferenceAssetTags] = useState<AssetTagOption[]>([]);
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [selectedAssetCache, setSelectedAssetCache] = useState<Asset[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);
  const [generatingFinal, setGeneratingFinal] = useState(false);
  const [generatingConsistency, setGeneratingConsistency] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [taskTagInput, setTaskTagInput] = useState("");
  const [draftGenerationError, setDraftGenerationError] = useState("");
  const [draftGenerationProgress, setDraftGenerationProgress] = useState("");
  const [finalGenerationError, setFinalGenerationError] = useState("");
  const [consistencyGenerationError, setConsistencyGenerationError] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const [failedConsistencyImage, setFailedConsistencyImage] = useState<GeneratedImage | null>(null);
  const [selectedRefineImageIds, setSelectedRefineImageIds] = useState<number[]>([]);
  const [newArchiveImageTags, setNewArchiveImageTags] = useState<Record<number, string>>({});
  const workflowStateRef = useRef<WorkflowState>(initialWorkflowState);
  const autosaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const workflowSessionIdRef = useRef<number | null>(null);

  const safeInstructions = Array.isArray(instructions) ? instructions : [];
  const safeReferenceAssets = Array.isArray(referenceAssets) ? referenceAssets : [];
  const safeAssetTags = Array.isArray(assetTags) ? assetTags : [];
  const safeReferenceAssetTags = Array.isArray(referenceAssetTags) ? referenceAssetTags : [];
  const safeAvailableModels = Array.isArray(availableModels) ? availableModels : [];
  const safeAssetCategories = Array.isArray(ASSET_CATEGORIES) ? ASSET_CATEGORIES : [];
  const expressionWorkflowCategoryOptions = useMemo(
    () => getExpressionWorkflowCategoryOptions(safeAssetCategories),
    [safeAssetCategories],
  );
  const workflowSteps = useMemo(() => STEP_TITLES.map((label) => ({ label: t(label) })), [t]);
  const modelRecommendation = useMemo(
    () => recommendExpressionModels(safeAvailableModels),
    [safeAvailableModels],
  );
  const draftModelOptions = useMemo(
    () => filterExpressionModelsForPurpose(safeAvailableModels, "draft"),
    [safeAvailableModels],
  );
  const finalModelOptions = useMemo(
    () => filterExpressionModelsForPurpose(safeAvailableModels, "final"),
    [safeAvailableModels],
  );
  const effectiveDraftModelId = useMemo(
    () => resolveSelectedModelId(draftModelOptions, workflowState.draftModelId),
    [draftModelOptions, workflowState.draftModelId],
  );
  const effectiveFinalModelId = useMemo(
    () => resolveSelectedModelId(finalModelOptions, workflowState.finalModelId),
    [finalModelOptions, workflowState.finalModelId],
  );
  const effectiveConsistencyModelId = useMemo(
    () => resolveSelectedModelId(finalModelOptions, workflowState.consistencyModelId || workflowState.finalModelId),
    [finalModelOptions, workflowState.consistencyModelId, workflowState.finalModelId],
  );

  const selectedInstructionContents = useMemo(
    () =>
      safeInstructions
        .filter((instruction) => workflowState.instructionIds.includes(instruction.id))
        .map((instruction) => instruction.content),
    [safeInstructions, workflowState.instructionIds],
  );

  const finalPrompt = buildExpressionDraftPrompt(selectedInstructionContents, workflowState.extraPrompt);
  const filledActionList = useMemo(
    () => getFilledActionList(workflowState.actionList),
    [workflowState.actionList],
  );
  const allActionIndices = useMemo(
    () => filledActionList.map((_, index) => index),
    [filledActionList],
  );
  const numberedCollageDraftPrompt = useMemo(
    () => buildNumberedCollageDraftPrompt(selectedInstructionContents, workflowState.extraPrompt, filledActionList),
    [filledActionList, selectedInstructionContents, workflowState.extraPrompt],
  );

  const refineInstructionContent = useMemo(
    () =>
      safeInstructions
        .filter((instruction) => workflowState.refineInstructionIds.includes(instruction.id))
        .map((instruction) => instruction.content)
        .join("\n\n"),
    [safeInstructions, workflowState.refineInstructionIds],
  );

  const refinePrompt = [refineInstructionContent, workflowState.refinePrompt.trim()]
    .filter(Boolean)
    .join("\n\n");

  const consistencyInstructionContent = useMemo(
    () =>
      safeInstructions
        .filter((instruction) => workflowState.consistencyInstructionIds.includes(instruction.id))
        .map((instruction) => instruction.content)
        .join("\n\n"),
    [safeInstructions, workflowState.consistencyInstructionIds],
  );

  const consistencyPrompt = [consistencyInstructionContent, workflowState.consistencyPrompt.trim()]
    .filter(Boolean)
    .join("\n\n");

  const existingSelectedAssetIds = useMemo(
    () => filterExistingAssetIds(workflowState.selectedAssetIds, selectedAssetCache),
    [workflowState.selectedAssetIds, selectedAssetCache],
  );
  const selectedAssets = selectedAssetCache.filter((asset) => existingSelectedAssetIds.includes(asset.id));
  const effectiveConsistencyAssetIds =
    workflowState.consistencyAssetIds.length > 0
      ? workflowState.consistencyAssetIds
      : workflowState.selectedAssetIds;
  const selectedConsistencyAssets = selectedAssetCache.filter((asset) =>
    effectiveConsistencyAssetIds.includes(asset.id),
  );
  const selectedDraftImages = [
    ...workflowState.draftImages,
    ...workflowState.uploadedRefineImages,
  ].filter((image) => workflowState.selectedDraftImageIds.includes(image.id));
  const consistencySourceImages = [
    ...workflowState.toRefineImages,
    ...workflowState.uploadedConsistencyImages,
  ];
  const selectedConsistencySourceImages = consistencySourceImages.filter((image) =>
    workflowState.selectedConsistencySourceImageIds.includes(image.id),
  );
  const selectedStep7RefineImages = workflowState.toRefineImages.filter((image) =>
    selectedRefineImageIds.includes(image.id),
  );
  const allStep7RefineSelected =
    workflowState.toRefineImages.length > 0 &&
    selectedRefineImageIds.length === workflowState.toRefineImages.length;
  const reviewImages = workflowState.confirmedImages;
  const confirmedFinalImages = workflowState.confirmedImages;
  const taskStats = useMemo(
    () => buildExpressionTaskStats({
      actionList: workflowState.actionList,
      draftImages: workflowState.draftImages,
      finalGeneratedCount: workflowState.finalGeneratedCount,
      finalImages: workflowState.finalImages,
      confirmedImages: workflowState.confirmedImages,
      toRefineImages: workflowState.toRefineImages,
      consistencyImages: workflowState.consistencyImages,
      refinedImageCount: workflowState.refinedImageCount,
      archivedImageCount: workflowState.archivedImageCount,
    }),
    [
      workflowState.actionList,
      workflowState.draftImages,
      workflowState.finalGeneratedCount,
      workflowState.finalImages,
      workflowState.confirmedImages,
      workflowState.toRefineImages,
      workflowState.consistencyImages,
      workflowState.refinedImageCount,
      workflowState.archivedImageCount,
    ],
  );
  const effectiveTaskTags = workflowState.taskTags.length > 0
    ? normalizeTags(workflowState.taskTags)
    : normalizeTags(workflowState.tags);

  useEffect(() => {
    setSelectedRefineImageIds((current) =>
      current.filter((imageId) => workflowState.toRefineImages.some((image) => image.id === imageId)),
    );
  }, [workflowState.toRefineImages]);

  async function refreshExpressionAssets(category = workflowState.category) {
    const tagRes = await apiGet<AssetTagOption[]>(buildAssetTagQueryPath(category));
    if (tagRes.code !== 0) throw new Error(tagRes.msg || "标签刷新失败");
    setAssetTags(normalizeAssetTagNames(Array.isArray(tagRes.data) ? tagRes.data : []));
  }

  async function loadReferenceAssets(category: string, tags: string[]) {
    const [tagRes, assetRes] = await Promise.all([
      apiGet<AssetTagOption[]>(buildAssetTagQueryPath(category)),
      apiGet<Asset[]>(buildAssetQueryPath(category, tags)),
    ]);
    if (tagRes.code !== 0) throw new Error(tagRes.msg || "参考素材标签加载失败");
    if (assetRes.code !== 0) throw new Error(assetRes.msg || "参考素材加载失败");
    setReferenceAssetTags(normalizeAssetTagNames(Array.isArray(tagRes.data) ? tagRes.data : []));
    setReferenceAssets(Array.isArray(assetRes.data) ? assetRes.data : []);
    await syncSelectedAssetIdsWithExistingAssets(workflowState.selectedAssetIds);
  }

  async function loadSelectedAssetCache(assetIds: number[]) {
    if (assetIds.length === 0) {
      setSelectedAssetCache([]);
      return;
    }
    await syncSelectedAssetIdsWithExistingAssets(assetIds);
  }

  async function syncSelectedAssetIdsWithExistingAssets(assetIds: number[]) {
    if (assetIds.length === 0) {
      setSelectedAssetCache([]);
      return;
    }
    const res = await apiGet<Asset[]>("/api/assets");
    if (res.code !== 0) throw new Error(res.msg || t("已选素材恢复失败"));
    const assets = Array.isArray(res.data) ? res.data : [];
    const existingAssetIds = filterExistingAssetIds(assetIds, assets);
    setSelectedAssetCache(assets.filter((asset) => existingAssetIds.includes(asset.id)));
    setWorkflowState((current) => {
      const nextSelectedAssetIds = filterExistingAssetIds(current.selectedAssetIds, assets);
      const nextConsistencyAssetIds = filterExistingAssetIds(current.consistencyAssetIds, assets);
      if (
        nextSelectedAssetIds.length === current.selectedAssetIds.length &&
        nextConsistencyAssetIds.length === current.consistencyAssetIds.length
      ) {
        return current;
      }
      return {
        ...current,
        selectedAssetIds: nextSelectedAssetIds,
        consistencyAssetIds: nextConsistencyAssetIds,
      };
    });
  }

  async function saveWorkflowSession(options?: {
    status?: "draft" | "completed";
    silent?: boolean;
    stateOverride?: WorkflowState;
    currentStepOverride?: number;
  }) {
    const stateToSave = sanitizeWorkflowStateForSave(options?.stateOverride || workflowState);
    if (!stateToSave.mode) {
      if (!options?.silent) setError("请先选择工作流模式");
      return null;
    }

    if (!options?.silent) {
      setSavingDraft(true);
      setError("");
      setMessage("");
    }

    try {
      const nextStep = options?.currentStepOverride || currentStep || (stateToSave.mode === "refine" ? 6 : 1);
      const res = await apiPost<WorkflowSessionResponse>("/api/workflow-sessions/save", {
        session_id: stateToSave.sessionId,
        workflow_type: "expression",
        mode: sessionModeFromWorkflowMode(stateToSave.mode),
        status: options?.status || (stateToSave.archived ? "completed" : "draft"),
        current_step: nextStep,
        state_json: JSON.stringify({ ...stateToSave, sessionId: stateToSave.sessionId }),
        task_id: stateToSave.taskId,
      });

      if (res.code !== 0 || !res.data?.session_id) {
        throw new Error(res.msg || "草稿保存失败");
      }

      const sessionId = res.data.session_id;
      workflowSessionIdRef.current = sessionId;
      if (!stateToSave.sessionId) {
        await apiPost<WorkflowSessionResponse>("/api/workflow-sessions/save", {
          session_id: sessionId,
          workflow_type: "expression",
          mode: sessionModeFromWorkflowMode(stateToSave.mode),
          status: options?.status || (stateToSave.archived ? "completed" : "draft"),
          current_step: nextStep,
          state_json: JSON.stringify({ ...stateToSave, sessionId }),
          task_id: stateToSave.taskId,
        });
      }
      setWorkflowState((current) => {
        if (current.sessionId === sessionId) return current;
        const nextState = { ...current, sessionId };
        workflowStateRef.current = nextState;
        return nextState;
      });
      if (!options?.silent) setMessage("草稿已保存");
      return sessionId;
    } catch (err) {
      if (options?.silent) {
        console.error("[expression workflow] autosave failed", err);
      }
      if (!options?.silent) setError(err instanceof Error ? err.message : "草稿保存失败");
      return null;
    } finally {
      if (!options?.silent) setSavingDraft(false);
    }
  }

  function queueSilentWorkflowSave(
    stateOverride: WorkflowState,
    options?: {
      status?: "draft" | "completed";
      currentStepOverride?: number;
    },
  ) {
    autosaveQueueRef.current = autosaveQueueRef.current
      .catch(() => undefined)
      .then(() => {
        const stateForSave =
          stateOverride.sessionId || !workflowSessionIdRef.current
            ? stateOverride
            : { ...stateOverride, sessionId: workflowSessionIdRef.current };
        return saveWorkflowSession({
          silent: true,
          stateOverride: stateForSave,
          currentStepOverride: options?.currentStepOverride ?? currentStep,
          status: options?.status,
        });
      })
      .then(() => undefined)
      .catch((err) => {
        console.error("[expression workflow] autosave queue failed", err);
      });
    return autosaveQueueRef.current;
  }

  useEffect(() => {
    workflowStateRef.current = workflowState;
    workflowSessionIdRef.current = workflowState.sessionId;
  }, [workflowState]);

  useEffect(() => {
    async function loadBaseData() {
      setLoading(true);
      setError("");
      try {
        const [workflowRes, tagRes, referenceTagRes, referenceAssetRes, modelRes] = await Promise.all([
          apiGet<WorkflowType[]>("/api/workflow-types"),
          apiGet<AssetTagOption[]>(buildAssetTagQueryPath(initialWorkflowState.category)),
          apiGet<AssetTagOption[]>(buildAssetTagQueryPath(initialWorkflowState.assetCategory)),
          apiGet<Asset[]>(buildAssetQueryPath(initialWorkflowState.assetCategory, [])),
          apiGet<AvailableModel[]>("/api/model-configs/available?purpose=image"),
        ]);

        if (workflowRes.code !== 0) throw new Error(workflowRes.msg || "工作流类型加载失败");
        if (tagRes.code !== 0) throw new Error(tagRes.msg || "标签加载失败");
        if (referenceTagRes.code !== 0) throw new Error(referenceTagRes.msg || "参考素材标签加载失败");
        if (referenceAssetRes.code !== 0) throw new Error(referenceAssetRes.msg || "参考素材加载失败");
        if (modelRes.code !== 0) throw new Error(modelRes.msg || "模型加载失败");

        const workflows = Array.isArray(workflowRes.data) ? workflowRes.data : [];
        const expressionWorkflow = workflows.find((workflow) => workflow.slug === "expression");
        const nextModels = Array.isArray(modelRes.data) ? modelRes.data : [];
        const nextRecommendation = recommendExpressionModels(nextModels);
        setWorkflowTypeId(expressionWorkflow?.id || null);
        setAssetTags(normalizeAssetTagNames(Array.isArray(tagRes.data) ? tagRes.data : []));
        setReferenceAssetTags(
          normalizeAssetTagNames(Array.isArray(referenceTagRes.data) ? referenceTagRes.data : []),
        );
        setReferenceAssets(Array.isArray(referenceAssetRes.data) ? referenceAssetRes.data : []);
        setAvailableModels(nextModels);
        setWorkflowState((current) => ({
          ...current,
          draftModelId: current.draftModelId || nextRecommendation.draftModelId,
          finalModelId: current.finalModelId || nextRecommendation.finalModelId,
          consistencyModelId: current.consistencyModelId || nextRecommendation.finalModelId,
        }));

        if (expressionWorkflow?.id) {
          const instructionRes = await apiGet<Instruction[]>(
            `/api/instructions?workflow_type_id=${expressionWorkflow.id}`,
          );
          if (instructionRes.code === 0) {
            setInstructions(
              (Array.isArray(instructionRes.data) ? instructionRes.data : []).filter(
                (instruction) => instruction.active,
              ),
            );
          }
        }

        const searchParams =
          typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
        const sessionIdParam = searchParams.get("session_id") || "";
        const requestedStepParam = searchParams.get("step");
        if (sessionIdParam) {
          const sessionRes = await apiGet<WorkflowSessionResponse>(`/api/workflow-sessions/${sessionIdParam}`);
          if (sessionRes.code !== 0 || !sessionRes.data) {
            throw new Error(sessionRes.msg || "草稿加载失败");
          }
          const restored = parseWorkflowStatePayload(sessionRes.data, nextRecommendation, requestedStepParam);
          setWorkflowState(restored.state);
          setCurrentStep(restored.currentStep);
          await loadReferenceAssets(restored.state.assetCategory, restored.state.assetFilterTags);
          await loadSelectedAssetCache(mergeUniqueNumbers(restored.state.selectedAssetIds, restored.state.consistencyAssetIds));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "工作流基础数据加载失败");
      } finally {
        setLoading(false);
      }
    }

    loadBaseData();
  }, []);

  useEffect(() => {
    if (loading || currentStep <= 0 || !workflowState.mode) return;
    void saveWorkflowSession({ silent: true });
  }, [currentStep]);

  useEffect(() => {
    if (safeAvailableModels.length === 0) return;
    setWorkflowState((current) => {
      const nextDraftModelId = resolveSelectedModelId(draftModelOptions, current.draftModelId);
      const nextFinalModelId = resolveSelectedModelId(finalModelOptions, current.finalModelId);
      const nextConsistencyModelId = resolveSelectedModelId(
        finalModelOptions,
        current.consistencyModelId || nextFinalModelId,
      );

      if (
        nextDraftModelId === current.draftModelId &&
        nextFinalModelId === current.finalModelId &&
        nextConsistencyModelId === current.consistencyModelId
      ) {
        return current;
      }

      return {
        ...current,
        draftModelId: nextDraftModelId,
        finalModelId: nextFinalModelId,
        consistencyModelId: nextConsistencyModelId,
      };
    });
  }, [safeAvailableModels, draftModelOptions, finalModelOptions, modelRecommendation]);

  useEffect(() => {
    if (loading || (currentStep !== 3 && currentStep !== 5)) return;
    void syncSelectedAssetIdsWithExistingAssets(workflowState.selectedAssetIds).catch((err) => {
      setError(err instanceof Error ? err.message : "已选参考素材同步失败");
    });
  }, [currentStep, loading, workflowState.selectedAssetIds]);

  useEffect(() => {
    if (loading || currentStep !== 9 || confirmedFinalImages.length === 0) return;
    setWorkflowState((current) => {
      const currentTaskTags = current.taskTags.length > 0 ? current.taskTags : current.tags;
      const nextArchiveImageTags = mergeDefaultArchiveImageTags(
        current.confirmedImages.map((image) => image.id),
        currentTaskTags,
        current.archiveImageTags,
      );
      const changed = JSON.stringify(nextArchiveImageTags) !== JSON.stringify(current.archiveImageTags);
      if (!changed) return current;
      return {
        ...current,
        taskTags: buildDefaultArchiveTags(currentTaskTags),
        archiveTags: buildDefaultArchiveTags(currentTaskTags),
        archiveImageTags: nextArchiveImageTags,
      };
    });
  }, [currentStep, loading, confirmedFinalImages.length]);

  useEffect(() => {
    if (!previewImage) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewImage(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewImage]);

  function updateWorkflowState(patch: Partial<WorkflowState>) {
    setWorkflowState((current) => {
      const nextState = { ...current, ...patch };
      workflowStateRef.current = nextState;
      return nextState;
    });
  }

  function setWorkflowStateAndAutosave(
    nextState: WorkflowState,
    options?: {
      status?: "draft" | "completed";
      currentStepOverride?: number;
    },
  ) {
    workflowStateRef.current = nextState;
    setWorkflowState(nextState);
    return queueSilentWorkflowSave(nextState, options);
  }

  function updateTaskTags(nextTags: string[]) {
    const normalizedTags = normalizeTags(nextTags);
    updateWorkflowState({
      tags: normalizedTags,
      taskTags: normalizedTags,
      archiveTags: buildDefaultArchiveTags(normalizedTags),
    });
  }

  function handleTaskTagInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();

    const nextTags = addTaskTag(effectiveTaskTags, taskTagInput);
    updateTaskTags(nextTags);
    setTaskTagInput("");
  }

  async function handleWorkflowCategoryChange(category: string) {
    const nextCategory = resolveExpressionWorkflowCategory(category);
    setError("");
    updateWorkflowState({
      category: nextCategory,
      assetCategory: nextCategory,
      assetFilterTags: [],
    });
    try {
      await Promise.all([
        refreshExpressionAssets(nextCategory),
        loadReferenceAssets(nextCategory, []),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考素材加载失败");
    }
  }

  function setArchiveImageTagInput(imageId: number, value: string) {
    setNewArchiveImageTags((current) => ({ ...current, [imageId]: value }));
  }

  function addArchiveImageTag(imageId: number, tag: string) {
    const trimmedTag = tag.trim();
    if (!trimmedTag) return;
    setWorkflowState((current) => {
      const currentTaskTags = current.taskTags.length > 0 ? current.taskTags : current.tags;
      const currentTags = getImageArchiveTags(imageId, current.archiveImageTags, currentTaskTags);
      return {
        ...current,
        archiveImageTags: {
          ...current.archiveImageTags,
          [imageId]: normalizeTags([...currentTags, trimmedTag]),
        },
      };
    });
    setArchiveImageTagInput(imageId, "");
  }

  function removeArchiveImageTag(imageId: number, tag: string) {
    setWorkflowState((current) => {
      const currentTaskTags = current.taskTags.length > 0 ? current.taskTags : current.tags;
      const currentTags = getImageArchiveTags(imageId, current.archiveImageTags, currentTaskTags);
      return {
        ...current,
        archiveImageTags: {
          ...current.archiveImageTags,
          [imageId]: currentTags.filter((value) => value !== tag),
        },
      };
    });
  }

  function goToStep(step: number) {
    if (step <= workflowState.maxVisitedStep && step >= 1 && step <= TOTAL_STEPS) {
      setCurrentStep(step);
    }
  }

  async function ensureTaskCreated() {
    if (workflowState.taskId) return workflowState.taskId;
    const title = workflowState.taskName.trim() || `表情制作 ${new Date().toLocaleString()}`;
    const res = await apiPost<Task>("/api/tasks/create", {
      title,
      scene: "expression",
      size: workflowState.size,
      purpose: "牛角色表情图片生产工作流",
      description: finalPrompt || refinePrompt || "表情制作工作流任务",
    });
    if (res.code !== 0 || !res.data?.id) {
      throw new Error(res.msg || "任务创建失败");
    }
    updateWorkflowState({ taskId: res.data.id, taskName: title });
    return res.data.id;
  }

  async function handleNext() {
    setError("");
    setMessage("");

    try {
      if (currentStep === 1) {
        if (!workflowState.taskName.trim()) {
          setError("请填写任务名称");
          return;
        }
        await ensureTaskCreated();
        updateWorkflowState({
          taskTags: buildDefaultArchiveTags(workflowState.taskTags.length > 0 ? workflowState.taskTags : workflowState.tags),
          archiveTags: buildDefaultArchiveTags(workflowState.taskTags.length > 0 ? workflowState.taskTags : workflowState.tags),
        });
      }
      if (currentStep === 4 && filledActionList.length === 0) {
        setError("请至少填写 1 个动作描述");
        return;
      }
      if (currentStep === 4) {
        updateWorkflowState({ selectedActionIndices: allActionIndices });
      }
      if (currentStep === 6) {
        if (workflowState.finalImages.length > 0) {
          setError("请先处理所有成品图：直接归档或需要精修");
          return;
        }
        if (workflowState.confirmedImages.length === 0 && workflowState.toRefineImages.length === 0) {
          setError("请先生成并处理成品图");
          return;
        }
      }
      const nextStep = currentStep === 6 && workflowState.toRefineImages.length === 0
        ? 8
        : Math.min(currentStep + 1, TOTAL_STEPS);
      setWorkflowState((current) => ({
        ...current,
        archiveTags: nextStep === 9
          ? buildDefaultArchiveTags(current.taskTags.length > 0 ? current.taskTags : current.tags)
          : current.archiveTags,
        archiveImageTags: nextStep === 9
          ? mergeDefaultArchiveImageTags(
              current.confirmedImages.map((image) => image.id),
              current.taskTags.length > 0 ? current.taskTags : current.tags,
              current.archiveImageTags,
            )
          : current.archiveImageTags,
        maxVisitedStep: Math.max(current.maxVisitedStep, nextStep),
      }));
      setCurrentStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "进入下一步失败");
    }
  }

  function handlePrevious() {
    setError("");
    setMessage("");
    setCurrentStep((step) => Math.max(step - 1, 0));
  }

  function selectMode(mode: "full" | "refine") {
    const nextStep = mode === "full" ? 1 : 6;
    setWorkflowState((current) => ({
      ...current,
      mode,
      maxVisitedStep: Math.max(current.maxVisitedStep, nextStep),
      archiveTags: buildDefaultArchiveTags(current.taskTags.length > 0 ? current.taskTags : current.tags),
    }));
    setCurrentStep(nextStep);
  }

  async function generateDrafts() {
    const selectedModel = draftModelOptions.find((model) => model.id === Number(effectiveDraftModelId));
    if (!selectedModel) {
      setError(t("请选择低价草稿模型"));
      setDraftGenerationError(t("请选择低价草稿模型"));
      return;
    }
    if (filledActionList.length === 0) {
      setError("请先填写至少 1 个动作描述");
      setDraftGenerationError("请先填写至少 1 个动作描述");
      return;
    }

    setGeneratingDraft(true);
    setError("");
    setMessage("");
    setDraftGenerationError("");
    setDraftGenerationProgress("");
    setWorkflowState((current) => resetDraftGenerationState(current));

    try {
      const taskId = await ensureTaskCreated();
      const res = await apiPost<GenerateResponse>("/api/generate/image", {
        task_id: taskId,
        model_config_id: selectedModel.id,
        mode: "draft",
        model_provider: selectedModel.provider,
        model_name: selectedModel.model_name,
        prompt: numberedCollageDraftPrompt,
        size: workflowState.size,
        count: getNumberedCollageDraftRequestCount(filledActionList),
        reference_asset_ids: existingSelectedAssetIds,
      }, DRAFT_GENERATION_TIMEOUT_MS);

      if (res.code !== 0) {
        const failure = res.msg || "草稿生成失败";
        setDraftGenerationError(failure);
        setError(failure);
        return;
      }

      const nextImages = normalizeGeneratedImages(res.data, "draft");
      if (nextImages.length === 0) {
        const failure = "草稿生成失败：未返回可用图片";
        setDraftGenerationError(failure);
        setError(failure);
        return;
      }
      const nextState = {
        ...workflowStateRef.current,
        taskId,
        draftImages: nextImages,
        selectedDraftImageIds: [],
        selectedActionIndices: allActionIndices,
      };
      await setWorkflowStateAndAutosave(nextState);
      setMessage("草稿生成完成");
    } catch (err) {
      const failure = err instanceof Error ? err.message : "草稿生成失败";
      setDraftGenerationError(failure);
      setError(failure);
    } finally {
      setDraftGenerationProgress("");
      setGeneratingDraft(false);
    }
  }

  function handleRefineUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const nextImages = files.map((file, index) => ({
      id: Date.now() + index,
      url: URL.createObjectURL(file),
      type: "upload" as const,
      file,
    }));
    updateWorkflowState({
      uploadedRefineImages: [...workflowState.uploadedRefineImages, ...nextImages],
      selectedDraftImageIds: [
        ...workflowState.selectedDraftImageIds,
        ...nextImages.map((image) => image.id),
      ],
    });
  }

  function handleConsistencyUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const nextImages = files.map((file, index) => ({
      id: Date.now() + index,
      url: URL.createObjectURL(file),
      type: "upload" as const,
      file,
    }));
    updateWorkflowState({
      uploadedConsistencyImages: [...workflowState.uploadedConsistencyImages, ...nextImages],
      selectedConsistencySourceImageIds: [
        ...workflowState.selectedConsistencySourceImageIds,
        ...nextImages.map((image) => image.id),
      ],
    });
  }

  async function handleReferenceCategoryChange(category: string) {
    setError("");
    updateWorkflowState({ assetCategory: category, assetFilterTags: [] });
    try {
      await loadReferenceAssets(category, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考素材加载失败");
    }
  }

  async function handleReferenceTagToggle(tag: string) {
    const nextTags = toggleInList(workflowState.assetFilterTags, tag);
    setError("");
    updateWorkflowState({ assetFilterTags: nextTags });
    try {
      await loadReferenceAssets(workflowState.assetCategory, nextTags);
    } catch (err) {
      setError(err instanceof Error ? err.message : "参考素材加载失败");
    }
  }

  function handleReferenceAssetToggle(asset: Asset) {
    const selected = workflowState.selectedAssetIds.includes(asset.id);
    updateWorkflowState({
      selectedAssetIds: toggleInList(workflowState.selectedAssetIds, asset.id),
    });
    setSelectedAssetCache((current) => {
      if (selected) return current.filter((item) => item.id !== asset.id);
      if (current.some((item) => item.id === asset.id)) return current;
      return [...current, asset];
    });
  }

  function openConsistencyAssetPanel() {
    setWorkflowState((current) => ({
      ...current,
      consistencyAssetIds: current.consistencyAssetIds.length > 0 ? current.consistencyAssetIds : existingSelectedAssetIds,
      consistencyAssetPanelOpen: true,
    }));
  }

  function handleConsistencyReferenceAssetToggle(asset: Asset) {
    setWorkflowState((current) => {
      const currentIds = current.consistencyAssetIds.length > 0 ? current.consistencyAssetIds : current.selectedAssetIds;
      return {
        ...current,
        consistencyAssetIds: toggleInList(currentIds, asset.id),
        consistencyAssetPanelOpen: true,
      };
    });
    setSelectedAssetCache((current) => {
      if (current.some((item) => item.id === asset.id)) return current;
      return [...current, asset];
    });
  }

  async function persistSelectedUploadImages(taskId: number) {
    const selectedUploadImages = selectedDraftImages.filter((image) => image.type === "upload");
    const existingAssetIds = selectedUploadImages
      .map((image) => image.assetId)
      .filter((id): id is number => typeof id === "number");
    const imagesToPersist = selectedUploadImages.filter((image) => image.file && !image.assetId);
    const persistedPairs: Array<{ localId: number; asset: Asset }> = [];

    for (const image of imagesToPersist) {
      const file = image.file;
      if (!file) continue;
      const formData = new FormData();
      const safeName = file.name || `refine-source-${image.id}.png`;
      formData.append("file", file);
      formData.append("filename", `refine-source-${taskId}-${safeName}`);
      formData.append("category", "expression");
      formData.append("tags", Array.from(new Set([...workflowState.archiveTags, "直接精修源图"])).join(","));
      const res = await apiUpload<Asset>("/api/assets/upload", formData);
      if (res.code !== 0 || !res.data?.id) {
        throw new Error(res.msg || t("待精修图片上传失败"));
      }
      persistedPairs.push({ localId: image.id, asset: res.data });
    }

    if (persistedPairs.length > 0) {
      setWorkflowState((current) => ({
        ...current,
        uploadedRefineImages: current.uploadedRefineImages.map((image) => {
          const persisted = persistedPairs.find((item) => item.localId === image.id);
          return persisted
            ? { ...image, assetId: persisted.asset.id, url: persisted.asset.url }
            : image;
        }),
      }));
      await refreshExpressionAssets();
      await loadReferenceAssets(workflowState.assetCategory, workflowState.assetFilterTags);
    }

    return mergeUniqueNumbers(
      existingAssetIds,
      persistedPairs.map((item) => item.asset.id),
    );
  }

  async function persistSelectedConsistencyUploadImages(taskId: number) {
    const selectedUploadImages = selectedConsistencySourceImages.filter((image) => image.type === "upload");
    const existingAssetIds = selectedUploadImages
      .map((image) => image.assetId)
      .filter((id): id is number => typeof id === "number");
    const imagesToPersist = selectedUploadImages.filter((image) => image.file && !image.assetId);
    const persistedPairs: Array<{ localId: number; asset: Asset }> = [];

    for (const image of imagesToPersist) {
      const file = image.file;
      if (!file) continue;
      const formData = new FormData();
      const safeName = file.name || `consistency-source-${image.id}.png`;
      formData.append("file", file);
      formData.append("filename", `consistency-source-${taskId}-${safeName}`);
      formData.append("category", "expression");
      formData.append("tags", Array.from(new Set([...workflowState.archiveTags, "一致性精修源图"])).join(","));
      const res = await apiUpload<Asset>("/api/assets/upload", formData);
      if (res.code !== 0 || !res.data?.id) {
        throw new Error(res.msg || "一致性精修源图上传失败");
      }
      persistedPairs.push({ localId: image.id, asset: res.data });
    }

    if (persistedPairs.length > 0) {
      setWorkflowState((current) => ({
        ...current,
        uploadedConsistencyImages: current.uploadedConsistencyImages.map((image) => {
          const persisted = persistedPairs.find((item) => item.localId === image.id);
          return persisted
            ? { ...image, assetId: persisted.asset.id, url: persisted.asset.url }
            : image;
        }),
      }));
      await refreshExpressionAssets();
      await loadReferenceAssets(workflowState.assetCategory, workflowState.assetFilterTags);
    }

    return mergeUniqueNumbers(
      existingAssetIds,
      persistedPairs.map((item) => item.asset.id),
    );
  }

  async function persistConsistencySourceImageAsset(taskId: number, image: GeneratedImage) {
    if (image.assetId) return image.assetId;

    const extension = image.url.toLowerCase().split("?")[0].match(/\.(webp|jpe?g|png)$/)?.[1]?.replace("jpeg", "jpg") || "png";
    const formData = new FormData();
    if (image.file) {
      formData.append("file", image.file);
    } else {
      formData.append("source_url", absoluteUrl(image.url));
    }
    formData.append("filename", `consistency-source-${taskId}-${image.id}.${extension}`);
    formData.append("category", workflowState.category || "expression");
    formData.append("tags", Array.from(new Set([...workflowState.archiveTags, "一致性精修源图"])).join(","));

    const res = await apiUpload<Asset>("/api/assets/upload", formData, ARCHIVE_UPLOAD_TIMEOUT_MS);
    if (res.code !== 0 || !res.data?.id) {
      throw new Error(res.msg || "一致性精修源图保存失败");
    }

    const persistedAsset = res.data;
    setWorkflowState((current) => ({
      ...current,
      toRefineImages: current.toRefineImages.map((item) =>
        item.id === image.id
          ? { ...item, assetId: persistedAsset.id, url: persistedAsset.url }
          : item,
      ),
    }));
    return persistedAsset.id;
  }

  async function generateFinals() {
    const selectedModel = finalModelOptions.find((model) => model.id === Number(effectiveFinalModelId));
    if (!selectedModel) {
      setError(t("请选择高价成品模型"));
      setFinalGenerationError(t("请选择高价成品模型"));
      return;
    }
    if (workflowState.mode === "refine" && selectedDraftImages.length === 0) {
      setError(t("请先选择草稿图或上传待精修图片"));
      setFinalGenerationError(t("请先选择草稿图或上传待精修图片"));
      return;
    }
    if (workflowState.mode !== "refine" && workflowState.selectedActionIndices.length === 0) {
      setError(t("请至少勾选 1 个动作编号"));
      setFinalGenerationError(t("请至少勾选 1 个动作编号"));
      return;
    }

    setGeneratingFinal(true);
    setError("");
    setMessage("");
    setFinalGenerationError("");
    let workingState: WorkflowState = {
      ...workflowStateRef.current,
      finalImages: [],
      finalGeneratedCount: 0,
      confirmedImages: [],
      toRefineImages: [],
      confirmedFinalImageIds: [],
      selectedConsistencySourceImageIds: [],
      consistencyImages: [],
      refinedImageCount: 0,
    };
    workflowStateRef.current = workingState;
    setWorkflowState(workingState);

    try {
      const taskId = await ensureTaskCreated();
      workingState = {
        ...workingState,
        taskId,
      };
      const persistedUploadAssetIds = await persistSelectedUploadImages(taskId);
      const referenceAssetIds = mergeUniqueNumbers(
        existingSelectedAssetIds,
        persistedUploadAssetIds,
      );

      let nextImages: GeneratedImage[] = [];
      if (workflowState.mode === "refine") {
        const res = await apiPost<GenerateResponse>("/api/generate/image", {
          task_id: taskId,
          model_config_id: selectedModel.id,
          mode: "final",
          model_provider: selectedModel.provider,
          model_name: selectedModel.model_name,
          prompt: refinePrompt || finalPrompt || "精修为可归档的牛角色表情成品图",
          size: workflowState.size,
          count: Math.max(selectedDraftImages.length, 1),
          reference_asset_ids: referenceAssetIds,
          draft_image_id: selectedDraftImages[0]?.type === "draft" ? selectedDraftImages[0].id : null,
        }, FINAL_GENERATION_TIMEOUT_MS);

        if (res.code !== 0) {
          const failure = res.msg || "成品图生成失败";
          setFinalGenerationError(failure);
          setError(failure);
          return;
        }
        nextImages = assignWorkflowImageIds(normalizeGeneratedImages(res.data, "final"), Date.now());
        for (let imageIndex = 0; imageIndex < nextImages.length; imageIndex += 1) {
          const image = nextImages[imageIndex];
          const nextImage: GeneratedImage = {
            ...image,
            actionDescription: selectedDraftImages[imageIndex]?.actionDescription || image.actionDescription,
          };
          workingState = {
            ...workingState,
            finalImages: [...workingState.finalImages, nextImage],
            finalGeneratedCount: workingState.finalImages.length + 1,
            selectedConsistencySourceImageIds: [...workingState.selectedConsistencySourceImageIds, nextImage.id],
            consistencyAssetIds: workingState.consistencyAssetIds.length > 0
              ? workingState.consistencyAssetIds
              : existingSelectedAssetIds,
            maxVisitedStep: Math.max(workingState.maxVisitedStep, 7),
          };
          await setWorkflowStateAndAutosave(workingState);
        }
      } else {
        const baseFinalPrompt = refinePrompt || "精修为可归档的牛角色表情成品图";
        for (const actionIndex of workflowState.selectedActionIndices) {
          const action = filledActionList[actionIndex];
          if (!action) continue;
          const res = await apiPost<GenerateResponse>("/api/generate/image", {
            task_id: taskId,
            model_config_id: selectedModel.id,
            mode: "final",
            model_provider: selectedModel.provider,
            model_name: selectedModel.model_name,
            prompt: buildFinalActionPrompt(baseFinalPrompt, action),
            size: workflowState.size,
            count: 1,
            reference_asset_ids: referenceAssetIds,
          }, FINAL_GENERATION_TIMEOUT_MS);

          if (res.code !== 0) {
            throw new Error(res.msg || `${t("编号")} ${actionIndex + 1} ${t("成品图生成失败")}`);
          }
          const [image] = assignWorkflowImageIds(
            normalizeGeneratedImages(res.data, "final"),
            Date.now() + actionIndex * 1000,
          );
          if (!image) {
            throw new Error(`${t("编号")} ${actionIndex + 1} ${t("成品图生成失败：未返回可用图片")}`);
          }
          const nextImage: GeneratedImage = {
            ...image,
            actionDescription: action,
          };
          nextImages.push(nextImage);
          workingState = {
            ...workingState,
            finalImages: [...workingState.finalImages, nextImage],
            finalGeneratedCount: workingState.finalImages.length + 1,
            selectedConsistencySourceImageIds: [...workingState.selectedConsistencySourceImageIds, nextImage.id],
            consistencyAssetIds: workingState.consistencyAssetIds.length > 0
              ? workingState.consistencyAssetIds
              : existingSelectedAssetIds,
            maxVisitedStep: Math.max(workingState.maxVisitedStep, 7),
          };
          await setWorkflowStateAndAutosave(workingState);
        }
      }

      if (nextImages.length === 0) {
        const failure = t("成品图生成失败：未返回可用图片");
        setFinalGenerationError(failure);
        setError(failure);
        return;
      }
      setMessage(t("成品图生成完成"));
    } catch (err) {
      const failure = err instanceof Error ? err.message : "成品图生成失败";
      setFinalGenerationError(failure);
      setError(failure);
    } finally {
      setGeneratingFinal(false);
    }
  }

  async function archiveFinals() {
    if (confirmedFinalImages.length === 0) {
      setError("请先确认至少一张成品图");
      return;
    }

    setArchiving(true);
    setError("");
    setMessage("");

    try {
      const archiveBatchTimestamp = Date.now();
      const imagesToArchive = [...confirmedFinalImages];
      let workingState = workflowStateRef.current;
      for (let index = 0; index < imagesToArchive.length; index += 1) {
        const image = imagesToArchive[index];
        const extension = image.url.toLowerCase().split("?")[0].match(/\.(webp|jpe?g|png)$/)?.[1]?.replace("jpeg", "jpg") || "png";
        const formData = new FormData();
        formData.append("source_url", absoluteUrl(image.url));
        formData.append("filename", buildArchiveImageFilename(archiveBatchTimestamp, index, extension));
        formData.append("category", workingState.category);
        formData.append("tags", getImageArchiveTags(image.id, workingState.archiveImageTags, effectiveTaskTags).join(","));
        const res = await apiUpload<Asset>("/api/assets/upload", formData, ARCHIVE_UPLOAD_TIMEOUT_MS);
        if (res.code !== 0) throw new Error(res.msg || "归档失败");
        workingState = {
          ...workingState,
          archivedImageCount: workingState.archivedImageCount + 1,
          confirmedImages: workingState.confirmedImages.filter((item) => item.id !== image.id),
          confirmedFinalImageIds: workingState.confirmedFinalImageIds.filter((id) => id !== image.id),
        };
        workflowStateRef.current = workingState;
        setWorkflowState(workingState);
        await queueSilentWorkflowSave(workingState, { currentStepOverride: 9 });
      }
      const completedState = {
        ...workingState,
        archived: true,
        confirmedImages: [],
        confirmedFinalImageIds: [],
      };
      workflowStateRef.current = completedState;
      setWorkflowState(completedState);
      await refreshExpressionAssets();
      await loadReferenceAssets(workflowState.assetCategory, workflowState.assetFilterTags);
      await queueSilentWorkflowSave(completedState, {
        status: "completed",
        currentStepOverride: 9,
      });
      setMessage(t("归档完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "归档失败");
    } finally {
      setArchiving(false);
    }
  }

  function resetWorkflow() {
    setWorkflowState(initialWorkflowState);
    setCurrentStep(0);
    setError("");
    setMessage("");
  }

  function renderModeSelection() {
    return (
      <section className="grid gap-4 md:grid-cols-2">
        <button
          type="button"
          onClick={() => selectMode("full")}
          className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-900"
        >
          <h2 className="text-base font-semibold text-gray-900">{t("完整流程")}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{t("从任务信息、提示词、参考素材开始，生成草稿并精修归档。")}</p>
        </button>
        <button
          type="button"
          onClick={() => selectMode("refine")}
          className="rounded-lg border border-gray-200 bg-white p-5 text-left shadow-sm transition hover:border-gray-900"
        >
          <h2 className="text-base font-semibold text-gray-900">{t("直接精修")}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{t("跳到 Step 6，上传已有图片后直接生成成品图。")}</p>
        </button>
      </section>
    );
  }

  function renderStep1() {
    return (
      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="task-name">
              {t("任务名称")}
              </label>
            <input
              id="task-name"
              value={workflowState.taskName}
              onChange={(event) => updateWorkflowState({ taskName: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              placeholder={t("高兴表情制作")}
            />
          </div>
          <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="workflow-category">
              {t("分类")}
              </label>
            <select
              id="workflow-category"
              value={workflowState.category}
              onChange={(event) => handleWorkflowCategoryChange(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            >
              {expressionWorkflowCategoryOptions.map((category) => (
                <option key={category.value} value={category.value}>
                  {t(category.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-gray-700">{t("标签")}</p>
          <TagSelector
            options={[
              ...safeAssetTags,
              ...effectiveTaskTags.map((tag) => ({ name: tag })),
            ]}
            selected={effectiveTaskTags}
            onToggle={(tag) => {
              const nextTags = toggleInList(effectiveTaskTags, tag);
              updateTaskTags(nextTags);
            }}
          />
          <input
            value={taskTagInput}
            onChange={(event) => setTaskTagInput(event.target.value)}
            onKeyDown={handleTaskTagInputKeyDown}
            className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
            placeholder={t("输入新标签，回车添加")}
          />
        </div>
        {workflowState.taskId && (
          <p className="mt-4 text-sm text-emerald-700">{t("已创建任务")} #{workflowState.taskId}</p>
        )}
      </section>
    );
  }

  function renderStep2() {
    return (
      <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t("固定提示词")}</p>
          <InstructionSelector
            instructions={safeInstructions}
            selectedIds={workflowState.instructionIds}
            onToggle={(id) => updateWorkflowState({ instructionIds: toggleInList(workflowState.instructionIds, id) })}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700" htmlFor="extra-prompt">
            {t("附加提示词")}
          </label>
          <textarea
            id="extra-prompt"
            value={workflowState.extraPrompt}
            onChange={(event) => updateWorkflowState({ extraPrompt: event.target.value })}
            rows={5}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-6 outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
          />
        </div>
        <div className="rounded-md bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">{t("最终提示词预览")}</p>
          <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
            {finalPrompt || t("选择固定提示词或填写附加提示词后显示预览")}
          </pre>
        </div>
      </section>
    );
  }

  function renderStep3() {
    return (
      <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-gray-700" htmlFor="reference-asset-category">
            {t("素材分类")}
          </label>
          <select
            id="reference-asset-category"
            value={workflowState.assetCategory}
            onChange={(event) => handleReferenceCategoryChange(event.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">{t("全部")}</option>
            {safeAssetCategories.map((category) => (
              <option key={category.value} value={category.value}>
                {t(category.label)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">{t("按标签筛选")}</p>
          <TagSelector
            options={safeReferenceAssetTags}
            selected={workflowState.assetFilterTags}
            onToggle={handleReferenceTagToggle}
          />
        </div>
        <p className="text-sm text-gray-500">
          {t("已选素材")} {existingSelectedAssetIds.length} {t("个")}
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {safeReferenceAssets.map((asset) => {
            const selected = workflowState.selectedAssetIds.includes(asset.id);
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => handleReferenceAssetToggle(asset)}
                className={`overflow-hidden rounded-lg border bg-white text-left shadow-sm transition ${
                  selected ? "border-gray-900 ring-2 ring-gray-900" : "border-gray-200 hover:border-gray-400"
                }`}
              >
                <div className="relative bg-gray-100">
                  <img src={absoluteUrl(asset.url)} alt={asset.filename} className="aspect-square w-full object-cover" />
                  {selected && (
                    <span className="absolute right-2 top-2 rounded-full bg-gray-900 px-2 py-1 text-xs text-white">
                      已选
                    </span>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-gray-900">{asset.filename}</p>
                  <p className="mt-1 truncate text-xs text-gray-500">{asset.tags || t("无标签")}</p>
                </div>
              </button>
            );
          })}
          {safeReferenceAssets.length === 0 && (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
              {t("暂无参考素材")}
            </div>
          )}
        </div>
      </section>
    );
  }

  function updateActionDescription(index: number, value: string) {
    const nextActions = [...workflowState.actionList];
    nextActions[index] = value;
    updateWorkflowState({ actionList: nextActions });
  }

  function addActionDescription() {
    updateWorkflowState({ actionList: [...workflowState.actionList, ""] });
  }

  function removeActionDescription(index: number) {
    const nextActions = workflowState.actionList.filter((_, actionIndex) => actionIndex !== index);
    updateWorkflowState({ actionList: nextActions.length > 0 ? nextActions : [""] });
  }

  function renderStep4() {
    return (
      <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="size">
              {t("尺寸")}
            </label>
            <select
              id="size"
              value={workflowState.size}
              onChange={(event) => updateWorkflowState({ size: event.target.value })}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="background">
              {t("背景")}
            </label>
            <select
              id="background"
              value={workflowState.background}
              onChange={(event) => updateWorkflowState({ background: event.target.value as WorkflowState["background"] })}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="white_png">{t("白底PNG")}</option>
              <option value="transparent">{t("透明背景")}</option>
            </select>
          </div>
        </div>
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">{t("动作列表")}</h2>
              <p className="mt-1 text-sm text-gray-500">{t("每行对应生成 1 张草稿图，至少填写 1 个动作。")}</p>
            </div>
            <button
              type="button"
              onClick={addActionDescription}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t("增加动作")}
            </button>
          </div>
          <div className="space-y-3">
            {workflowState.actionList.map((action, index) => (
              <div key={index} className="grid gap-3 md:grid-cols-[96px_minmax(0,1fr)_auto] md:items-center">
                <span className="text-sm font-medium text-gray-700">{t("第")}{index + 1}{t("张")}</span>
                <input
                  value={action}
                  onChange={(event) => updateActionDescription(index, event.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                  placeholder={t("双手举起欢呼，嘴巴张开大笑")}
                />
                <button
                  type="button"
                  onClick={() => removeActionDescription(index)}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t("删除")}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-gray-500">
            {t("当前有效动作")} {filledActionList.length} {t("个，将生成")} {filledActionList.length} {t("张草稿。")}
          </p>
        </div>
      </section>
    );
  }

  function formatModelPrice(model: AvailableModel) {
    const price = Number(model.price_per_image || 0);
    return Number.isFinite(price) && price > 0 ? `$${price.toFixed(4)}/${t("每张")}` : t("未配置价格");
  }

  function renderModelSelect(
    value: string,
    onChange: (value: string) => void,
    label: string,
    purpose: "draft" | "final",
  ) {
    const options = purpose === "draft" ? draftModelOptions : finalModelOptions;
    const resolvedValue = resolveSelectedModelId(options, value);
    const selectedModel = options.find((model) => model.id === Number(resolvedValue)) || null;
    const recommendedId =
      purpose === "draft"
        ? modelRecommendation.draftRecommendedId
        : modelRecommendation.finalRecommendedId;
    return (
      <div className="space-y-2">
        <ModelSelector
          models={options}
          value={resolvedValue ? Number(resolvedValue) : null}
          onChange={(id) => onChange(id ? String(id) : "")}
          label={label}
          showPrice={false}
        />
        {selectedModel && (
          <p className="text-xs text-gray-500">
            {selectedModel.provider} / {selectedModel.model_name || selectedModel.name} / {formatModelPrice(selectedModel)}
            {selectedModel.id === recommendedId ? t("（推荐）") : ""}
          </p>
        )}
        {recommendedId && (
          <p className="text-xs text-gray-500">
            {purpose === "draft"
              ? t("草稿仅显示低价探索或通用模型，并优先推荐低单价且未达日限额模型。")
              : t("成品仅显示高价定稿或通用模型，并优先推荐高单价且未达日限额模型。")}
          </p>
        )}
      </div>
    );
  }

  function renderStep5() {
    return (
      <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-md bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase text-gray-400">{t("发送提示词")}</p>
            <p className="mt-2 line-clamp-4 text-sm leading-6 text-gray-700">
              {numberedCollageDraftPrompt || "-"}
            </p>
          </div>
          <div className="rounded-md bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase text-gray-400">{t("参考素材")}</p>
            <p className="mt-2 text-sm text-gray-700">{existingSelectedAssetIds.length} 个</p>
          </div>
          <div className="rounded-md bg-gray-50 p-4">
            <p className="text-xs font-medium uppercase text-gray-400">{t("规格")}</p>
            <p className="mt-2 text-sm text-gray-700">
              {workflowState.size} / {workflowState.background === "white_png" ? t("白底PNG") : t("透明背景")} / {filledActionList.length} {t("个动作")}
            </p>
          </div>
        </div>
        <div className="rounded-md bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">{t("动作编号对照表")}</p>
          {filledActionList.length > 0 ? (
            <div className="mt-2 space-y-2">
              {filledActionList.map((action, index) => (
                <p key={`${action}-${index}`} className="text-sm leading-6 text-gray-700">
                  {t("编号")}{index + 1}{t("：")}{action}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-gray-400">{t("请返回 Step 4 填写动作描述")}</p>
          )}
        </div>
        <details className="rounded-md bg-gray-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">{t("完整最终提示词")}</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-gray-200 bg-white p-3 text-sm leading-6 text-gray-700">
            {numberedCollageDraftPrompt || t("填写动作描述后显示实际发送的提示词")}
          </pre>
        </details>
        {renderModelSelect(effectiveDraftModelId, (value) => updateWorkflowState({ draftModelId: value }), t("低价模型"), "draft")}
        <GenerateButton
          onClick={generateDrafts}
          loading={generatingDraft}
          disabled={draftModelOptions.length === 0 || filledActionList.length === 0}
          label={workflowState.draftImages.length > 0 ? t("重新生成草稿") : t("开始生成草稿")}
        />
        {draftGenerationProgress && (
          <p className="text-sm font-medium text-gray-700">{draftGenerationProgress}</p>
        )}
        <GenerationFailurePanel
          message={draftGenerationError}
          retryLabel={t("重试草稿生成")}
          onRetry={generateDrafts}
          retrying={generatingDraft}
        />
        <ImageChoiceGrid
          images={workflowState.draftImages}
          selectedIds={[]}
          onToggle={() => null}
        />
        {workflowState.draftImages.length > 0 && (
          <div className="rounded-md bg-gray-50 p-4">
            <p className="mb-2 text-sm font-medium text-gray-700">{t("拼图编号对照表")}</p>
            {renderActionNumberMap()}
          </div>
        )}
      </section>
    );
  }

  function toggleSelectedActionIndex(index: number) {
    updateWorkflowState({
      selectedActionIndices: toggleInList(workflowState.selectedActionIndices, index).sort((left, right) => left - right),
    });
  }

  function moveFinalImageToBucket(imageId: number, target: "confirmed" | "refine") {
    const currentState = workflowStateRef.current;
    const moved = moveGeneratedImageToReviewBucket(
      currentState.finalImages,
      currentState.confirmedImages,
      currentState.toRefineImages,
      imageId,
      target,
    );
    const nextState = {
      ...currentState,
      finalImages: moved.remainingImages,
      confirmedImages: moved.confirmedImages,
      toRefineImages: moved.toRefineImages,
      consistencyAssetIds:
        currentState.consistencyAssetIds.length > 0 ? currentState.consistencyAssetIds : existingSelectedAssetIds,
      maxVisitedStep: Math.max(currentState.maxVisitedStep, target === "refine" ? 7 : currentState.maxVisitedStep),
    };
    setWorkflowStateAndAutosave(nextState);
  }

  function confirmConsistencyImage(imageId: number) {
    const currentState = workflowStateRef.current;
    const selectedImage = currentState.consistencyImages.find((image) => image.id === imageId);
    if (!selectedImage) return;
    const nextState = {
      ...currentState,
      confirmedImages: [
        ...currentState.confirmedImages.filter((image) => image.id !== selectedImage.id),
        selectedImage,
      ],
      consistencyImages: currentState.consistencyImages.filter((image) =>
        image.id !== selectedImage.id &&
        (selectedImage.sourceImageId ? image.sourceImageId !== selectedImage.sourceImageId : true),
      ),
      toRefineImages: currentState.toRefineImages.filter((image) =>
        selectedImage.sourceImageId ? image.id !== selectedImage.sourceImageId : image.id !== selectedImage.id,
      ),
      refinedImageCount: currentState.refinedImageCount + 1,
      maxVisitedStep: Math.max(currentState.maxVisitedStep, 8),
    };
    setWorkflowStateAndAutosave(nextState);
  }

  function updateStep7Selection(nextIds: number[]) {
    setSelectedRefineImageIds(Array.from(new Set(nextIds)));
  }

  function toggleStep7Selection(imageId: number) {
    setSelectedRefineImageIds((current) =>
      current.includes(imageId) ? current.filter((id) => id !== imageId) : [...current, imageId],
    );
  }

  function toggleStep7SelectAll() {
    if (allStep7RefineSelected) {
      setSelectedRefineImageIds([]);
      return;
    }
    updateStep7Selection(workflowState.toRefineImages.map((image) => image.id));
  }

  function clearStep7Selection() {
    setSelectedRefineImageIds([]);
  }

  function directPassStep7Image(imageId: number) {
    const currentState = workflowStateRef.current;
    const next = directPassRefineSourceImage(
      currentState.confirmedImages,
      currentState.toRefineImages,
      currentState.consistencyImages,
      imageId,
    );
    const nextState = {
      ...currentState,
      confirmedImages: next.confirmedImages,
      toRefineImages: next.toRefineImages,
      consistencyImages: next.consistencyImages,
    };
    setWorkflowStateAndAutosave(nextState);
    setSelectedRefineImageIds((current) => current.filter((id) => id !== imageId));
  }

  function skipStep7Image(imageId: number) {
    const currentState = workflowStateRef.current;
    const next = skipRefineSourceImage(
      currentState.confirmedImages,
      currentState.toRefineImages,
      currentState.consistencyImages,
      imageId,
    );
    const nextState = {
      ...currentState,
      confirmedImages: next.confirmedImages,
      toRefineImages: next.toRefineImages,
      consistencyImages: next.consistencyImages,
    };
    setWorkflowStateAndAutosave(nextState);
    setSelectedRefineImageIds((current) => current.filter((id) => id !== imageId));
  }

  function deleteStep7Image(imageId: number) {
    if (!window.confirm(t("确定删除这张待精修图吗？删除后不会保留到下一步。"))) return;
    skipStep7Image(imageId);
    setMessage(t("已删除待精修图"));
  }

  function refineSelectedStep7Images(images: GeneratedImage[]) {
    void generateConsistencyImages(images);
  }

  function directPassSelectedStep7Images(imageIds: number[]) {
    if (imageIds.length === 0) return;
    const currentState = workflowStateRef.current;
    let confirmedImages = currentState.confirmedImages;
    let toRefineImages = currentState.toRefineImages;
    let consistencyImages = currentState.consistencyImages;
    for (const imageId of imageIds) {
      const next = directPassRefineSourceImage(confirmedImages, toRefineImages, consistencyImages, imageId);
      confirmedImages = next.confirmedImages;
      toRefineImages = next.toRefineImages;
      consistencyImages = next.consistencyImages;
    }
    setWorkflowStateAndAutosave({
      ...currentState,
      confirmedImages,
      toRefineImages,
      consistencyImages,
    });
    setSelectedRefineImageIds((current) => current.filter((id) => !imageIds.includes(id)));
  }

  function skipSelectedStep7Images(imageIds: number[]) {
    if (imageIds.length === 0) return;
    const currentState = workflowStateRef.current;
    let confirmedImages = currentState.confirmedImages;
    let toRefineImages = currentState.toRefineImages;
    let consistencyImages = currentState.consistencyImages;
    for (const imageId of imageIds) {
      const next = skipRefineSourceImage(confirmedImages, toRefineImages, consistencyImages, imageId);
      confirmedImages = next.confirmedImages;
      toRefineImages = next.toRefineImages;
      consistencyImages = next.consistencyImages;
    }
    setWorkflowStateAndAutosave({
      ...currentState,
      confirmedImages,
      toRefineImages,
      consistencyImages,
    });
    setSelectedRefineImageIds((current) => current.filter((id) => !imageIds.includes(id)));
    setMessage(t("已跳过待精修图"));
  }

  function deleteSelectedStep7Images(imageIds: number[]) {
    if (!window.confirm(`${t("确定删除已选的")} ${imageIds.length} ${t("张待精修图吗？删除后不会保留到下一步。")}`)) return;
    skipSelectedStep7Images(imageIds);
    setMessage(t("已删除待精修图"));
  }

  async function generateConsistencyImages(sourceImages?: GeneratedImage[]) {
    const selectedModel = finalModelOptions.find((model) => model.id === Number(effectiveConsistencyModelId));
    if (!selectedModel) {
      setError(t("请选择一致性精修模型"));
      setConsistencyGenerationError(t("请选择一致性精修模型"));
      return;
    }
    const sourceQueue = Array.isArray(sourceImages) && sourceImages.length > 0 ? sourceImages : workflowState.toRefineImages;
    if (sourceQueue.length === 0) {
      setError(t("暂无待一致性精修图"));
      setConsistencyGenerationError(t("暂无待一致性精修图"));
      return;
    }

    setGeneratingConsistency(true);
    setError("");
    setMessage("");
    setConsistencyGenerationError("");
    setFailedConsistencyImage(null);
    let workingState: WorkflowState = {
      ...workflowStateRef.current,
      consistencyImages: [],
    };
    workflowStateRef.current = workingState;
    setWorkflowState(workingState);

    try {
      const taskId = await ensureTaskCreated();
      workingState = {
        ...workingState,
        taskId,
      };
      const referenceAssetIds = effectiveConsistencyAssetIds;
      const nextImages: GeneratedImage[] = [];
      const baseConsistencyPrompt =
        consistencyPrompt || refinePrompt || finalPrompt || "对成品图进行角色一致性对齐，参考原始素材重新精修";

      for (let sourceIndex = 0; sourceIndex < sourceQueue.length; sourceIndex += 1) {
        const sourceImage = sourceQueue[sourceIndex];
        const prompt = sourceImage.actionDescription
          ? buildFinalActionPrompt(baseConsistencyPrompt, sourceImage.actionDescription)
          : [
              baseConsistencyPrompt,
              "参考待精修图和原始素材，保持角色一致性后重新生成单张成品图。",
            ].filter(Boolean).join("\n");
        try {
          const sourceAssetId = await persistConsistencySourceImageAsset(taskId, sourceImage);
          const res = await apiPost<GenerateResponse>(
            "/api/generate/image",
            buildConsistencyGenerationPayload({
              taskId,
              modelConfigId: selectedModel.id,
              modelProvider: selectedModel.provider,
              modelName: selectedModel.model_name,
              prompt,
              size: workflowState.size,
              referenceAssetIds,
              sourceAssetId,
            }),
            CONSISTENCY_GENERATION_TIMEOUT_MS,
          );

          if (res.code !== 0) {
            throw new Error(res.msg || `${t("第")} ${sourceIndex + 1} ${t("张一致性精修失败")}`);
          }

          const [image] = assignWorkflowImageIds(
            normalizeGeneratedImages(res.data, "consistency"),
            Date.now() + sourceIndex * 1000,
          );
          if (!image) {
            throw new Error(`${t("第")} ${sourceIndex + 1} ${t("张一致性精修失败：未返回可用图片")}`);
          }
          const nextImage: GeneratedImage = {
            ...image,
            sourceImageId: sourceImage.id,
            actionDescription: sourceImage.actionDescription,
          };
          nextImages.push(nextImage);
          workingState = {
            ...workingState,
            toRefineImages: workingState.toRefineImages.map((item) =>
              item.id === sourceImage.id ? { ...item, assetId: sourceAssetId } : item,
            ),
            consistencyImages: [...workingState.consistencyImages, nextImage],
          };
          await setWorkflowStateAndAutosave(workingState);
        } catch (err) {
          const failure = err instanceof Error ? err.message : `${t("第")} ${sourceIndex + 1} ${t("张一致性精修失败")}`;
          setFailedConsistencyImage(sourceImage);
          setConsistencyGenerationError(failure);
          setError(failure);
          return;
        }
      }

      if (nextImages.length === 0) {
        const failure = t("一致性精修失败：未返回可用图片");
        setConsistencyGenerationError(failure);
        setError(failure);
        return;
      }

      workingState = {
        ...workingState,
        maxVisitedStep: Math.max(workingState.maxVisitedStep, 8),
      };
      await setWorkflowStateAndAutosave(workingState);
      setMessage(t("一致性精修完成"));
    } catch (err) {
      const failure = err instanceof Error ? err.message : t("一致性精修失败");
      setFailedConsistencyImage(null);
      setConsistencyGenerationError(failure);
      setError(failure);
    } finally {
      setGeneratingConsistency(false);
    }
  }

  function skipFailedConsistencyImage() {
    if (!failedConsistencyImage) return;
    const currentState = workflowStateRef.current;
    const remainingToRefineCount = currentState.toRefineImages.filter(
      (image) => image.id !== failedConsistencyImage.id,
    ).length;
    const skipped = skipRefineSourceImage(
      currentState.confirmedImages,
      currentState.toRefineImages,
      currentState.consistencyImages,
      failedConsistencyImage.id,
    );
    const nextState = {
      ...currentState,
      ...skipped,
      maxVisitedStep: skipped.toRefineImages.length === 0
        ? Math.max(currentState.maxVisitedStep, 8)
        : currentState.maxVisitedStep,
    };
    setWorkflowStateAndAutosave(nextState);
    setFailedConsistencyImage(null);
    setConsistencyGenerationError("");
    setError("");
    setMessage(
      remainingToRefineCount > 0
        ? t("已跳过此图，请继续处理下一张待精修图")
        : t("已跳过此图，所有待精修图已处理，可进入下一步"),
    );
  }

  function returnReviewImageToRefine(imageId: number) {
    const currentState = workflowStateRef.current;
    const moved = moveReviewImageBackToRefine(currentState.confirmedImages, currentState.toRefineImages, imageId);
    const nextState = {
      ...currentState,
      confirmedImages: moved.confirmedImages,
      toRefineImages: moved.toRefineImages,
      consistencyAssetIds:
        currentState.consistencyAssetIds.length > 0 ? currentState.consistencyAssetIds : existingSelectedAssetIds,
      maxVisitedStep: Math.max(currentState.maxVisitedStep, 7),
    };
    setWorkflowStateAndAutosave(nextState, { currentStepOverride: 7 });
    setCurrentStep(7);
  }

  function renderActionNumberMap() {
    if (filledActionList.length === 0) {
      return <p className="text-sm text-gray-400">{t("暂无动作编号")}</p>;
    }
    return (
      <div className="space-y-2">
        {filledActionList.map((action, index) => (
          <p key={`${action}-${index}`} className="text-sm leading-6 text-gray-700">
            {t("编号")}{index + 1}{t("：")}{action}
          </p>
        ))}
      </div>
    );
  }

  function renderStep6() {
    const leftImages = workflowState.mode === "refine"
      ? [...workflowState.draftImages, ...workflowState.uploadedRefineImages]
      : workflowState.draftImages;
    return (
      <section className="space-y-5">
        <div className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              {workflowState.mode === "refine" ? t("待精修图片") : t("拼图草稿参考")}
            </h2>
            {workflowState.mode === "refine" && (
              <label className="cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {t("上传图片")}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleRefineUpload} />
              </label>
            )}
          </div>
          <ImageChoiceGrid
            images={leftImages}
            selectedIds={workflowState.mode === "refine" ? workflowState.selectedDraftImageIds : []}
            onToggle={(id) =>
              workflowState.mode === "refine"
                ? updateWorkflowState({ selectedDraftImageIds: toggleInList(workflowState.selectedDraftImageIds, id) })
                : null
            }
            variant="step6Draft"
            onPreview={workflowState.mode === "refine" ? undefined : setPreviewImage}
          />
          {workflowState.mode !== "refine" && (
            <div className="rounded-md bg-gray-50 p-4">
              <p className="mb-2 text-sm font-medium text-gray-700">{t("动作编号对照表")}</p>
              {renderActionNumberMap()}
            </div>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            {workflowState.mode !== "refine" && (
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">{t("选择要生成成品的编号")}</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {filledActionList.map((action, index) => (
                    <label
                      key={`${action}-${index}`}
                      className="flex cursor-pointer items-start gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={workflowState.selectedActionIndices.includes(index)}
                        onChange={() => toggleSelectedActionIndex(index)}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900">{t("编号")}{index + 1}</span>
                        <span className="ml-2 break-words text-gray-700">{action}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">{t("精修指令")}</p>
              <InstructionSelector
                instructions={safeInstructions}
                selectedIds={workflowState.refineInstructionIds}
                onToggle={(id) =>
                  updateWorkflowState({ refineInstructionIds: toggleInList(workflowState.refineInstructionIds, id) })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="refine-prompt">
                {t("精修提示词")}
              </label>
              <textarea
                id="refine-prompt"
                value={workflowState.refinePrompt}
                onChange={(event) => updateWorkflowState({ refinePrompt: event.target.value })}
                rows={5}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-6"
              />
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            {renderModelSelect(effectiveFinalModelId, (value) => updateWorkflowState({ finalModelId: value }), t("高价模型"), "final")}
            <GenerateButton
              onClick={generateFinals}
              loading={generatingFinal}
              disabled={finalModelOptions.length === 0}
              label={t("生成成品图")}
              className="w-full"
            />
            <GenerationFailurePanel
              message={finalGenerationError}
              retryLabel={t("重试成品生成")}
              onRetry={generateFinals}
              retrying={generatingFinal}
            />
          </div>
        </div>

        {workflowState.finalImages.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-gray-900">{t("成品生成结果")}</p>
            <div className="grid grid-cols-[repeat(4,240px)] gap-5 overflow-x-auto pb-2">
              {workflowState.finalImages.map((image) => (
                <div key={image.id} className="w-[240px] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setPreviewImage(image)}
                    className="block w-full cursor-zoom-in text-left"
                  >
                    <img
                      src={absoluteUrl(image.url)}
                      alt={image.actionDescription || image.type}
                      className="aspect-square h-[240px] w-[240px] bg-gray-100 object-contain"
                    />
                  </button>
                  <div className="space-y-3 border-t border-gray-100 p-3">
                    {image.actionDescription && (
                      <div>
                        <p className="text-xs font-medium text-gray-400">{t("动作描述")}</p>
                        <p className="mt-1 whitespace-normal break-words text-sm leading-6 text-gray-700">
                          {image.actionDescription}
                        </p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => moveFinalImageToBucket(image.id, "confirmed")}
                        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                      >
                        {t("直接归档")}
                      </button>
                      <button
                        type="button"
                        onClick={() => moveFinalImageToBucket(image.id, "refine")}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t("需要精修")}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(workflowState.confirmedImages.length > 0 || workflowState.toRefineImages.length > 0) && (
          <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow-sm">
            {t("已直接归档")} {workflowState.confirmedImages.length} {t("张，待一致性精修")} {workflowState.toRefineImages.length} {t("张。")}
            {workflowState.finalImages.length > 0 ? ` ${t("请继续处理剩余成品图。")}` : ` ${t("可进入下一步。")}`}
          </div>
        )}
      </section>
    );
  }

  function renderStep7() {
    return (
      <section className="space-y-5">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">{t("一致性精修")}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{t("对成品图进行角色一致性对齐，参考原始素材重新精修")}</p>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)_minmax(280px,360px)]">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">{t("固定提示词")}</p>
              <InstructionSelector
                instructions={safeInstructions}
                selectedIds={workflowState.consistencyInstructionIds}
                onToggle={(id) =>
                  updateWorkflowState({
                    consistencyInstructionIds: toggleInList(workflowState.consistencyInstructionIds, id),
                  })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="consistency-prompt">
                {t("附加提示词")}
              </label>
              <textarea
                id="consistency-prompt"
                value={workflowState.consistencyPrompt}
                onChange={(event) => updateWorkflowState({ consistencyPrompt: event.target.value })}
                rows={6}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-6"
              />
            </div>
            <div className="rounded-md bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase text-gray-400">{t("提示词预览")}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                {consistencyPrompt || refinePrompt || finalPrompt || t("未填写时使用默认一致性精修提示词")}
              </p>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">
                {t("待精修图")}（{workflowState.toRefineImages.length}）
              </h3>
              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={allStep7RefineSelected}
                  onChange={toggleStep7SelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-gray-900"
                />
                {t("全选")}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md bg-gray-50 px-3 py-1.5 text-gray-600">
                {t("已选")} {selectedRefineImageIds.length} {t("张")}
              </span>
              <button
                type="button"
                onClick={() => refineSelectedStep7Images(selectedStep7RefineImages)}
                disabled={selectedStep7RefineImages.length === 0 || generatingConsistency}
                className="rounded-md bg-gray-900 px-3 py-2 font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("批量精修")}
              </button>
              <button
                type="button"
                onClick={() => directPassSelectedStep7Images(selectedRefineImageIds)}
                disabled={selectedRefineImageIds.length === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("直接通过")}
              </button>
              <button
                type="button"
                onClick={() => skipSelectedStep7Images(selectedRefineImageIds)}
                disabled={selectedRefineImageIds.length === 0}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("跳过")}
              </button>
              <button
                type="button"
                onClick={() => deleteSelectedStep7Images(selectedRefineImageIds)}
                disabled={selectedRefineImageIds.length === 0}
                className="rounded-md border border-red-300 bg-white px-3 py-2 font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {t("删除")}
              </button>
              {selectedRefineImageIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearStep7Selection}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 font-medium text-gray-500 hover:bg-gray-50"
                >
                  {t("清空")}
                </button>
              )}
            </div>
            {workflowState.toRefineImages.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
                {t("暂无待精修图")}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {workflowState.toRefineImages.map((image) => {
                  const selected = selectedRefineImageIds.includes(image.id);
                  return (
                    <div
                      key={image.id}
                      className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
                        selected ? "border-gray-900 ring-2 ring-gray-900" : "border-gray-200"
                      }`}
                    >
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setPreviewImage(image)}
                          className="block w-full cursor-zoom-in text-left"
                        >
                          <img
                            src={absoluteUrl(image.url)}
                            alt={image.actionDescription || image.type}
                            className="aspect-square min-h-[200px] w-full bg-gray-100 object-cover"
                          />
                        </button>
                        <label className="absolute left-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/95 shadow-sm ring-1 ring-gray-200">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleStep7Selection(image.id)}
                            className="h-4 w-4 rounded border-gray-300 text-gray-900"
                            aria-label={`${t("选择待精修图")} ${image.id}`}
                          />
                        </label>
                      </div>
                      <div className="space-y-3 border-t border-gray-100 p-3">
                        {image.actionDescription && (
                          <details>
                            <summary className="cursor-pointer text-xs font-medium text-gray-500">{t("动作描述")}</summary>
                            <p className="mt-2 whitespace-normal break-words text-sm leading-6 text-gray-700">
                              {image.actionDescription}
                            </p>
                          </details>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => refineSelectedStep7Images([image])}
                            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                          >
                            {t("精修")}
                          </button>
                          <button
                            type="button"
                            onClick={() => directPassStep7Image(image.id)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            {t("直接通过")}
                          </button>
                          <button
                            type="button"
                            onClick={() => skipStep7Image(image.id)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            {t("跳过")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteStep7Image(image.id)}
                            className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            {t("删除")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-gray-900">{t("参考素材")}</h3>
              <button
                type="button"
                onClick={workflowState.consistencyAssetPanelOpen ? () => updateWorkflowState({ consistencyAssetPanelOpen: false }) : openConsistencyAssetPanel}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {workflowState.consistencyAssetPanelOpen ? t("收起选择") : t("重新选择")}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedConsistencyAssets.map((asset) => (
                <img
                  key={asset.id}
                  src={absoluteUrl(asset.url)}
                  alt={asset.filename}
                  className="aspect-square rounded-md bg-gray-100 object-cover"
                />
              ))}
              {selectedConsistencyAssets.length === 0 && <p className="text-sm text-gray-400">{t("未选择参考素材")}</p>}
            </div>
            {workflowState.consistencyAssetPanelOpen && (
              <div className="space-y-4 border-t border-gray-100 pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700" htmlFor="consistency-asset-category">
                    {t("素材分类")}
                  </label>
                  <select
                    id="consistency-asset-category"
                    value={workflowState.assetCategory}
                    onChange={(event) => handleReferenceCategoryChange(event.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="all">{t("全部")}</option>
                    {safeAssetCategories.map((category) => (
                      <option key={category.value} value={category.value}>
                        {t(category.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium text-gray-700">{t("按标签筛选")}</p>
                  <TagSelector
                    options={safeReferenceAssetTags}
                    selected={workflowState.assetFilterTags}
                    onToggle={handleReferenceTagToggle}
                  />
                </div>
                <div className="grid max-h-[460px] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                  {safeReferenceAssets.map((asset) => {
                    const selected = effectiveConsistencyAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => handleConsistencyReferenceAssetToggle(asset)}
                        className={`overflow-hidden rounded-lg border bg-white text-left shadow-sm transition ${
                          selected ? "border-gray-900 ring-2 ring-gray-900" : "border-gray-200 hover:border-gray-400"
                        }`}
                      >
                        <div className="relative bg-gray-100">
                          <img src={absoluteUrl(asset.url)} alt={asset.filename} className="aspect-square w-full object-cover" />
                          {selected && (
                            <span className="absolute right-2 top-2 rounded-full bg-gray-900 px-2 py-1 text-xs text-white">
                              {t("已选")}
                            </span>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="truncate text-sm font-medium text-gray-900">{asset.filename}</p>
                          <p className="mt-1 truncate text-xs text-gray-500">{asset.tags || t("无标签")}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            {renderModelSelect(
              effectiveConsistencyModelId,
              (value) => updateWorkflowState({ consistencyModelId: value }),
              t("模型选择"),
              "final",
            )}
            <GenerateButton
              onClick={() => generateConsistencyImages()}
              loading={generatingConsistency}
              disabled={finalModelOptions.length === 0 || workflowState.toRefineImages.length === 0}
              label={t("开始一致性精修")}
            />
          </div>
          <GenerationFailurePanel
            message={consistencyGenerationError}
            retryLabel={t("重试一致性精修")}
            onRetry={() => generateConsistencyImages()}
            retrying={generatingConsistency}
            skipLabel={failedConsistencyImage ? t("跳过此图") : undefined}
            onSkip={failedConsistencyImage ? skipFailedConsistencyImage : undefined}
          />
          {workflowState.consistencyImages.length > 0 && (
            <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-900">{t("一致性精修结果")}</h3>
                <button
                  type="button"
                  onClick={() => generateConsistencyImages()}
                  disabled={generatingConsistency || workflowState.toRefineImages.length === 0}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("继续精修")}
                </button>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {workflowState.consistencyImages.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => setPreviewImage(image)}
                      className="block w-full cursor-zoom-in text-left"
                    >
                      <img
                        src={absoluteUrl(image.url)}
                        alt={image.actionDescription || image.type}
                        className="aspect-square min-h-[200px] w-full bg-gray-100 object-cover"
                      />
                    </button>
                    <div className="space-y-3 border-t border-gray-100 p-3">
                      {image.actionDescription && (
                        <p className="whitespace-normal break-words text-sm leading-6 text-gray-700">
                          {image.actionDescription}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => confirmConsistencyImage(image.id)}
                        className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700"
                      >
                        {t("确认归档")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {workflowState.toRefineImages.length > 0 && (
                <p className="text-sm text-gray-500">{t("还有")} {workflowState.toRefineImages.length} {t("张待确认精修结果。")}</p>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderStep8() {
    function enterArchiveStep() {
      if (workflowState.confirmedImages.length === 0) {
        setError(t("请先确认至少一张待归档图"));
        return;
      }
      setWorkflowState((current) => ({
        ...current,
        archiveTags: buildDefaultArchiveTags(current.taskTags.length > 0 ? current.taskTags : current.tags),
        archiveImageTags: mergeDefaultArchiveImageTags(
          current.confirmedImages.map((image) => image.id),
          current.taskTags.length > 0 ? current.taskTags : current.tags,
          current.archiveImageTags,
        ),
        maxVisitedStep: Math.max(current.maxVisitedStep, 9),
      }));
      setCurrentStep(9);
    }

    return (
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">{t("参考素材")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {selectedConsistencyAssets.map((asset) => (
              <img key={asset.id} src={absoluteUrl(asset.url)} alt={asset.filename} className="aspect-square rounded-md bg-gray-100 object-cover" />
            ))}
            {selectedConsistencyAssets.length === 0 && <p className="text-sm text-gray-400">{t("未选择参考素材")}</p>}
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">{t("审核对比")}</h2>
            <button
              type="button"
              onClick={enterArchiveStep}
              disabled={workflowState.confirmedImages.length === 0}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("全部确认")}
            </button>
          </div>
          {reviewImages.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
              {t("暂无已确认图片")}
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              {reviewImages.map((image) => (
                <div key={image.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setPreviewImage(image)}
                    className="block w-full cursor-zoom-in text-left"
                  >
                    <img
                      src={absoluteUrl(image.url)}
                      alt={image.actionDescription || image.type}
                      className="aspect-square min-h-[200px] w-full bg-gray-100 object-cover"
                    />
                  </button>
                  <div className="space-y-3 border-t border-gray-100 p-3">
                    {image.actionDescription && (
                      <p className="whitespace-normal break-words text-sm leading-6 text-gray-700">
                        {image.actionDescription}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => returnReviewImageToRefine(image.id)}
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      {t("退回精修")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderTaskStatsCards() {
    const cards = [
      { label: t("动作指令数"), value: taskStats.actionCount },
      { label: t("草稿生成数"), value: taskStats.draftCount },
      { label: t("成品生成数"), value: taskStats.finalGeneratedCount },
      { label: t("精修图数"), value: taskStats.refinedImageCount },
      { label: t("已归档数"), value: taskStats.archivedImageCount },
    ];

    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-2xl font-semibold text-gray-900">{card.value}</p>
            <p className="mt-1 text-xs font-medium text-gray-500">{card.label}</p>
          </div>
        ))}
      </div>
    );
  }

  function renderStep9() {
    if (workflowState.archived && confirmedFinalImages.length === 0) {
      return (
        <section className="space-y-5">
          {renderTaskStatsCards()}
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-semibold text-gray-900">{t("归档完成")}</h2>
            <p className="mt-2 text-sm text-gray-500">{t("已确认的成品图已存入素材库。")}</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/workbench/assets" className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
                {t("查看素材库")}
              </Link>
              <button type="button" onClick={resetWorkflow} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {t("再做一批")}
              </button>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="space-y-5">
        {renderTaskStatsCards()}
        {workflowState.archived && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {t("当前任务已完成，可继续补充归档下方尚未入库的确认图片。")}
          </div>
        )}
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-700">{t("待归档成品图")}</p>
          {confirmedFinalImages.length === 0 ? (
            <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
              {t("暂无已确认图片")}
            </div>
          ) : (
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {confirmedFinalImages.map((image) => (
                <div key={image.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                  <button
                    type="button"
                    onClick={() => setPreviewImage(image)}
                    className="block w-full cursor-zoom-in text-left"
                  >
                    <img
                      src={absoluteUrl(image.url)}
                      alt={image.actionDescription || image.type}
                      className="aspect-square w-full bg-gray-100 object-cover"
                    />
                  </button>
                  <div className="space-y-4 p-4">
                    {image.actionDescription && (
                      <div>
                        <p className="text-xs font-medium text-gray-400">{t("动作描述")}</p>
                        <p className="mt-1 whitespace-normal break-words text-sm leading-6 text-gray-700">
                          {image.actionDescription}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="mb-2 text-sm font-medium text-gray-700">{t("此图归档标签")}</p>
                      <ArchiveTagEditor
                        options={safeAssetTags}
                        selected={getImageArchiveTags(image.id, workflowState.archiveImageTags, effectiveTaskTags)}
                        newTagValue={newArchiveImageTags[image.id] || ""}
                        onNewTagChange={(value) => setArchiveImageTagInput(image.id, value)}
                        onAddTag={(tag) => addArchiveImageTag(image.id, tag)}
                        onRemoveTag={(tag) => removeArchiveImageTag(image.id, tag)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={archiveFinals}
            disabled={archiving || confirmedFinalImages.length === 0}
            className="mt-5 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {archiving ? t("归档中...") : t("确认归档")}
          </button>
        </div>
      </section>
    );
  }

  function renderCurrentStep() {
    if (currentStep === 0) return renderModeSelection();
    if (currentStep === 1) return renderStep1();
    if (currentStep === 2) return renderStep2();
    if (currentStep === 3) return renderStep3();
    if (currentStep === 4) return renderStep4();
    if (currentStep === 5) return renderStep5();
    if (currentStep === 6) return renderStep6();
    if (currentStep === 7) return renderStep7();
    if (currentStep === 8) return renderStep8();
    return renderStep9();
  }

  const nextButtonDisabled =
    currentStep >= TOTAL_STEPS ||
    (currentStep === 6 &&
      (workflowState.finalImages.length > 0 ||
        (workflowState.confirmedImages.length === 0 && workflowState.toRefineImages.length === 0))) ||
    (currentStep === 7 && workflowState.toRefineImages.length > 0) ||
    (currentStep === 8 && workflowState.confirmedImages.length === 0);

  return (
    <div>
      <PageHeader
        title={t("表情制作")}
        description={t("9 步向导式牛角色表情图片生产工作流")}
        action={
          currentStep > 0 && !workflowState.archived ? (
            <button
              type="button"
              onClick={() => saveWorkflowSession()}
              disabled={savingDraft}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingDraft ? t("保存中...") : t("保存草稿")}
            </button>
          ) : null
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {message && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          {t("正在加载工作流...")}
        </div>
      ) : currentStep > 0 ? (
        <StepLayout
          currentStep={currentStep}
          steps={workflowSteps}
          onNext={!workflowState.archived ? handleNext : undefined}
          onBack={!workflowState.archived ? handlePrevious : undefined}
          nextDisabled={nextButtonDisabled}
          onStepSelect={goToStep}
          canVisitStep={(step) => step <= workflowState.maxVisitedStep}
        >
          <WorkflowStepHeader
            step={currentStep}
            title={t(STEP_TITLES[currentStep - 1])}
            description={workflowState.taskId ? `${t("任务")} #${workflowState.taskId}` : undefined}
          />
          {renderCurrentStep()}
        </StepLayout>
      ) : (
        renderCurrentStep()
      )}

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  );
}

function ImagePreviewModal({
  image,
  onClose,
}: {
  image: GeneratedImage | null;
  onClose: () => void;
}) {
  if (!image) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div className="max-h-full w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
        <img
          src={absoluteUrl(image.url)}
          alt={image.actionDescription || image.type}
          className="mx-auto max-h-[82vh] w-auto max-w-full rounded-lg bg-white object-contain"
        />
        {image.actionDescription && (
          <p className="mx-auto mt-3 max-w-4xl whitespace-pre-wrap rounded-md bg-white px-4 py-3 text-sm leading-6 text-gray-800">
            {image.actionDescription}
          </p>
        )}
      </div>
    </div>
  );
}

function GenerationFailurePanel({
  message,
  retryLabel,
  onRetry,
  retrying,
  skipLabel,
  onSkip,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  retrying: boolean;
  skipLabel?: string;
  onSkip?: () => void;
}) {
  const { t } = useLanguage();
  if (!message) return null;

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">{t("生成失败")}</p>
      <p className="mt-1 text-sm leading-6 text-red-600">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {retrying ? t("重试中...") : retryLabel}
        </button>
        {skipLabel && onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={retrying}
            className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {skipLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ImageChoiceGrid({
  images,
  selectedIds,
  onToggle,
  variant = "compact",
  onPreview,
}: {
  images: GeneratedImage[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  variant?: ImageChoiceGridVariant;
  onPreview?: (image: GeneratedImage) => void;
}) {
  const { t } = useLanguage();
  const safeImages = Array.isArray(images) ? images : [];
  const gridClasses = getImageChoiceGridClasses(variant);
  if (safeImages.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-400">
        {t("暂无图片")}
      </div>
    );
  }

  return (
    <div className={gridClasses.container}>
      {safeImages.map((image) => {
        const selected = selectedIds.includes(image.id);
        const previewOnly = Boolean(onPreview) && selectedIds.length === 0;
        return (
          <button
            key={image.id}
            type="button"
            onClick={() => (previewOnly ? onPreview?.(image) : onToggle(image.id))}
            className={`overflow-hidden rounded-lg border bg-white text-left shadow-sm transition ${
              selected ? "border-gray-900 ring-2 ring-gray-900" : "border-gray-200 hover:border-gray-400"
            } ${previewOnly ? "cursor-zoom-in" : ""}`}
          >
            <div className="relative">
              <img
                src={absoluteUrl(image.url)}
                alt={image.actionDescription || image.type}
                className={gridClasses.image}
              />
              {selected && (
                <span className="absolute right-2 top-2 rounded-full bg-gray-900 px-2 py-1 text-xs text-white">
                  {t("已选")}
                </span>
              )}
              {previewOnly && (
                <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-xs text-white">
                  {t("点击放大")}
                </span>
              )}
            </div>
            {image.actionDescription && (
              <div className="border-t border-gray-100 p-3">
                <p className="text-xs font-medium text-gray-400">动作描述</p>
                <p className="mt-1 whitespace-normal break-words text-sm leading-6 text-gray-700">{image.actionDescription}</p>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
