"use client";

import Link from "next/link";
import { ChangeEvent, KeyboardEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import TagCombobox from "@/components/common/TagCombobox";
import PageHeader from "@/components/common/PageHeader";
import GenerateButton from "@/components/workflow/GenerateButton";
import ImageReviewCard from "@/components/workflow/ImageReviewCard";
import ModelSelector from "@/components/workflow/ModelSelector";
import StepLayout from "@/components/workflow/StepLayout";
import WhitespacePositionPicker from "@/components/workflow/WhitespacePositionPicker";
import WorkflowStepHeader from "@/components/workflow/WorkflowStepHeader";
import { useLanguage } from "@/lib/LanguageContext";
import { apiGet, apiPatch, apiPost, apiUpload } from "@/lib/api";
import { getTagLabel } from "@/lib/tag-display";
import {
  ACTIVITY_INPUT_CLASS,
  ACTIVITY_PAGE_INNER_CLASS,
  ACTIVITY_PAGE_SHELL_CLASS,
  ACTIVITY_PANEL_CLASS,
  ACTIVITY_PRIMARY_BUTTON_CLASS,
  ACTIVITY_SECONDARY_BUTTON_CLASS,
  ACTIVITY_SECTION_CARD_CLASS,
} from "@/lib/activity-workflow-theme";
import type { Asset } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const GENERATION_TIMEOUT_MS = 660000;
const STEP_TITLES = ["填写任务参数", "生成草图 & 人工筛选", "精修标准化", "入素材库"];
const BACKGROUND_TAG_CATEGORY = "background";
const MAX_REFERENCE_UPLOADS = 3;
const GENERATION_COUNT_OPTIONS = [1, 2, 4, 6, 8] as const;
const SIZE_RATIO_OPTIONS = ["1:1", "4:5", "16:9", "9:16"];
const GAME_FEEL_OPTIONS = [
  { value: "strong", label: "Strong" },
  { value: "medium", label: "Medium" },
  { value: "weak", label: "Weak" },
];

interface TagGroups {
  purpose: BackgroundTagOption[];
  scene: BackgroundTagOption[];
  mood: BackgroundTagOption[];
  colorStyle: BackgroundTagOption[];
}

interface BackgroundTagOption {
  name: string;
  group: string | null;
}

interface BackgroundBatchImage {
  id: number;
  batch_id: number;
  asset_id?: number | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  review_status: string;
  is_recommended: boolean;
  tags?: Record<string, unknown> | null;
  use_count: number;
  created_at?: string | null;
}

interface BackgroundBatch {
  id: number;
  purpose: string;
  scene: string;
  mood: string[];
  color_style: string;
  whitespace_positions: string[];
  size_ratio: string;
  localized: boolean;
  game_feel: string;
  count: number;
  status: string;
  session_id?: number | null;
  model_config_id?: number | null;
  extra_prompt?: string | null;
  images: BackgroundBatchImage[];
}

interface WorkflowSessionRecord {
  current_step?: number;
  state_json?: string | null;
}

interface ModelConfig {
  id: number;
  name: string;
  provider: string;
  model_name?: string;
  price_per_image: number | string;
  usage_type: string;
}

interface BackgroundFormState {
  purpose: string[];
  scene: string;
  mood: string[];
  colorStyle: string;
  whitespacePositions: string[];
  sizeRatio: string;
  localized: boolean;
  gameFeel: string;
  extraPrompt: string;
}

const DEFAULT_FORM_STATE: BackgroundFormState = {
  purpose: [],
  scene: "",
  mood: [],
  colorStyle: "",
  whitespacePositions: ["right"],
  sizeRatio: "16:9",
  localized: false,
  gameFeel: "medium",
  extraPrompt: "",
};

function absoluteUrl(url?: string | null) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (safeUrl.startsWith("http://") || safeUrl.startsWith("https://") || safeUrl.startsWith("blob:")) {
    return safeUrl;
  }
  return `${API_BASE}${safeUrl}`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.reduce<string[]>((items, value) => {
    const clean = value.trim();
    if (!clean || seen.has(clean)) return items;
    seen.add(clean);
    items.push(clean);
    return items;
  }, []);
}

function parseSessionState(stateJson?: string | null): Record<string, any> {
  try {
    return stateJson ? JSON.parse(stateJson) : {};
  } catch {
    return {};
  }
}

function buildBackgroundTagGroups(rawTags: BackgroundTagOption[]) {
  const safeTags = Array.isArray(rawTags) ? rawTags : [];
  return {
    purpose: safeTags.filter((tag) => tag.group === "purpose"),
    scene: safeTags.filter((tag) => tag.group === "scene"),
    mood: safeTags.filter((tag) => tag.group === "mood"),
    colorStyle: safeTags.filter((tag) => tag.group === "color_style"),
  };
}

function splitMultiValue(value?: string | null) {
  return uniqueStrings(
    String(value || "")
      .split(/[、,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function joinMultiValue(values: string[]) {
  return uniqueStrings(values).join("、");
}

function defaultArchiveTags(batch: BackgroundBatch | null) {
  if (!batch) return [];
  return uniqueStrings([
    ...splitMultiValue(batch.purpose),
    batch.scene,
    ...batch.mood,
    batch.color_style,
    ...batch.whitespace_positions.map((item) => `留白-${item}`),
    `比例-${batch.size_ratio}`,
    `游戏感-${batch.game_feel}`,
    ...(batch.localized ? ["本地化"] : []),
  ]);
}

function normalizeBackgroundImage(rawImage: any): BackgroundBatchImage {
  return {
    id: Number(rawImage?.id || 0),
    batch_id: Number(rawImage?.batch_id || 0),
    asset_id: rawImage?.asset_id == null ? null : Number(rawImage.asset_id),
    image_url: rawImage?.image_url || "",
    thumbnail_url: rawImage?.thumbnail_url || rawImage?.image_url || "",
    review_status: String(rawImage?.review_status || "pending"),
    is_recommended: Boolean(rawImage?.is_recommended),
    tags: rawImage?.tags || null,
    use_count: Number(rawImage?.use_count || 0),
    created_at: rawImage?.created_at || null,
  };
}

function normalizeBackgroundBatch(rawBatch: any): BackgroundBatch {
  const whitespace_positions = Array.isArray(rawBatch?.whitespace_positions)
    ? rawBatch.whitespace_positions.map((item: unknown) => String(item || "").trim()).filter(Boolean)
    : [String(rawBatch?.whitespace_position || "right").trim()].filter(Boolean);
  return {
    id: Number(rawBatch?.id || 0),
    purpose: String(rawBatch?.purpose || ""),
    scene: String(rawBatch?.scene || ""),
    mood: Array.isArray(rawBatch?.mood) ? rawBatch.mood.map((item: unknown) => String(item || "").trim()).filter(Boolean) : [],
    color_style: String(rawBatch?.color_style || ""),
    whitespace_positions,
    size_ratio: String(rawBatch?.size_ratio || "16:9"),
    localized: Boolean(rawBatch?.localized),
    game_feel: String(rawBatch?.game_feel || "medium"),
    count: Number(rawBatch?.count || 4),
    status: String(rawBatch?.status || "draft"),
    session_id: rawBatch?.session_id == null ? null : Number(rawBatch.session_id),
    model_config_id: rawBatch?.model_config_id == null ? null : Number(rawBatch.model_config_id),
    extra_prompt: rawBatch?.extra_prompt || "",
    images: Array.isArray(rawBatch?.images) ? rawBatch.images.map(normalizeBackgroundImage) : [],
  };
}

function coerceGenerationCount(value: unknown) {
  const numeric = Number(value || 4);
  return GENERATION_COUNT_OPTIONS.includes(numeric as (typeof GENERATION_COUNT_OPTIONS)[number]) ? numeric : 4;
}

function backgroundReviewStatusLabel(reviewStatus: string) {
  if (reviewStatus === "approved") return "通过";
  if (reviewStatus === "refine") return "待精修";
  if (reviewStatus === "rejected") return "已废弃";
  return "待筛选";
}

function selectChipClass(active: boolean) {
  return active
    ? "rounded-full border border-emerald-500 bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white"
    : "rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-emerald-400 hover:text-emerald-700";
}

function TagChipEditor({
  tags,
  inputValue,
  onInputChange,
  onAddTag,
  onRemoveTag,
}: {
  tags: string[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
}) {
  const { t, lang } = useLanguage();
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onAddTag();
    }
  }

  return (
    <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
          >
            {getTagLabel(tag, lang)}
            <button
              type="button"
              onClick={() => onRemoveTag(tag)}
              className="text-violet-500 hover:text-violet-800"
              aria-label={`${t("移除标签")} ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-gray-400">{t("暂无标签")}</span>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("输入标签后回车")}
          className={`${ACTIVITY_INPUT_CLASS} mt-0`}
        />
        <button type="button" onClick={onAddTag} className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
          {t("添加")}
        </button>
      </div>
    </div>
  );
}

export default function BackgroundWorkflowPage() {
  const { t } = useLanguage();
  return (
    <Suspense
      fallback={
        <div className={ACTIVITY_PAGE_SHELL_CLASS}>
          <div className={ACTIVITY_PAGE_INNER_CLASS}>
            <div className={ACTIVITY_PANEL_CLASS}>
              <p className="text-sm text-gray-500">{t("背景图工作流加载中…")}</p>
            </div>
          </div>
        </div>
      }
    >
      <BackgroundWorkflowPageContent />
    </Suspense>
  );
}

function BackgroundWorkflowPageContent() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");

  const [step, setStep] = useState(1);
  const [formState, setFormState] = useState<BackgroundFormState>(DEFAULT_FORM_STATE);
  const [tagGroups, setTagGroups] = useState<TagGroups>({
    purpose: [],
    scene: [],
    mood: [],
    colorStyle: [],
  });
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [batch, setBatch] = useState<BackgroundBatch | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [refineAvailableModels, setRefineAvailableModels] = useState<ModelConfig[]>([]);
  const [modelConfigId, setModelConfigId] = useState<number | null>(null);
  const [refineModelConfigId, setRefineModelConfigId] = useState<number | null>(null);
  const [generationCount, setGenerationCount] = useState<number>(4);
  const [refinePromptByImageId, setRefinePromptByImageId] = useState<Record<number, string>>({});
  const [archiveTagsByImageId, setArchiveTagsByImageId] = useState<Record<number, string[]>>({});
  const [archiveInputByImageId, setArchiveInputByImageId] = useState<Record<number, string>>({});
  const [recommendedByImageId, setRecommendedByImageId] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingRefineModels, setLoadingRefineModels] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [workingImageId, setWorkingImageId] = useState<number | null>(null);
  const [modelSelectionWarning, setModelSelectionWarning] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const batchId = batch?.id || 0;
  const hasReferenceAssets = referenceAssets.length > 0;
  const pendingImages = (batch?.images || []).filter((image) => image.review_status === "pending");
  const reviewedImages = (batch?.images || []).filter(
    (image) => image.review_status === "approved" || image.review_status === "refine",
  );
  const step4Images = reviewedImages;
  const pendingArchiveImages = reviewedImages.filter((image) => !image.asset_id);
  const archivedImages = (batch?.images || []).filter((image) => Boolean(image.asset_id));
  const isArchivedBatch = batch?.status === "archived";

  function syncBatch(nextBatch: BackgroundBatch) {
    setBatch(nextBatch);
    setModelConfigId((current) => current || nextBatch.model_config_id || null);
    setFormState({
      purpose: splitMultiValue(nextBatch.purpose),
      scene: nextBatch.scene,
      mood: nextBatch.mood,
      colorStyle: nextBatch.color_style,
      whitespacePositions: nextBatch.whitespace_positions,
      sizeRatio: nextBatch.size_ratio,
      localized: nextBatch.localized,
      gameFeel: nextBatch.game_feel,
      extraPrompt: nextBatch.extra_prompt || "",
    });
    setGenerationCount(coerceGenerationCount(nextBatch.count));
    setArchiveTagsByImageId((current) => {
      const nextValue = { ...current };
      const fallbackTags = defaultArchiveTags(nextBatch);
      for (const image of nextBatch.images) {
        if (!nextValue[image.id] || nextValue[image.id].length === 0) {
          nextValue[image.id] = fallbackTags;
        }
      }
      return nextValue;
    });
    setRecommendedByImageId((current) => {
      const nextValue = { ...current };
      for (const image of nextBatch.images) {
        if (nextValue[image.id] === undefined) {
          nextValue[image.id] = Boolean(image.is_recommended);
        }
      }
      return nextValue;
    });
  }

  async function loadBackgroundTagGroups() {
    try {
      const res = await apiGet<BackgroundTagOption[]>(
        `/api/assets/tags?category=${encodeURIComponent("background")}`,
      );
      setTagGroups(buildBackgroundTagGroups(Array.isArray(res.data) ? res.data : []));
    } catch {
      setTagGroups({ purpose: [], scene: [], mood: [], colorStyle: [] });
    }
  }

  async function loadReferenceAssets(assetIds: number[]) {
    if (assetIds.length === 0) {
      setReferenceAssets([]);
      return;
    }
    try {
      const res = await apiGet<Asset[]>(`/api/assets?category=${encodeURIComponent(BACKGROUND_TAG_CATEGORY)}`);
      const items = Array.isArray(res.data) ? res.data : [];
      const selectedAssets = assetIds
        .map((assetId) => items.find((item) => item.id === assetId))
        .filter((item): item is Asset => Boolean(item));
      setReferenceAssets(selectedAssets);
    } catch {
      setReferenceAssets([]);
    }
  }

  function modelPrice(model: ModelConfig) {
    return Number(model.price_per_image || 0);
  }

  async function fetchAvailableModels(mode?: "refine") {
    const res = await apiGet<ModelConfig[]>(
      `/api/background/available-models${mode ? `?mode=${mode}` : ""}`,
    );
    if (res.code !== 0) {
      throw new Error(res.msg || t("背景图模型加载失败"));
    }
    return Array.isArray(res.data) ? res.data : [];
  }

  async function loadAvailableModels() {
    setLoadingModels(true);
    try {
      const mode = hasReferenceAssets ? "refine" : undefined;
      const allModels = await fetchAvailableModels(mode);
      setAvailableModels(allModels);
      const currentModelExists = modelConfigId != null && allModels.some((model) => model.id === modelConfigId);
      if (currentModelExists) {
        setModelSelectionWarning("");
        return;
      }
      const batchModelExists =
        batch?.model_config_id != null && allModels.some((model) => model.id === batch.model_config_id);
      const nextSelectedModelId = batchModelExists ? (batch?.model_config_id || null) : (allModels[0]?.id || null);
      setModelConfigId(nextSelectedModelId);
      setModelSelectionWarning(modelConfigId != null && nextSelectedModelId != null ? t("已选模型不支持参考图，已自动切换") : "");
    } catch (err) {
      setAvailableModels([]);
      setModelConfigId(null);
      setModelSelectionWarning("");
      setError(err instanceof Error ? err.message : t("背景图模型加载失败"));
    } finally {
      setLoadingModels(false);
    }
  }

  async function loadRefineModels() {
    setLoadingRefineModels(true);
    try {
      const allModels = await fetchAvailableModels("refine");
      const recommendedModel = [...allModels].sort((a, b) => modelPrice(b) - modelPrice(a))[0] || null;
      setRefineAvailableModels(allModels);
      setRefineModelConfigId((current) => {
        if (current && allModels.some((model) => model.id === current)) return current;
        if (batch?.model_config_id && allModels.some((model) => model.id === batch.model_config_id)) {
          return batch.model_config_id;
        }
        return recommendedModel?.id || null;
      });
    } catch (err) {
      setRefineAvailableModels([]);
      setError(err instanceof Error ? err.message : t("精修模型加载失败"));
    } finally {
      setLoadingRefineModels(false);
    }
  }

  async function refreshBatch(nextBatchId: number) {
    const res = await apiGet<BackgroundBatch>(`/api/background/batches/${nextBatchId}`);
    if (res.code !== 0 || !res.data) {
      throw new Error(res.msg || t("背景批次加载失败"));
    }
    const normalizedBatch = normalizeBackgroundBatch(res.data);
    syncBatch(normalizedBatch);
    return normalizedBatch;
  }

  useEffect(() => {
    loadBackgroundTagGroups();
  }, []);

  useEffect(() => {
    if (step !== 2) return;
    loadAvailableModels();
  }, [step, batch?.model_config_id, referenceAssets.length]);

  useEffect(() => {
    if (step !== 3) return;
    loadRefineModels();
  }, [step, batch?.model_config_id]);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      if (!sessionId) return;
      setRestoring(true);
      setError("");
      try {
        const sessionRes = await apiGet<WorkflowSessionRecord>(`/api/workflow-sessions/${sessionId}`);
        if (sessionRes.code !== 0 || !sessionRes.data) {
          throw new Error(sessionRes.msg || t("背景图 session 加载失败"));
        }
        const state = parseSessionState(sessionRes.data.state_json);
        const reference_asset_ids = Array.isArray(state.reference_asset_ids) ? state.reference_asset_ids : [];
        if (reference_asset_ids.length > 0) {
          await loadReferenceAssets(reference_asset_ids);
        }
        if (state.batch_id) {
          const restoredBatch = await refreshBatch(Number(state.batch_id));
          if (!cancelled) {
            setStep(Math.max(Number(sessionRes.data.current_step || 1), restoredBatch.images.length > 0 ? 2 : 1));
          }
        } else if (!cancelled) {
          setStep(Math.max(Number(sessionRes.data.current_step || 1), 1));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("背景图 session 恢复失败"));
        }
      } finally {
        if (!cancelled) {
          setRestoring(false);
        }
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function updateForm<K extends keyof BackgroundFormState>(key: K, value: BackgroundFormState[K]) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function canVisitStep(targetStep: number) {
    if (targetStep === 1) return true;
    if (targetStep === 2) return Boolean(batch);
    if (targetStep === 3) return reviewedImages.length > 0;
    if (targetStep === 4) return reviewedImages.length > 0 || archivedImages.length > 0;
    return false;
  }

  async function handleCreateBatch() {
    if (formState.purpose.length === 0 || !formState.scene || formState.mood.length === 0 || !formState.colorStyle) {
      setError(t("请完整填写用途、场景、氛围和颜色风格"));
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<BackgroundBatch>("/api/background/batches/create", {
        purpose: joinMultiValue(formState.purpose),
        scene: formState.scene,
        mood: formState.mood,
        color_style: formState.colorStyle,
        whitespace_positions: formState.whitespacePositions,
        size_ratio: formState.sizeRatio,
        localized: formState.localized,
        game_feel: formState.gameFeel,
        extra_prompt: formState.extraPrompt || undefined,
        session_id: sessionId ? Number(sessionId) : undefined,
        reference_asset_ids: referenceAssets.map((asset) => asset.id),
      });
      if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || t("背景图批次创建失败"));
      }
      const createdBatch = normalizeBackgroundBatch(res.data);
      syncBatch(createdBatch);
      if (createdBatch.session_id) {
        router.replace(`/workflows/background?session_id=${createdBatch.session_id}`);
      }
      setStep(2);
      setMessage(t("背景图任务已创建，开始生成草图。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("背景图批次创建失败"));
    } finally {
      setLoading(false);
    }
  }

  async function handleGenerate(regenerateImageId?: number) {
    if (!batchId) return;
    if (isArchivedBatch) {
      setError(t("该批次已入库，如需重新生成请新建任务"));
      return;
    }
    if (!modelConfigId) {
      setError(t("请选择模型"));
      return;
    }
    setGenerating(true);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<BackgroundBatch>(
        `/api/background/batches/${batchId}/generate`,
        {
          model_config_id: modelConfigId,
          reference_asset_ids: referenceAssets.map((asset) => asset.id),
          regenerate_image_id: regenerateImageId || undefined,
          count: regenerateImageId ? 1 : generationCount,
        },
        GENERATION_TIMEOUT_MS,
      );
      if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || t("背景图生成失败"));
      }
      await refreshBatch(batchId);
      setStep(2);
      setMessage(regenerateImageId ? t("已完成单张重生成") : t("背景图候选图已生成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("背景图生成失败"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleReviewImage(
    imageId: number,
    review_status: string,
    extra: { image_url?: string; thumbnail_url?: string } = {},
  ) {
    setWorkingImageId(imageId);
    setError("");
    setMessage("");
    try {
      const res = await apiPatch<BackgroundBatchImage>(`/api/background/images/${imageId}/review`, {
        review_status,
        ...extra,
      });
      if (res.code !== 0) {
        throw new Error(res.msg || t("背景图审核更新失败"));
      }
      await refreshBatch(batchId);
      setMessage(t("候选图状态已更新"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("背景图审核更新失败"));
    } finally {
      setWorkingImageId(null);
    }
  }

  async function handleReplaceRefinedImage(imageId: number, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setWorkingImageId(imageId);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filename", file.name);
      formData.append("category", BACKGROUND_TAG_CATEGORY);
      formData.append("tags", "background-refine-upload");
      const uploadRes = await apiUpload<Asset>("/api/assets/upload", formData, 120000);
      if (uploadRes.code !== 0 || !uploadRes.data?.url) {
        throw new Error(uploadRes.msg || t("精修图上传失败"));
      }
      const currentImage = (batch?.images || []).find((item) => item.id === imageId);
      await handleReviewImage(imageId, currentImage?.review_status || "refine", {
        image_url: uploadRes.data.url,
        thumbnail_url: uploadRes.data.url,
      });
      setMessage(t("精修替换图已保存"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("精修替换图上传失败"));
    } finally {
      setWorkingImageId(null);
    }
  }

  async function handleAiRefineImage(imageId: number) {
    if (!batchId || !refineModelConfigId) return;

    setWorkingImageId(imageId);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<BackgroundBatchImage>(
        `/api/background/images/${imageId}/refine`,
        {
          model_config_id: refineModelConfigId,
          refine_prompt: refinePromptByImageId[imageId] || undefined,
        },
        GENERATION_TIMEOUT_MS,
      );
      if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || t("AI 精修失败"));
      }
      await refreshBatch(batchId);
      setMessage(t("AI 精修已完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("AI 精修失败"));
    } finally {
      setWorkingImageId(null);
    }
  }

  async function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const remaining = Math.max(MAX_REFERENCE_UPLOADS - referenceAssets.length, 0);
    const uploadFiles = files.slice(0, remaining);
    if (uploadFiles.length === 0) {
      setError(`${t("参考图最多 3 张，当前已上传")} ${referenceAssets.length} ${t("张")}`);
      return;
    }

    setUploadingReferences(true);
    setError("");
    setMessage("");
    try {
      const uploadedAssets: Asset[] = [];
      for (const file of uploadFiles) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("filename", file.name);
        formData.append("category", BACKGROUND_TAG_CATEGORY);
        formData.append("tags", "background-reference,参考图");
        const res = await apiUpload<Asset>("/api/assets/upload", formData, 120000);
        if (res.code === 0 && res.data) {
          uploadedAssets.push(res.data);
        }
      }
      setReferenceAssets((current) => [...current, ...uploadedAssets].slice(0, MAX_REFERENCE_UPLOADS));
      setMessage(`${t("已上传")} ${uploadedAssets.length} ${t("张参考图")}`);
    } catch {
      setError(t("参考图上传失败"));
    } finally {
      setUploadingReferences(false);
    }
  }

  function removeReferenceAsset(assetId: number) {
    setReferenceAssets((current) => current.filter((asset) => asset.id !== assetId));
  }

  function addArchiveTag(imageId: number) {
    const nextTag = String(archiveInputByImageId[imageId] || "").trim();
    if (!nextTag) return;
    setArchiveTagsByImageId((current) => ({
      ...current,
      [imageId]: uniqueStrings([...(current[imageId] || []), nextTag]),
    }));
    setArchiveInputByImageId((current) => ({ ...current, [imageId]: "" }));
  }

  function removeArchiveTag(imageId: number, tag: string) {
    setArchiveTagsByImageId((current) => ({
      ...current,
      [imageId]: (current[imageId] || []).filter((item) => item !== tag),
    }));
  }

  async function handleArchiveImage(imageId: number) {
    setWorkingImageId(imageId);
    setError("");
    setMessage("");
    try {
      const res = await apiPost(`/api/background/images/${imageId}/archive`, {
        tags: archiveTagsByImageId[imageId] || defaultArchiveTags(batch),
        is_recommended: Boolean(recommendedByImageId[imageId]),
      });
      if (res.code !== 0) {
        throw new Error(res.msg || t("背景图入库失败"));
      }
      await refreshBatch(batchId);
      setStep(4);
      setMessage(t("背景图已入素材库"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("背景图入库失败"));
    } finally {
      setWorkingImageId(null);
    }
  }

  return (
    <div className={ACTIVITY_PAGE_SHELL_CLASS}>
      <div className={ACTIVITY_PAGE_INNER_CLASS}>
        <PageHeader
          title={t("背景图生成")}
          description={t("复用现有素材、标签与 session 体系，完成背景图批次生成、筛选、精修与入库。")}
        />

        <div className="flex flex-wrap gap-3">
          <Link href="/workflows" className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
            {t("返回任务列表")}
          </Link>
          <Link href="/assets" className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
            {t("打开素材库")}
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}
        {restoring && (
          <div className={ACTIVITY_PANEL_CLASS}>
            <p className="text-sm text-gray-500">{t("正在恢复背景图 session…")}</p>
          </div>
        )}

        <StepLayout
          currentStep={step}
          steps={STEP_TITLES.map((label) => ({ label: t(label) }))}
          onStepSelect={(targetStep) => {
            if (canVisitStep(targetStep)) setStep(targetStep);
          }}
          canVisitStep={canVisitStep}
        >
        {step === 1 && (
          <section className={ACTIVITY_SECTION_CARD_CLASS}>
            <WorkflowStepHeader
              step={1}
              title={t("填写任务参数")}
              description={t("用途 / 场景 / 氛围 / 颜色风格均从背景标签动态加载，不做硬编码。")}
              actions={
                <button type="button" onClick={handleCreateBatch} disabled={loading} className={ACTIVITY_PRIMARY_BUTTON_CLASS}>
                  {loading ? t("创建中…") : t("保存任务并进入生成")}
                </button>
              }
            />

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <TagCombobox
                  label={t("背景用途")}
                  options={tagGroups.purpose.map((tag) => ({ name: tag.name, tag_group: tag.group }))}
                  selected={formState.purpose}
                  onChange={(selected) => updateForm("purpose", selected)}
                  category={BACKGROUND_TAG_CATEGORY}
                  tagGroup="purpose"
                  multiple
                  onOptionsRefresh={loadBackgroundTagGroups}
                />
              </div>

              <div>
                <TagCombobox
                  label={t("场景类型")}
                  options={tagGroups.scene.map((tag) => ({ name: tag.name, tag_group: tag.group }))}
                  selected={formState.scene ? [formState.scene] : []}
                  onChange={(selected) => updateForm("scene", selected[0] || "")}
                  category={BACKGROUND_TAG_CATEGORY}
                  tagGroup="scene"
                  onOptionsRefresh={loadBackgroundTagGroups}
                />
              </div>

              <div>
                <TagCombobox
                  label={t("氛围")}
                  options={tagGroups.mood.map((tag) => ({ name: tag.name, tag_group: tag.group }))}
                  selected={formState.mood}
                  onChange={(selected) => updateForm("mood", selected)}
                  category={BACKGROUND_TAG_CATEGORY}
                  tagGroup="mood"
                  multiple
                  onOptionsRefresh={loadBackgroundTagGroups}
                />
              </div>

              <div>
                <TagCombobox
                  label={t("颜色风格")}
                  options={tagGroups.colorStyle.map((tag) => ({ name: tag.name, tag_group: tag.group }))}
                  selected={formState.colorStyle ? [formState.colorStyle] : []}
                  onChange={(selected) => updateForm("colorStyle", selected[0] || "")}
                  category={BACKGROUND_TAG_CATEGORY}
                  tagGroup="color_style"
                  onOptionsRefresh={loadBackgroundTagGroups}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t("留白位置")}</label>
                <WhitespacePositionPicker
                  value={formState.whitespacePositions}
                  onChange={(positions) => updateForm("whitespacePositions", positions)}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t("输出尺寸")}</label>
                <div className="flex flex-wrap gap-2">
                  {SIZE_RATIO_OPTIONS.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => updateForm("sizeRatio", ratio)}
                      className={selectChipClass(formState.sizeRatio === ratio)}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t("本地风格化")}</label>
                <button
                  type="button"
                  onClick={() => updateForm("localized", !formState.localized)}
                  className={`inline-flex rounded-full px-4 py-2 text-sm font-medium ${
                    formState.localized
                      ? "bg-emerald-500 text-white"
                      : "border border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  {formState.localized ? t("已开启") : t("未开启")}
                </button>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">{t("游戏化程度")}</label>
                <div className="flex flex-wrap gap-2">
                  {GAME_FEEL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => updateForm("gameFeel", option.value)}
                      className={selectChipClass(formState.gameFeel === option.value)}
                    >
                      {t(option.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="lg:col-span-2">
                <label className="mb-2 block text-sm font-medium text-gray-700">{t("补充描述")}</label>
                <textarea
                  rows={3}
                  value={formState.extraPrompt}
                  onChange={(event) => updateForm("extraPrompt", event.target.value)}
                  placeholder={t("可选。用自然语言补充标签未覆盖的场景细节，例如：地方集市，摊位密集，彩色遮阳布，热闹氛围")}
                  className={`${ACTIVITY_INPUT_CLASS} min-h-[88px]`}
                />
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{t("参考图上传")}</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("最多 3 张。上传参考图后，生成模型将自动限制为支持参考图模式的模型（gpt-image 系列），不支持参考图的模型（如 Gemini）将被过滤。")}
                  </p>
                </div>
                <label className="inline-flex cursor-pointer rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
                  {uploadingReferences ? t("上传中…") : t("上传参考图")}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleReferenceUpload}
                  />
                </label>
              </div>

              {referenceAssets.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {referenceAssets.map((asset) => (
                    <div key={asset.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                      <img src={absoluteUrl(asset.url)} alt={asset.filename} className="aspect-square w-full object-cover" />
                      <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-600">
                        <span className="truncate">{asset.filename}</span>
                        <button
                          type="button"
                          onClick={() => removeReferenceAsset(asset.id)}
                          className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
                        >
                          {t("移除")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className={ACTIVITY_SECTION_CARD_CLASS}>
            <WorkflowStepHeader
              step={2}
              title={t("生成草图 & 人工筛选")}
              description={t("点击生成后，逐张执行通过、废弃、重生成、精修。")}
              actions={
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={reviewedImages.length === 0}
                  className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                >
                  {t("下一步：精修标准化")}
                </button>
              }
            />

            {!batchId ? (
              <div className={ACTIVITY_PANEL_CLASS}>
                <p className="text-sm text-gray-500">{t("请先完成 Step 1 并创建背景图批次。")}</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className={ACTIVITY_PANEL_CLASS}>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
                    <ModelSelector
                      models={availableModels}
                      value={modelConfigId}
                      onChange={(id) => {
                        setModelConfigId(id || null);
                        setModelSelectionWarning("");
                      }}
                      loading={loadingModels}
                      disabled={generating}
                      loadingText={t("正在加载可用模型…")}
                    />

                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">{t("生成数量")}</span>
                      <select
                        value={generationCount}
                        onChange={(event) => setGenerationCount(Number(event.target.value) || 4)}
                        disabled={generating}
                        className={ACTIVITY_INPUT_CLASS}
                      >
                        {GENERATION_COUNT_OPTIONS.map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </label>

                    <GenerateButton
                      onClick={() => handleGenerate()}
                      loading={generating}
                      disabled={!batchId || isArchivedBatch || generating || loadingModels || !modelConfigId}
                      label={isArchivedBatch ? t("已入库") : t("开始生成")}
                      loadingLabel={t("生成中…")}
                    />
                  </div>

                  {modelSelectionWarning && (
                    <p className="mt-2 text-xs text-amber-600">{modelSelectionWarning}</p>
                  )}
                  {isArchivedBatch && (
                    <p className="mt-2 text-xs text-gray-500">{t("该批次已入库，如需重新生成请新建任务")}</p>
                  )}
                </div>

                {generating && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p className="text-sm text-gray-600">{t("正在调用 AI 生成背景图，请稍候…")}</p>
                  </div>
                )}

                <div className="space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-gray-900">{t("待筛选")}</h3>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {pendingImages.length} 张
                      </span>
                    </div>
                    {pendingImages.length > 0 ? (
                      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {pendingImages.map((image) => {
                          const imageId = image.id;
                          return (
                            <ImageReviewCard
                              key={image.id}
                              imageUrl={absoluteUrl(image.thumbnail_url || image.image_url)}
                              status="pending"
                              imageId={image.id}
                              onApprove={() => handleReviewImage(imageId, "approved")}
                              onReject={() => handleReviewImage(imageId, "rejected")}
                              onRegenerate={() => handleGenerate(imageId)}
                              onRefine={() => handleReviewImage(imageId, "refine")}
                              loading={workingImageId === imageId}
                              disabled={workingImageId === imageId || isArchivedBatch || generating || !modelConfigId}
                              extra={<div className="text-xs text-gray-400">调用 {image.use_count || 0}</div>}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <div className={ACTIVITY_PANEL_CLASS}>
                        <p className="text-sm text-gray-500">{t("当前没有待筛选图片，选择模型和数量后可以继续生成。")}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold text-gray-900">{t("已通过")}</h3>
                      <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                        {reviewedImages.length} 张
                      </span>
                    </div>
                    {reviewedImages.length > 0 ? (
                      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                        {reviewedImages.map((image) => (
                          <ImageReviewCard
                            key={image.id}
                            imageUrl={absoluteUrl(image.thumbnail_url || image.image_url)}
                            status={image.review_status === "approved" ? "approved" : "refine"}
                            imageId={image.id}
                            onRevoke={() => handleReviewImage(image.id, "pending")}
                            loading={workingImageId === image.id}
                            disabled={workingImageId === image.id}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className={ACTIVITY_PANEL_CLASS}>
                        <p className="text-sm text-gray-500">{t("通过或标记精修后的图片会集中展示在这里，至少保留一张才能进入下一步。")}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {step === 3 && (
          <section className={ACTIVITY_SECTION_CARD_CLASS}>
            <WorkflowStepHeader
              step={3}
              title={t("精修标准化")}
              description={t("展示已通过的图，支持上传替换精修后的版本，然后进入入库步骤。")}
              actions={
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  disabled={reviewedImages.length === 0}
                  className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                >
                  {t("进入入素材库")}
                </button>
              }
            />

            {reviewedImages.length === 0 ? (
              <div className={ACTIVITY_PANEL_CLASS}>
                <p className="text-sm text-gray-500">{t("请先在 Step 2 至少保留一张通过或精修的候选图。")}</p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className={ACTIVITY_PANEL_CLASS}>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <ModelSelector
                      models={refineAvailableModels}
                      value={refineModelConfigId}
                      onChange={(id) => setRefineModelConfigId(id || null)}
                      loading={loadingRefineModels}
                      label={t("精修模型")}
                      loadingText={t("正在加载精修模型…")}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{t("精修使用参考图模式，仅支持 gpt-image 系列模型")}</p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {reviewedImages.map((image) => (
                    <ImageReviewCard
                      key={image.id}
                      imageUrl={absoluteUrl(image.image_url)}
                      status={image.review_status === "approved" ? "approved" : "refine"}
                      imageId={image.id}
                      extra={
                        <>
                          <label className="block">
                            <span className="mb-2 block text-sm font-medium text-gray-700">{t("精修指令（可选）")}</span>
                            <textarea
                              rows={2}
                              value={refinePromptByImageId[image.id] || ""}
                              onChange={(event) =>
                                setRefinePromptByImageId((current) => ({
                                  ...current,
                                  [image.id]: event.target.value,
                                }))
                              }
                              placeholder={t("针对这张图的精修方向，例如：增强光影层次、去掉右下角多余元素")}
                              className={`${ACTIVITY_INPUT_CLASS} min-h-[72px]`}
                            />
                          </label>
                          <div className="flex flex-wrap gap-3">
                            <label
                              className={`inline-flex rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700 ${
                                workingImageId === image.id ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-gray-50"
                              }`}
                            >
                              {workingImageId === image.id ? t("上传中…") : t("上传替换精修图")}
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={workingImageId === image.id}
                                onChange={(event) => handleReplaceRefinedImage(image.id, event)}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => handleAiRefineImage(image.id)}
                              disabled={workingImageId === image.id || !refineModelConfigId}
                              className="rounded-md border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                            >
                              {workingImageId === image.id ? t("精修中...") : t("AI 精修")}
                            </button>
                          </div>
                        </>
                      }
                    />
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {step === 4 && (
          <section className={ACTIVITY_SECTION_CARD_CLASS}>
            <WorkflowStepHeader
              step={4}
              title={t("入素材库")}
              description={t("标签默认预填 Step 1 选择结果，可调整；入库后自动归类到 background。")}
              actions={<div className="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700">{t("已入库")} {archivedImages.length} {t("张")}</div>}
            />

            {step4Images.length === 0 ? (
              <div className={ACTIVITY_PANEL_CLASS}>
                <p className="text-sm text-gray-500">{t("当前没有待入库图片。已入库图片可在素材库和任务列表中查看。")}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {step4Images.map((image) => {
                  const archived = Boolean(image.asset_id);
                  return (
                  <article key={image.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="grid gap-4 lg:grid-cols-[320px,1fr]">
                      <img
                        src={absoluteUrl(image.image_url)}
                        alt={`archive-background-${image.id}`}
                        className="aspect-[4/3] w-full rounded-lg object-cover"
                      />
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">{t("待入库图片")} #{image.id}</h3>
                            <p className="mt-1 text-xs text-gray-500">review_status: {image.review_status}</p>
                          </div>
                          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={Boolean(recommendedByImageId[image.id])}
                              disabled={archived}
                              onChange={(event) =>
                                setRecommendedByImageId((current) => ({
                                  ...current,
                                  [image.id]: event.target.checked,
                                }))
                              }
                              className="h-4 w-4 rounded border-gray-300"
                            />
                            {t("设为推荐")}
                          </label>
                        </div>

                        <TagChipEditor
                          tags={archiveTagsByImageId[image.id] || defaultArchiveTags(batch)}
                          inputValue={archiveInputByImageId[image.id] || ""}
                          onInputChange={(value) =>
                            setArchiveInputByImageId((current) => ({ ...current, [image.id]: value }))
                          }
                          onAddTag={() => addArchiveTag(image.id)}
                          onRemoveTag={(tag) => removeArchiveTag(image.id, tag)}
                        />

                        <button
                          type="button"
                          onClick={() => handleArchiveImage(image.id)}
                          disabled={archived || workingImageId === image.id}
                          className={
                            archived
                              ? "rounded-md border border-gray-200 bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-500"
                              : ACTIVITY_PRIMARY_BUTTON_CLASS
                          }
                        >
                          {workingImageId === image.id ? t("入库中…") : archived ? t("已入库") : t("确认入素材库")}
                        </button>
                        {archived && (
                          <p className="text-[13px] text-gray-500">
                            {t("已加入素材库，可在活动图工作流 Step 2 背景选择器中直接选用")}
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                )})}
                {pendingArchiveImages.length === 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                    <p className="text-sm font-medium text-emerald-800">{t("所有背景图已入库，本次任务完成")}</p>
                    <button
                      type="button"
                      onClick={() => router.push("/workflows")}
                      className="mt-4 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      {t("返回任务列表")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
        </StepLayout>
      </div>
    </div>
  );
}
