"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import PageHeader from "@/components/common/PageHeader";
import GenerateButton from "@/components/workflow/GenerateButton";
import ModelSelector from "@/components/workflow/ModelSelector";
import StepLayout from "@/components/workflow/StepLayout";
import WorkflowStepHeader from "@/components/workflow/WorkflowStepHeader";
import { useLanguage } from "@/lib/LanguageContext";
import { apiGet, apiPost } from "@/lib/api";
import { DAILY_POST_TEMPLATE_TYPES } from "@/lib/constants";
import { getTagLabel } from "@/lib/tag-display";
import {
  ACTIVITY_INPUT_CLASS,
  ACTIVITY_PAGE_INNER_CLASS,
  ACTIVITY_PAGE_SHELL_CLASS,
  ACTIVITY_PANEL_CLASS,
  ACTIVITY_PRIMARY_BUTTON_CLASS,
  ACTIVITY_SECONDARY_BUTTON_CLASS,
  ACTIVITY_SECTION_CARD_CLASS,
  getActivityTemplateCardClasses,
  getActivityTemplateTypeTabClasses,
} from "@/lib/activity-workflow-theme";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
const STEP_TITLES = ["选择今日主题", "选择模板", "填写内容", "配置画面", "生成图片", "审核归档"];
const INTERACTION_OPTIONS = [
  { value: "comment", label: "评论" },
  { value: "choice", label: "选择" },
  { value: "emoji", label: "表情" },
];
const STYLE_OPTIONS = [
  { value: "3d_cartoon", label: "3D卡通" },
  { value: "social", label: "社媒风" },
];
const AD_SIZE_OPTIONS = [
  { value: "1080x1080", label: "FB 方图" },
  { value: "1080x1920", label: "TikTok 竖版" },
  { value: "1080x566", label: "FB 横版" },
];
const IMAGE_LANGUAGE_OPTIONS = [
  { value: "english", label: "English" },
  { value: "taglish", label: "Taglish" },
  { value: "chinese", label: "中文" },
];

interface DailyPostTemplateType {
  value: string;
  label: string;
}

interface DailyPostOption {
  id: number;
  value: string;
  label_zh: string;
  is_preset: boolean;
  is_enabled: boolean;
  sort_order: number;
}

interface DailyPostTemplate {
  id: number;
  name: string;
  template_type: string;
  title_copy?: string | null;
  interaction_copy?: string | null;
  option_a?: string | null;
  option_b?: string | null;
  option_c?: string | null;
  bull_action?: string | null;
  background?: string | null;
  style?: string | null;
  color_mood?: string | null;
  brand_weight?: string | null;
  is_enabled: boolean;
  sort_order: number;
}

interface AssetTag {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  group?: string | null;
}

interface AssetReference {
  id: number;
  url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  name?: string | null;
  filename?: string | null;
}

interface AvailableModel {
  id: number;
  name: string;
  provider: string;
  model_name?: string;
  price_per_image?: number | string | null;
  usage_type?: string | null;
}

type ReviewStatus = "pending" | "archived" | "refine" | "deleted";

interface GeneratedImage {
  id: number;
  url: string;
  refinePrompt: string;
  refining: boolean;
  reviewStatus: ReviewStatus;
}

interface WorkflowState {
  sessionId: number | null;
  taskId: number | null;
  jobId: number | null;
  maxVisitedStep: number;
  todayTheme: string;
  userEmotion: string;
  interactionMode: "comment" | "choice" | "emoji";
  selectedTemplateType: string;
  selectedTemplateId: number | null;
  selectedTemplate: DailyPostTemplate | null;
  mainCopy: string;
  interactionQuestion: string;
  optionA: string;
  optionB: string;
  optionC: string;
  auxCopy: string;
  imageLanguage: string;
  adSize: string;
  generateCount: number;
  globalExtraPrompt: string;
  bullAction: string;
  background: string;
  style: string;
  colorMood: string;
  referenceAssetIds: number[];
  modelConfigId: number | null;
  generatedImages: GeneratedImage[];
  workflowCompleted: boolean;
  qc: {
    bullOk: boolean;
    copyClear: boolean;
    compositionFit: boolean;
  };
}

interface TaskCreateResponse {
  id: number;
}

interface DailyPostJobResponse {
  id: number;
  template_id?: number | null;
  task_id?: number | null;
  session_id?: number | null;
  today_theme: string;
  user_emotion: string;
  main_copy: string;
  interaction_question: string;
  option_a_override?: string | null;
  option_b_override?: string | null;
  option_c_override?: string | null;
  aux_copy?: string | null;
  bull_action_override?: string | null;
  background_override?: string | null;
  image_language?: string;
  model_config_id?: number | null;
  status: string;
  generated_image_url?: string | null;
  archived_asset_id?: number | null;
  cost_usd?: number | string | null;
  template?: {
    id: number;
    name: string;
    template_type: string;
    is_enabled: boolean;
  } | null;
}

interface WorkflowSessionResponse {
  id: number;
  session_id: number;
  workflow_type: string;
  mode: string;
  status: string;
  current_step: number;
  state_json?: string | null;
  task_id?: number | null;
}

const DEFAULT_STATE: WorkflowState = {
  sessionId: null,
  taskId: null,
  jobId: null,
  maxVisitedStep: 1,
  todayTheme: "",
  userEmotion: "",
  interactionMode: "comment",
  selectedTemplateType: DAILY_POST_TEMPLATE_TYPES[0]?.value || "emotion",
  selectedTemplateId: null,
  selectedTemplate: null,
  mainCopy: "",
  interactionQuestion: "",
  optionA: "",
  optionB: "",
  optionC: "",
  auxCopy: "",
  imageLanguage: "english",
  adSize: "1080x1080",
  generateCount: 2,
  globalExtraPrompt: "",
  bullAction: "happy",
  background: "rain",
  style: "3d_cartoon",
  colorMood: "warm",
  referenceAssetIds: [],
  modelConfigId: null,
  generatedImages: [],
  workflowCompleted: false,
  qc: {
    bullOk: false,
    copyClear: false,
    compositionFit: false,
  },
};

const CUSTOM_OPTION_VALUE = "__custom__";

function absoluteUrl(url?: string | null) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (safeUrl.startsWith("http://") || safeUrl.startsWith("https://") || safeUrl.startsWith("blob:")) {
    return safeUrl;
  }
  return `${API_BASE}${safeUrl}`;
}

function assetImageUrl(asset?: AssetReference | null) {
  if (!asset) return "";
  return absoluteUrl(asset.thumbnail_url || asset.image_url || asset.url);
}

function templateTypeLabel(type: string) {
  return DAILY_POST_TEMPLATE_TYPES.find((item) => item.value === type)?.label || type;
}

function templatePreviewLines(template: DailyPostTemplate, t: (value: string) => string) {
  return [
    template.title_copy ? `${t("主文案")}：${template.title_copy}` : `${t("主文案")}：-`,
    template.interaction_copy ? `${t("互动问题")}：${template.interaction_copy}` : `${t("互动问题")}：-`,
  ];
}

function parseDailyPostState(stateJson?: string | null): Partial<WorkflowState> {
  if (!stateJson) return {};
  try {
    return JSON.parse(stateJson) as Partial<WorkflowState>;
  } catch {
    return {};
  }
}

function clampStep(step: number) {
  return Math.min(Math.max(Number(step || 1), 1), 6);
}

function assetDisplayName(asset: AssetReference) {
  return asset.name || asset.filename || `#${asset.id}`;
}

function makeGeneratedImage(
  url: string,
  refinePrompt = "",
  refining = false,
  reviewStatus: ReviewStatus = "pending",
): GeneratedImage {
  return {
    id: Date.now() + Math.random(),
    url,
    refinePrompt,
    refining,
    reviewStatus,
  };
}

function normalizeGeneratedImage(image: unknown): GeneratedImage | null {
  if (!image) return null;
  if (typeof image === "string") {
    return makeGeneratedImage(image);
  }
  if (typeof image !== "object") return null;

  const candidate = image as {
    id?: unknown;
    url?: unknown;
    image_url?: unknown;
    refinePrompt?: unknown;
    refining?: unknown;
    reviewStatus?: unknown;
  };
  const url = typeof candidate.url === "string" ? candidate.url : typeof candidate.image_url === "string" ? candidate.image_url : "";
  if (!url) return null;
  const reviewStatus =
    candidate.reviewStatus === "pending" ||
    candidate.reviewStatus === "archived" ||
    candidate.reviewStatus === "refine" ||
    candidate.reviewStatus === "deleted"
      ? candidate.reviewStatus
      : "pending";
  return {
    id: typeof candidate.id === "number" ? candidate.id : Date.now() + Math.random(),
    url,
    refinePrompt: typeof candidate.refinePrompt === "string" ? candidate.refinePrompt : "",
    refining: Boolean(candidate.refining),
    reviewStatus,
  };
}

function normalizeGeneratedImages(value: unknown): GeneratedImage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeGeneratedImage(item)).filter((item): item is GeneratedImage => Boolean(item));
}

function appendGeneratedImage(url: string): GeneratedImage {
  return makeGeneratedImage(url, "", false, "pending");
}

function mergeDailyPostState(
  savedState: Partial<WorkflowState>,
  sessionId: number,
  currentStep: number,
): WorkflowState {
  return {
    ...DEFAULT_STATE,
    ...savedState,
    sessionId,
    maxVisitedStep: Math.max(Number(savedState.maxVisitedStep || 1), clampStep(currentStep)),
    selectedTemplateId: savedState.selectedTemplateId ?? null,
    selectedTemplate: (savedState.selectedTemplate as DailyPostTemplate | null) || null,
    generatedImages: normalizeGeneratedImages(savedState.generatedImages),
    referenceAssetIds: Array.isArray(savedState.referenceAssetIds)
      ? savedState.referenceAssetIds.filter((item): item is number => typeof item === "number")
      : [],
    imageLanguage: typeof savedState.imageLanguage === "string" ? savedState.imageLanguage : "english",
    adSize: typeof savedState.adSize === "string" ? savedState.adSize : "1080x1080",
    workflowCompleted: Boolean(savedState.workflowCompleted),
    qc: {
      ...DEFAULT_STATE.qc,
      ...(savedState.qc || {}),
    },
  };
}

function ensureCurrentOption<T extends DailyPostOption>(options: T[], value: string): T[] {
  if (!value || options.some((item) => item.value === value)) {
    return options;
  }
  return [
    {
      id: -1,
      value,
      label_zh: value,
      is_preset: false,
      is_enabled: true,
      sort_order: -1,
    } as T,
    ...options,
  ];
}

export default function DailyPostWorkflowPage() {
  const { t, lang } = useLanguage();
  const [currentStep, setCurrentStep] = useState(1);
  const [workflowState, setWorkflowState] = useState<WorkflowState>(DEFAULT_STATE);
  const [templateTypes, setTemplateTypes] = useState<DailyPostTemplateType[]>([...DAILY_POST_TEMPLATE_TYPES]);
  const [activeTemplateType, setActiveTemplateType] = useState<string>(DEFAULT_STATE.selectedTemplateType);
  const [templates, setTemplates] = useState<DailyPostTemplate[]>([]);
  const [bullActions, setBullActions] = useState<DailyPostOption[]>([]);
  const [backgrounds, setBackgrounds] = useState<DailyPostOption[]>([]);
  const [colorMoods, setColorMoods] = useState<DailyPostOption[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [assetTags, setAssetTags] = useState<AssetTag[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<AssetReference[]>([]);
  const [referenceAssetCatalog, setReferenceAssetCatalog] = useState<Record<number, AssetReference>>({});
  const [selectedReferenceTag, setSelectedReferenceTag] = useState<string>("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingOptionCatalog, setLoadingOptionCatalog] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingAssetTags, setLoadingAssetTags] = useState(false);
  const [loadingReferenceAssets, setLoadingReferenceAssets] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [restoringSession, setRestoringSession] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingJob, setCreatingJob] = useState(false);
  const [creatingBullAction, setCreatingBullAction] = useState(false);
  const [creatingBackground, setCreatingBackground] = useState(false);
  const [creatingColorMood, setCreatingColorMood] = useState(false);
  const [bullActionCustomOpen, setBullActionCustomOpen] = useState(false);
  const [backgroundCustomOpen, setBackgroundCustomOpen] = useState(false);
  const [colorMoodCustomOpen, setColorMoodCustomOpen] = useState(false);
  const [bullActionCustomValue, setBullActionCustomValue] = useState("");
  const [bullActionCustomLabel, setBullActionCustomLabel] = useState("");
  const [backgroundCustomValue, setBackgroundCustomValue] = useState("");
  const [backgroundCustomLabel, setBackgroundCustomLabel] = useState("");
  const [colorMoodCustomValue, setColorMoodCustomValue] = useState("");
  const [colorMoodCustomLabel, setColorMoodCustomLabel] = useState("");
  const [generating, setGenerating] = useState(false);
  const [submittingQc, setSubmittingQc] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const workflowSteps = useMemo(() => STEP_TITLES.map((label) => ({ label: t(label) })), [t]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const searchParams =
        typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
      const sessionIdParam = searchParams.get("session_id") || "";
      if (!sessionIdParam) {
        setRestoringSession(false);
        return;
      }

      setRestoringSession(true);
      setError("");
      setMessage("");
      try {
        const res = await apiGet<WorkflowSessionResponse>(`/api/workflow-sessions/${sessionIdParam}`);
        if (cancelled) return;
        if (res.code !== 0 || !res.data) {
          throw new Error(res.msg || t("草稿加载失败"));
        }
        const parsedState = parseDailyPostState(res.data.state_json);
        const nextStep = clampStep(res.data.current_step || 1);
        const restoredState = mergeDailyPostState(
          {
            ...parsedState,
            sessionId: res.data.session_id,
          },
          res.data.session_id,
          nextStep,
        );
        setWorkflowState(restoredState);
        setCurrentStep(nextStep);
        setActiveTemplateType(restoredState.selectedTemplateType || DEFAULT_STATE.selectedTemplateType);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("草稿加载失败"));
        setCurrentStep(1);
        setWorkflowState(DEFAULT_STATE);
        setActiveTemplateType(DEFAULT_STATE.selectedTemplateType);
        setTemplates([]);
        setMessage("");
      } finally {
        if (!cancelled) {
          setRestoringSession(false);
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplateTypes() {
      try {
        const res = await apiGet<DailyPostTemplateType[]>("/api/daily-post/template-types");
        if (cancelled) return;
        if (res.code !== 0) {
          throw new Error(res.msg || t("模板类型加载失败"));
        }
        const items = Array.isArray(res.data) && res.data.length > 0 ? res.data : [...DAILY_POST_TEMPLATE_TYPES];
        setTemplateTypes(items);
        if (!items.some((item) => item.value === activeTemplateType)) {
          setActiveTemplateType(items[0]?.value || DEFAULT_STATE.selectedTemplateType);
        }
      } catch (err) {
        if (cancelled) return;
        setTemplateTypes([...DAILY_POST_TEMPLATE_TYPES]);
        setError(err instanceof Error ? err.message : t("模板类型加载失败"));
      }
    }

    async function loadModels() {
      setLoadingModels(true);
      try {
        const res = await apiGet<AvailableModel[]>("/api/model-configs/available?purpose=image");
        if (cancelled) return;
        if (res.code !== 0) {
          throw new Error(res.msg || t("模型加载失败"));
        }
        const models = Array.isArray(res.data) ? res.data : [];
        setAvailableModels(models);
        if (!workflowState.modelConfigId && models.length > 0) {
          setWorkflowState((current) => ({ ...current, modelConfigId: models[0].id }));
        }
      } catch (err) {
        if (cancelled) return;
        setAvailableModels([]);
        setError(err instanceof Error ? err.message : t("模型加载失败"));
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    }

    loadTemplateTypes();
    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTemplates() {
      setLoadingTemplates(true);
      try {
        const query = activeTemplateType ? `?type=${encodeURIComponent(activeTemplateType)}` : "";
        const res = await apiGet<DailyPostTemplate[]>(`/api/daily-post/templates${query}`);
        if (cancelled) return;
        if (res.code !== 0) {
          throw new Error(res.msg || t("模板加载失败"));
        }
        setTemplates(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        if (cancelled) return;
        setTemplates([]);
        setError(err instanceof Error ? err.message : t("模板加载失败"));
      } finally {
        if (!cancelled) {
          setLoadingTemplates(false);
        }
      }
    }

    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [activeTemplateType]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptionCatalog() {
      setLoadingOptionCatalog(true);
      try {
        const [bullRes, backgroundRes, colorRes] = await Promise.all([
          apiGet<DailyPostOption[]>("/api/daily-post/options/bull-actions"),
          apiGet<DailyPostOption[]>("/api/daily-post/options/backgrounds"),
          apiGet<DailyPostOption[]>("/api/daily-post/options/color-moods"),
        ]);
        if (cancelled) return;
        if (bullRes.code !== 0) {
          throw new Error(bullRes.msg || t("牛动作选项加载失败"));
        }
        if (backgroundRes.code !== 0) {
          throw new Error(backgroundRes.msg || t("背景选项加载失败"));
        }
        if (colorRes.code !== 0) {
          throw new Error(colorRes.msg || t("颜色选项加载失败"));
        }
        setBullActions(Array.isArray(bullRes.data) ? bullRes.data : []);
        setBackgrounds(Array.isArray(backgroundRes.data) ? backgroundRes.data : []);
        setColorMoods(Array.isArray(colorRes.data) ? colorRes.data : []);
      } catch (err) {
        if (cancelled) return;
        setBullActions([]);
        setBackgrounds([]);
        setColorMoods([]);
        setError(err instanceof Error ? err.message : t("选项加载失败"));
      } finally {
        if (!cancelled) {
          setLoadingOptionCatalog(false);
        }
      }
    }

    loadOptionCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAssetTags() {
      setLoadingAssetTags(true);
      try {
        const res = await apiGet<AssetTag[]>("/api/assets/tags?category=expression");
        if (cancelled) return;
        if (res.code !== 0) {
          throw new Error(res.msg || t("角色参考图标签加载失败"));
        }
        setAssetTags(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        if (cancelled) return;
        setAssetTags([]);
        setError(err instanceof Error ? err.message : t("角色参考图标签加载失败"));
      } finally {
        if (!cancelled) {
          setLoadingAssetTags(false);
        }
      }
    }

    loadAssetTags();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadReferenceAssets() {
      setLoadingReferenceAssets(true);
      try {
        const query = new URLSearchParams({ category: "expression", limit: "18" });
        if (selectedReferenceTag) {
          query.set("tags", selectedReferenceTag);
        }
        const res = await apiGet<AssetReference[]>(`/api/assets?${query.toString()}`);
        if (cancelled) return;
        if (res.code !== 0) {
          throw new Error(res.msg || t("角色参考图加载失败"));
        }
        const items = Array.isArray(res.data) ? res.data : [];
        setReferenceAssets(items);
        setReferenceAssetCatalog((current) => {
          const next = { ...current };
          items.forEach((asset) => {
            next[asset.id] = asset;
          });
          return next;
        });
      } catch (err) {
        if (cancelled) return;
        setReferenceAssets([]);
        setError(err instanceof Error ? err.message : t("角色参考图加载失败"));
      } finally {
        if (!cancelled) {
          setLoadingReferenceAssets(false);
        }
      }
    }

    loadReferenceAssets();
    return () => {
      cancelled = true;
    };
  }, [selectedReferenceTag]);

  useEffect(() => {
    if (!previewImageUrl) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewImageUrl(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImageUrl]);

  useEffect(() => {
    if (!workflowState.modelConfigId && availableModels.length > 0) {
      setWorkflowState((current) => ({ ...current, modelConfigId: availableModels[0].id }));
    }
  }, [availableModels, workflowState.modelConfigId]);

  function updateWorkflowState(
    patch: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState> | WorkflowState),
  ) {
    setWorkflowState((current) => {
      const nextPatch = typeof patch === "function" ? patch(current) : patch;
      return { ...current, ...nextPatch };
    });
  }

  function buildNextWorkflowState(
    current: WorkflowState,
    patch: Partial<WorkflowState> | ((current: WorkflowState) => Partial<WorkflowState> | WorkflowState),
  ) {
    const nextPatch = typeof patch === "function" ? patch(current) : patch;
    return { ...current, ...nextPatch };
  }

  async function autoSave(step: number, state: WorkflowState, status: string = "draft") {
    if (!state.sessionId && !state.taskId) return;
    try {
      const res = await apiPost<WorkflowSessionResponse>("/api/workflow-sessions/save", {
        session_id: state.sessionId ?? undefined,
        workflow_type: "daily_post",
        mode: "full",
        status,
        state_json: JSON.stringify(state),
        current_step: step,
        task_id: state.taskId ?? undefined,
      });
      if (res.code === 0 && res.data?.session_id && res.data.session_id !== state.sessionId) {
        setWorkflowState((current) => ({ ...current, sessionId: res.data.session_id }));
      }
    } catch {
      // silent autosave
    }
  }

  function setCurrentStepAndSave(step: number, state: WorkflowState = workflowState) {
    setCurrentStep(step);
    void autoSave(step, state);
  }

  const bullActionSelectOptions = useMemo(
    () => ensureCurrentOption(bullActions, workflowState.bullAction),
    [bullActions, workflowState.bullAction],
  );
  const backgroundSelectOptions = useMemo(
    () => ensureCurrentOption(backgrounds, workflowState.background),
    [backgrounds, workflowState.background],
  );
  const colorMoodOptions = useMemo(
    () => ensureCurrentOption(colorMoods, workflowState.colorMood),
    [colorMoods, workflowState.colorMood],
  );

  const selectedReferenceAssets = useMemo(() => {
    return workflowState.referenceAssetIds
      .map((assetId) => referenceAssetCatalog[assetId] || referenceAssets.find((asset) => asset.id === assetId) || null)
      .filter((asset): asset is AssetReference => Boolean(asset));
  }, [referenceAssetCatalog, referenceAssets, workflowState.referenceAssetIds]);

  const reviewImages = useMemo(
    () => workflowState.generatedImages.filter((image) => image.reviewStatus !== "deleted"),
    [workflowState.generatedImages],
  );
  const pendingReviewImages = useMemo(
    () =>
      reviewImages.filter(
        (image) => image.reviewStatus === "pending" || image.reviewStatus === "refine",
      ),
    [reviewImages],
  );
  const archivedReviewImages = useMemo(
    () => reviewImages.filter((image) => image.reviewStatus === "archived"),
    [reviewImages],
  );
  const refineReviewImages = useMemo(
    () => reviewImages.filter((image) => image.reviewStatus === "refine"),
    [reviewImages],
  );
  const reviewCanComplete = archivedReviewImages.length > 0 && pendingReviewImages.length === 0;
  const reviewCompleted = workflowState.workflowCompleted || reviewCanComplete;

  function markVisited(step: number) {
    setWorkflowState((current) => ({
      ...current,
      maxVisitedStep: Math.max(current.maxVisitedStep, step),
    }));
  }

  async function createTaskIfNeeded() {
    if (workflowState.taskId) {
      return workflowState.taskId;
    }
    setCreatingTask(true);
    try {
      const res = await apiPost<TaskCreateResponse>("/api/tasks/create", {
        title: `日常互动图-${workflowState.todayTheme}`,
        scene: "daily_post",
      });
      if (res.code !== 0 || !res.data?.id) {
        throw new Error(res.msg || t("任务单创建失败"));
      }
      const taskId = res.data.id;
      updateWorkflowState({ taskId });
      return taskId;
    } finally {
      setCreatingTask(false);
    }
  }

  async function createJobIfNeeded(): Promise<{ jobId: number; taskId?: number }> {
    if (workflowState.jobId) {
      return { jobId: workflowState.jobId, taskId: workflowState.taskId ?? undefined };
    }
    if (!workflowState.selectedTemplateId || !workflowState.selectedTemplate) {
      throw new Error(t("请先选择模板"));
    }
    const taskId = await createTaskIfNeeded();
    setCreatingJob(true);
    try {
      const res = await apiPost<DailyPostJobResponse>("/api/daily-post/jobs/create", {
        template_id: workflowState.selectedTemplateId,
        task_id: taskId,
        today_theme: workflowState.todayTheme,
        user_emotion: workflowState.userEmotion,
        main_copy: workflowState.mainCopy,
        interaction_question: workflowState.interactionQuestion,
        image_language: workflowState.imageLanguage,
        option_a_override: workflowState.optionA || undefined,
        option_b_override: workflowState.optionB || undefined,
        option_c_override: workflowState.optionC || undefined,
        aux_copy: workflowState.auxCopy || undefined,
        bull_action_override: workflowState.bullAction || undefined,
        background_override: workflowState.background || undefined,
        reference_asset_ids: workflowState.referenceAssetIds,
      });
      if (res.code !== 0 || !res.data?.id) {
        throw new Error(res.msg || t("Job 创建失败"));
      }
      updateWorkflowState({
        jobId: res.data.id,
        taskId,
      });
      return { jobId: res.data.id, taskId };
    } finally {
      setCreatingJob(false);
    }
  }

  async function refreshBullActions(selectedValue?: string) {
    const res = await apiGet<DailyPostOption[]>("/api/daily-post/options/bull-actions");
    if (res.code !== 0) {
      throw new Error(res.msg || t("牛动作选项加载失败"));
    }
    const items = Array.isArray(res.data) ? res.data : [];
    setBullActions(items);
    if (selectedValue) {
      updateWorkflowState({ bullAction: selectedValue });
    }
  }

  async function refreshBackgrounds(selectedValue?: string) {
    const res = await apiGet<DailyPostOption[]>("/api/daily-post/options/backgrounds");
    if (res.code !== 0) {
      throw new Error(res.msg || t("背景选项加载失败"));
    }
    const items = Array.isArray(res.data) ? res.data : [];
    setBackgrounds(items);
    if (selectedValue) {
      updateWorkflowState({ background: selectedValue });
    }
  }

  async function refreshColorMoods(selectedValue?: string) {
    const res = await apiGet<DailyPostOption[]>("/api/daily-post/options/color-moods");
    if (res.code !== 0) {
      throw new Error(res.msg || t("颜色选项加载失败"));
    }
    const items = Array.isArray(res.data) ? res.data : [];
    setColorMoods(items);
    if (selectedValue) {
      updateWorkflowState({ colorMood: selectedValue });
    }
  }

  async function createBullActionOption() {
    if (!bullActionCustomValue.trim() || !bullActionCustomLabel.trim()) {
      throw new Error(t("请填写牛动作 value 和中文名称"));
    }
    setCreatingBullAction(true);
    try {
      const res = await apiPost<DailyPostOption>("/api/daily-post/options/bull-actions", {
        value: bullActionCustomValue.trim(),
        label_zh: bullActionCustomLabel.trim(),
      });
      if (res.code !== 0 || !res.data?.value) {
        throw new Error(res.msg || t("牛动作创建失败"));
      }
      await refreshBullActions(res.data.value);
      setBullActionCustomOpen(false);
      setBullActionCustomValue("");
      setBullActionCustomLabel("");
    } finally {
      setCreatingBullAction(false);
    }
  }

  async function createBackgroundOption() {
    if (!backgroundCustomValue.trim() || !backgroundCustomLabel.trim()) {
      throw new Error(t("请填写背景 value 和中文名称"));
    }
    setCreatingBackground(true);
    try {
      const res = await apiPost<DailyPostOption>("/api/daily-post/options/backgrounds", {
        value: backgroundCustomValue.trim(),
        label_zh: backgroundCustomLabel.trim(),
      });
      if (res.code !== 0 || !res.data?.value) {
        throw new Error(res.msg || t("背景创建失败"));
      }
      await refreshBackgrounds(res.data.value);
      setBackgroundCustomOpen(false);
      setBackgroundCustomValue("");
      setBackgroundCustomLabel("");
    } finally {
      setCreatingBackground(false);
    }
  }

  async function createColorMoodOption() {
    if (!colorMoodCustomValue.trim() || !colorMoodCustomLabel.trim()) {
      throw new Error(t("请填写颜色 value 和中文名称"));
    }
    setCreatingColorMood(true);
    try {
      const res = await apiPost<DailyPostOption>("/api/daily-post/options/color-moods", {
        value: colorMoodCustomValue.trim(),
        label_zh: colorMoodCustomLabel.trim(),
      });
      if (res.code !== 0 || !res.data?.value) {
        throw new Error(res.msg || t("颜色创建失败"));
      }
      await refreshColorMoods(res.data.value);
      setColorMoodCustomOpen(false);
      setColorMoodCustomValue("");
      setColorMoodCustomLabel("");
    } finally {
      setCreatingColorMood(false);
    }
  }

  function finalizeReviewState(nextImages: GeneratedImage[], step = 6) {
    const activeImages = nextImages.filter((image) => image.reviewStatus !== "deleted");
    const pendingImages = activeImages.filter(
      (image) => image.reviewStatus === "pending" || image.reviewStatus === "refine",
    );
    const archivedImages = activeImages.filter((image) => image.reviewStatus === "archived");
    const canComplete = archivedImages.length > 0 && pendingImages.length === 0;
    const nextState = {
      ...workflowState,
      generatedImages: nextImages,
      workflowCompleted: canComplete,
    };
    setWorkflowState(nextState);
    if (currentStep !== step) {
      setCurrentStep(step);
    }
    void autoSave(step, nextState, canComplete ? "completed" : "draft");
    return { nextState, canComplete };
  }

  function updateImageReviewStatus(imageId: number, reviewStatus: ReviewStatus, step = 6) {
    const nextImages = workflowState.generatedImages.map((image) =>
      image.id === imageId ? { ...image, reviewStatus } : image,
    );
    return finalizeReviewState(nextImages, step);
  }

  async function handleSaveDraft() {
    setSavingDraft(true);
    setError("");
    try {
      const payload = {
        session_id: workflowState.sessionId ?? undefined,
        workflow_type: "daily_post",
        mode: "full",
        status: "draft",
        state_json: JSON.stringify(workflowState),
        current_step: currentStep,
        task_id: workflowState.taskId ?? undefined,
      };
      const res = await apiPost<WorkflowSessionResponse>("/api/workflow-sessions/save", payload);
      if (res.code !== 0 || !res.data?.session_id) {
        throw new Error(res.msg || t("保存草稿失败"));
      }
      if (res.data.session_id !== workflowState.sessionId) {
        setWorkflowState((current) => ({ ...current, sessionId: res.data.session_id }));
      }
      setMessage(t("草稿已保存"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("保存草稿失败"));
    } finally {
      setSavingDraft(false);
    }
  }

  function resetWorkflow() {
    setCurrentStep(1);
    setWorkflowState(DEFAULT_STATE);
    setActiveTemplateType(templateTypes[0]?.value || DEFAULT_STATE.selectedTemplateType);
    setTemplates([]);
    setBullActionCustomOpen(false);
    setBackgroundCustomOpen(false);
    setColorMoodCustomOpen(false);
    setBullActionCustomValue("");
    setBullActionCustomLabel("");
    setBackgroundCustomValue("");
    setBackgroundCustomLabel("");
    setColorMoodCustomValue("");
    setColorMoodCustomLabel("");
    setSelectedReferenceTag("");
    setGenerationProgress({ current: 0, total: 0 });
    setError("");
    setMessage("");
  }

  async function handleNext() {
    setError("");
    try {
      if (currentStep === 1) {
        const taskId = await createTaskIfNeeded();
        const nextState = buildNextWorkflowState(workflowState, { taskId });
        setCurrentStepAndSave(2, nextState);
        markVisited(2);
        return;
      }
      if (currentStep === 2) {
        if (!workflowState.selectedTemplateId) {
          throw new Error(t("请先选择模板"));
        }
        setCurrentStepAndSave(3, workflowState);
        markVisited(3);
        return;
      }
      if (currentStep === 3) {
        setCurrentStepAndSave(4, workflowState);
        markVisited(4);
        return;
      }
      if (currentStep === 4) {
        const { jobId, taskId } = await createJobIfNeeded();
        const nextState = buildNextWorkflowState(workflowState, {
          jobId,
          taskId: taskId ?? workflowState.taskId ?? null,
        });
        setCurrentStepAndSave(5, nextState);
        markVisited(5);
        return;
      }
      if (currentStep === 5) {
        if (workflowState.generatedImages.length === 0) {
          throw new Error(t("请先生成图片"));
        }
        setCurrentStepAndSave(6, workflowState);
        markVisited(6);
        return;
      }
      if (currentStep === 6) {
        if (!reviewCanComplete) {
          const refineCount = refineReviewImages.length;
          if (refineCount > 0) {
            throw new Error(`${t("有")} ${refineCount} ${t("张图待精修，请回 Step 5 处理")}`);
          }
          throw new Error(t("请先处理待审核图片"));
        }
        const completedState = buildNextWorkflowState(workflowState, { workflowCompleted: true });
        setWorkflowState(completedState);
        void autoSave(6, completedState, "completed");
        setMessage(t("所有图片已处理，本次任务完成"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("操作失败"));
    }
  }

  async function handleGenerate() {
    setError("");
    setMessage("");
    try {
      const { jobId, taskId } = await createJobIfNeeded();
      const modelConfigId = workflowState.modelConfigId || availableModels[0]?.id || null;
      if (!modelConfigId) {
        throw new Error(t("无可用模型"));
      }
      const generateCount = Math.min(Math.max(Number(workflowState.generateCount || 1), 1), 4);
      const referenceAssetIds = [...workflowState.referenceAssetIds];
      const extraPrompt = workflowState.globalExtraPrompt;
      const initialState = buildNextWorkflowState(workflowState, {
        modelConfigId,
        taskId: taskId ?? workflowState.taskId ?? null,
        generatedImages: [],
        workflowCompleted: false,
        qc: { bullOk: false, copyClear: false, compositionFit: false },
      });
      setWorkflowState(initialState);
      void autoSave(5, initialState);
      setGenerating(true);
      setGenerationProgress({ current: 0, total: generateCount });
      let workingState = initialState;
      for (let index = 0; index < generateCount; index += 1) {
        setGenerationProgress({ current: index + 1, total: generateCount });
        const res = await apiPost<{
          job: DailyPostJobResponse;
          generation: { images: Array<{ image_id?: number; url?: string }> };
        }>(
          `/api/daily-post/jobs/${jobId}/generate`,
          {
            model_config_id: modelConfigId,
            reference_asset_ids: referenceAssetIds,
            extra_prompt: extraPrompt,
            size: workflowState.adSize,
          },
          120000,
        );
        if (res.code !== 0 || !res.data?.job) {
          throw new Error(res.msg || t("生成失败"));
        }
        const imageUrl =
          res.data.job.generated_image_url ||
          res.data.generation?.images?.find((item) => item?.url)?.url ||
          "";
        if (!imageUrl) {
          throw new Error(t("未收到生成图片"));
        }
        const nextImage = appendGeneratedImage(imageUrl);
        workingState = buildNextWorkflowState(workingState, {
          generatedImages: [...workingState.generatedImages, nextImage],
        });
        setWorkflowState(workingState);
        void autoSave(5, workingState);
      }
      setMessage(t("图片生成完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("生成失败"));
    } finally {
      setGenerating(false);
      setGenerationProgress({ current: 0, total: 0 });
    }
  }

  async function handleRefineImage(imageId: number) {
    setError("");
    setMessage("");
    const targetImage = workflowState.generatedImages.find((image) => image.id === imageId);
    if (!targetImage) {
      return;
    }
    const modelConfigId = workflowState.modelConfigId || availableModels[0]?.id || null;
    if (!modelConfigId) {
      setError(t("无可用模型"));
      return;
    }

    const refiningState = buildNextWorkflowState(workflowState, {
      generatedImages: workflowState.generatedImages.map((image) =>
        image.id === imageId ? { ...image, refining: true } : image,
      ),
    });
    setWorkflowState(refiningState);

    try {
      const { jobId } = await createJobIfNeeded();
      const res = await apiPost<{
        job: DailyPostJobResponse;
        generation: { images: Array<{ image_id?: number; url?: string }> };
      }>(
        `/api/daily-post/jobs/${jobId}/generate`,
        {
          model_config_id: modelConfigId,
          reference_asset_ids: workflowState.referenceAssetIds,
          extra_prompt: targetImage.refinePrompt,
          size: workflowState.adSize,
        },
        120000,
      );
      if (res.code !== 0 || !res.data?.job) {
        throw new Error(res.msg || t("精修失败"));
      }
      const imageUrl =
        res.data.job.generated_image_url ||
        res.data.generation?.images?.find((item) => item?.url)?.url ||
        "";
      if (!imageUrl) {
        throw new Error(t("未收到精修图片"));
      }
      const nextState = buildNextWorkflowState(refiningState, {
        generatedImages: refiningState.generatedImages.map((image) =>
          image.id === imageId
            ? { ...image, url: imageUrl, refining: false, reviewStatus: "pending" as ReviewStatus }
            : image,
        ),
      });
      setWorkflowState(nextState);
      void autoSave(5, nextState);
      setMessage(t("精修完成"));
    } catch (err) {
      const nextState = buildNextWorkflowState(refiningState, {
        generatedImages: refiningState.generatedImages.map((image) =>
          image.id === imageId ? { ...image, refining: false } : image,
        ),
      });
      setWorkflowState(nextState);
      setError(err instanceof Error ? err.message : t("精修失败"));
    }
  }

  function handleReturnToReview() {
    setError("");
    setMessage("");
    setCurrentStepAndSave(6, workflowState);
    markVisited(6);
  }

  async function handleArchiveImage(imageId: number) {
    setError("");
    setMessage("");
    const targetImage = workflowState.generatedImages.find((image) => image.id === imageId);
    if (!targetImage || !workflowState.jobId) {
      return;
    }
    try {
      const res = await apiPost(`/api/daily-post/jobs/${workflowState.jobId}/qc`, {
        status: "archived",
        image_url: targetImage.url,
      });
      if (res.code !== 0) {
        throw new Error(res.msg || t("归档失败"));
      }
      const { canComplete } = updateImageReviewStatus(imageId, "archived", 6);
      setMessage(canComplete ? t("所有图片已处理，本次任务完成") : t("图片已归档"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("归档失败"));
    }
  }

  function handleSendBackToRefine(imageId: number) {
    setError("");
    setMessage("");
    updateImageReviewStatus(imageId, "refine", 5);
    markVisited(5);
    setMessage(t("已发回精修"));
  }

  function handleDeleteImage(imageId: number) {
    setError("");
    setMessage("");
    const { canComplete } = updateImageReviewStatus(imageId, "deleted", 6);
    if (canComplete) {
      setMessage(t("所有图片已处理，本次任务完成"));
    }
  }

  function handleWithdrawImage(imageId: number) {
    setError("");
    setMessage("");
    updateImageReviewStatus(imageId, "pending", 6);
    setMessage(t("已撤回到待审核"));
  }

  async function handleStep4Advance() {
    setError("");
    try {
      const { jobId, taskId } = await createJobIfNeeded();
      const nextState = buildNextWorkflowState(workflowState, {
        jobId,
        taskId: taskId ?? workflowState.taskId ?? null,
      });
      setWorkflowState(nextState);
      setCurrentStepAndSave(5, nextState);
      markVisited(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("操作失败"));
    }
  }

  function handleTemplateSelect(template: DailyPostTemplate) {
    updateWorkflowState({
      selectedTemplateId: template.id,
      selectedTemplateType: template.template_type,
      selectedTemplate: template,
      mainCopy: template.title_copy || "",
      interactionQuestion: template.interaction_copy || "",
      optionA: template.option_a || "",
      optionB: template.option_b || "",
      optionC: template.option_c || "",
      bullAction: template.bull_action || workflowState.bullAction,
      background: template.background || workflowState.background,
      style: template.style || workflowState.style,
      colorMood: template.color_mood || workflowState.colorMood,
      workflowCompleted: false,
      qc: { bullOk: false, copyClear: false, compositionFit: false },
    });
    setActiveTemplateType(template.template_type);
  }

  function renderStep1() {
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader step={1} title={t("选择今日主题")} description={t("先定义今天要发的互动图场景，再进入模板选择。")} />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t("今日主题")}</span>
            <input
              value={workflowState.todayTheme}
              onChange={(event) => updateWorkflowState({ todayTheme: event.target.value })}
              className={ACTIVITY_INPUT_CLASS}
              placeholder={t("例如：雨天通勤、发薪日、周末躺平")}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">{t("用户情绪")}</span>
            <input
              value={workflowState.userEmotion}
              onChange={(event) => updateWorkflowState({ userEmotion: event.target.value })}
              className={ACTIVITY_INPUT_CLASS}
              placeholder={t("例如：疲惫、兴奋、无奈")}
            />
          </label>
        </div>
        <div className="mt-4">
          <p className="text-sm font-medium text-gray-700">{t("互动方式")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {INTERACTION_OPTIONS.map((item) => {
              const active = workflowState.interactionMode === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateWorkflowState({ interactionMode: item.value as WorkflowState["interactionMode"] })}
                  className={active ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS}
                >
                  {t(item.label)}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderStep2() {
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader step={2} title={t("选择模板")} description={t("按类型切换模板，选中的模板会进入后续内容填写与画面配置。")} />
        <div className="flex flex-wrap gap-2">
          {templateTypes.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setActiveTemplateType(item.value);
                updateWorkflowState({
                  selectedTemplateType: item.value,
                  selectedTemplateId: null,
                  selectedTemplate: null,
                  mainCopy: "",
                  interactionQuestion: "",
                  optionA: "",
                  optionB: "",
                  optionC: "",
                  workflowCompleted: false,
                  qc: { bullOk: false, copyClear: false, compositionFit: false },
                });
              }}
              className={getActivityTemplateTypeTabClasses(activeTemplateType === item.value)}
            >
              {t(item.label)}
            </button>
          ))}
        </div>
        <div className="mt-4">
          {loadingTemplates ? (
            <p className="text-sm text-gray-500">{t("模板加载中…")}</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-gray-500">{t("暂无模板")}</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {templates.map((template) => {
                const selected = workflowState.selectedTemplateId === template.id;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleTemplateSelect(template)}
                    className={getActivityTemplateCardClasses(selected)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-900">{template.name}</span>
                      {!template.is_enabled && <span className="text-xs text-gray-400">{t("已禁用")}</span>}
                    </div>
                    <p className="mt-2 text-left text-xs text-gray-500">{t(templateTypeLabel(template.template_type))}</p>
                    <div className="mt-3 space-y-1 text-left text-xs leading-5 text-gray-600">
                      {templatePreviewLines(template, t).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderStep3() {
    const showChoiceFields = workflowState.interactionMode === "choice";
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader
          step={3}
          title={t("填写内容")}
          description={
            workflowState.selectedTemplate
              ? `${t("当前模板：")}${workflowState.selectedTemplate.name}`
              : t("请先返回 Step 2 选择模板")
          }
        />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700">{t("主文案")}</span>
            <textarea
              rows={4}
              value={workflowState.mainCopy}
              onChange={(event) => updateWorkflowState({ mainCopy: event.target.value })}
              className={ACTIVITY_INPUT_CLASS}
              placeholder={t("主视觉里最重要的一句文案")}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700">{t("互动问题")}</span>
            <textarea
              rows={3}
              value={workflowState.interactionQuestion}
              onChange={(event) => updateWorkflowState({ interactionQuestion: event.target.value })}
              className={ACTIVITY_INPUT_CLASS}
              placeholder={t("引导用户参与互动的问题")}
            />
          </label>
          {showChoiceFields && (
            <>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">{t("选项 A")}</span>
                <input
                  value={workflowState.optionA}
                  onChange={(event) => updateWorkflowState({ optionA: event.target.value })}
                  className={ACTIVITY_INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">{t("选项 B")}</span>
                <input
                  value={workflowState.optionB}
                  onChange={(event) => updateWorkflowState({ optionB: event.target.value })}
                  className={ACTIVITY_INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">{t("选项 C")}</span>
                <input
                  value={workflowState.optionC}
                  onChange={(event) => updateWorkflowState({ optionC: event.target.value })}
                  className={ACTIVITY_INPUT_CLASS}
                />
              </label>
            </>
          )}
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700">{t("辅助引导文案（可选）")}</span>
            <textarea
              rows={3}
              value={workflowState.auxCopy}
              onChange={(event) => updateWorkflowState({ auxCopy: event.target.value })}
              className={ACTIVITY_INPUT_CLASS}
              placeholder={t("用于补充引导语或备注")}
            />
          </label>
          <div className="md:col-span-2">
            <p className="text-sm font-medium text-gray-700">{t("图片文字语言")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {IMAGE_LANGUAGE_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateWorkflowState({ imageLanguage: item.value })}
                  className={
                    workflowState.imageLanguage === item.value
                      ? ACTIVITY_PRIMARY_BUTTON_CLASS
                      : ACTIVITY_SECONDARY_BUTTON_CLASS
                  }
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderStep4() {
    const bullActionSelectValue = bullActionCustomOpen ? CUSTOM_OPTION_VALUE : workflowState.bullAction;
    const backgroundSelectValue = backgroundCustomOpen ? CUSTOM_OPTION_VALUE : workflowState.background;
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader
          step={4}
          title={t("配置画面")}
          description={t("先定牛动作、背景、风格和颜色，再创建 Job。")}
        />
        {loadingOptionCatalog && <p className="mb-3 text-sm text-gray-500">{t("配置项加载中…")}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <label className="block flex-1">
                <span className="text-sm font-medium text-gray-700">{t("牛动作")}</span>
                <select
                  value={bullActionSelectValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === CUSTOM_OPTION_VALUE) {
                      setBullActionCustomOpen(true);
                      return;
                    }
                    setBullActionCustomOpen(false);
                    setBullActionCustomValue("");
                    setBullActionCustomLabel("");
                    updateWorkflowState({ bullAction: nextValue });
                  }}
                  className={ACTIVITY_INPUT_CLASS}
                >
                  {bullActionSelectOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label_zh}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>{t("＋ 自定义")}</option>
                </select>
              </label>
            </div>
            {bullActionCustomOpen && (
              <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-white p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">value</span>
                    <input
                      value={bullActionCustomValue}
                      onChange={(event) => setBullActionCustomValue(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: sleepy")}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">label_zh</span>
                    <input
                      value={bullActionCustomLabel}
                      onChange={(event) => setBullActionCustomLabel(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: 困倦")}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await createBullActionOption();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : t("牛动作创建失败"));
                        }
                      })();
                    }}
                    disabled={creatingBullAction}
                    className={creatingBullAction ? ACTIVITY_SECONDARY_BUTTON_CLASS : ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {creatingBullAction ? t("创建中...") : t("确认添加")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBullActionCustomOpen(false);
                      setBullActionCustomValue("");
                      setBullActionCustomLabel("");
                    }}
                    className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                  >
                    {t("取消")}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <label className="block flex-1">
                <span className="text-sm font-medium text-gray-700">{t("背景")}</span>
                <select
                  value={backgroundSelectValue}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue === CUSTOM_OPTION_VALUE) {
                      setBackgroundCustomOpen(true);
                      return;
                    }
                    setBackgroundCustomOpen(false);
                    setBackgroundCustomValue("");
                    setBackgroundCustomLabel("");
                    updateWorkflowState({ background: nextValue });
                  }}
                  className={ACTIVITY_INPUT_CLASS}
                >
                  {backgroundSelectOptions.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label_zh}
                    </option>
                  ))}
                  <option value={CUSTOM_OPTION_VALUE}>{t("＋ 自定义")}</option>
                </select>
              </label>
            </div>
            {backgroundCustomOpen && (
              <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-white p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">value</span>
                    <input
                      value={backgroundCustomValue}
                      onChange={(event) => setBackgroundCustomValue(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: market")}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">label_zh</span>
                    <input
                      value={backgroundCustomLabel}
                      onChange={(event) => setBackgroundCustomLabel(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: 市集")}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await createBackgroundOption();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : t("背景创建失败"));
                        }
                      })();
                    }}
                    disabled={creatingBackground}
                    className={creatingBackground ? ACTIVITY_SECONDARY_BUTTON_CLASS : ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {creatingBackground ? t("创建中...") : t("确认添加")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBackgroundCustomOpen(false);
                      setBackgroundCustomValue("");
                      setBackgroundCustomLabel("");
                    }}
                    className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                  >
                    {t("取消")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium text-gray-700">{t("风格")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {STYLE_OPTIONS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => updateWorkflowState({ style: item.value })}
                  className={workflowState.style === item.value ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700">{t("颜色")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {colorMoodOptions.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    setColorMoodCustomOpen(false);
                    setColorMoodCustomValue("");
                    setColorMoodCustomLabel("");
                    updateWorkflowState({ colorMood: item.value });
                  }}
                  className={workflowState.colorMood === item.value ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS}
                >
                  {item.label_zh}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setColorMoodCustomOpen((current) => !current)}
                className={ACTIVITY_SECONDARY_BUTTON_CLASS}
              >
                {t("＋ 自定义")}
              </button>
            </div>
            {colorMoodCustomOpen && (
              <div className="mt-3 rounded-md border border-dashed border-gray-300 bg-white p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">value</span>
                    <input
                      value={colorMoodCustomValue}
                      onChange={(event) => setColorMoodCustomValue(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: cloudy")}
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">label_zh</span>
                    <input
                      value={colorMoodCustomLabel}
                      onChange={(event) => setColorMoodCustomLabel(event.target.value)}
                      className={ACTIVITY_INPUT_CLASS}
                      placeholder={t("例如: 阴天")}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void (async () => {
                        try {
                          await createColorMoodOption();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : t("颜色创建失败"));
                        }
                      })();
                    }}
                    disabled={creatingColorMood}
                    className={creatingColorMood ? ACTIVITY_SECONDARY_BUTTON_CLASS : ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {creatingColorMood ? t("创建中...") : t("确认添加")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setColorMoodCustomOpen(false);
                      setColorMoodCustomValue("");
                      setColorMoodCustomLabel("");
                    }}
                    className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                  >
                    {t("取消")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm font-medium text-gray-700">{t("图片尺寸")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AD_SIZE_OPTIONS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => updateWorkflowState({ adSize: item.value })}
                className={workflowState.adSize === item.value ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS}
              >
                  {t(item.label)}
              </button>
            ))}
          </div>
        </div>
        <section className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{t("角色参考图（可选）")}</h3>
            <p className="mt-1 text-sm text-gray-500">{t("选择牛标准参考图，提升角色一致性")}</p>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_260px]">
            <aside className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">{t("标签筛选")}</p>
                {loadingAssetTags && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
              </div>
              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedReferenceTag("")}
                  className={
                    !selectedReferenceTag ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS
                  }
                >
                  {t("全部")}
                </button>
                {assetTags.map((tag) => {
                  const active = selectedReferenceTag === tag.name;
                  return (
                    <button
                      key={tag.name}
                      type="button"
                      onClick={() => setSelectedReferenceTag(tag.name)}
                      className={active ? ACTIVITY_PRIMARY_BUTTON_CLASS : ACTIVITY_SECONDARY_BUTTON_CLASS}
                    >
                      {getTagLabel(tag, lang)}
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">{t("参考图列表")}</p>
                {loadingReferenceAssets && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {referenceAssets.length === 0 ? (
                  <div className="col-span-full rounded-md border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
                    {t("暂无参考图")}
                  </div>
                ) : (
                  referenceAssets.map((asset) => {
                    const selected = workflowState.referenceAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() =>
                          updateWorkflowState({
                            referenceAssetIds: selected
                              ? workflowState.referenceAssetIds.filter((id) => id !== asset.id)
                              : [...workflowState.referenceAssetIds, asset.id],
                          })
                        }
                        className={`overflow-hidden rounded-lg border bg-white text-left transition ${
                          selected ? "border-emerald-500 ring-2 ring-emerald-100" : "border-gray-200 hover:border-gray-300"
                        }`}
                      >
                        <div className="aspect-[4/5] w-full bg-gray-100">
                          {assetImageUrl(asset) ? (
                            <img
                              src={assetImageUrl(asset)}
                              alt={assetDisplayName(asset)}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-gray-400">
                              {t("无预览")}
                            </div>
                          )}
                        </div>
                        <div className="px-3 py-2">
                          <p className="truncate text-sm font-medium text-gray-900">{assetDisplayName(asset)}</p>
                          <p className="mt-1 text-xs text-gray-500">{selected ? t("已选中") : t("点击选择")}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <aside className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-gray-700">{t("已选参考图")}</p>
                <button
                  type="button"
                  onClick={() => void handleStep4Advance()}
                  disabled={creatingJob}
                  className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingJob ? t("创建中...") : t("下一步：配置画面→生成")}
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {selectedReferenceAssets.length === 0 ? (
                  <p className="text-sm text-gray-400">{t("尚未选择")}</p>
                ) : (
                  selectedReferenceAssets.map((asset) => (
                    <div key={asset.id} className="flex items-start gap-3 rounded-md border border-gray-200 p-2">
                      {assetImageUrl(asset) ? (
                        <img
                          src={assetImageUrl(asset)}
                          alt={assetDisplayName(asset)}
                          className="h-14 w-14 rounded-md border border-gray-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-md border border-gray-200 bg-gray-100 text-[10px] text-gray-400">
                          {t("无预览")}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{assetDisplayName(asset)}</p>
                        <button
                          type="button"
                          onClick={() =>
                            updateWorkflowState({
                              referenceAssetIds: workflowState.referenceAssetIds.filter((id) => id !== asset.id),
                            })
                          }
                          className="mt-2 text-xs font-medium text-red-600 hover:text-red-700"
                        >
                          {t("× 移除")}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </section>
      </section>
    );
  }

  function renderStep5() {
    const generateButtonLabel = generating
      ? `${t("生成中")} ${generationProgress.current}/${generationProgress.total}...`
      : workflowState.generatedImages.length > 0
        ? t("重新生成")
        : t("开始生成");
    const canGenerate = !generating && !loadingModels && (workflowState.modelConfigId !== null || availableModels.length > 0);
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader step={5} title={t("生成图片")} description={t("选择模型并发起生成，支持重复生成。")} />
        <div className="mb-3 flex justify-end">
          <button type="button" onClick={handleReturnToReview} className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
            {t("返回审核")}
          </button>
        </div>
        {refineReviewImages.length > 0 && (
          <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {t("有")} {refineReviewImages.length} {t("张图待精修，请先处理这些图片。")}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xs uppercase text-gray-400">{t("今日主题")}</p>
                <p className="mt-2 text-sm text-gray-700">{workflowState.todayTheme || "-"}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xs uppercase text-gray-400">{t("模板")}</p>
                <p className="mt-2 text-sm text-gray-700">{workflowState.selectedTemplate?.name || "-"}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xs uppercase text-gray-400">{t("尺寸")}</p>
                <p className="mt-2 text-sm text-gray-700">{workflowState.adSize || "-"}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-3">
                <p className="text-xs uppercase text-gray-400">Job</p>
                <p className="mt-2 text-sm text-gray-700">{workflowState.jobId ? `#${workflowState.jobId}` : "-"}</p>
              </div>
            </div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <ModelSelector
                models={availableModels}
                value={workflowState.modelConfigId}
                onChange={(id) => updateWorkflowState({ modelConfigId: id })}
                loading={loadingModels}
                label={t("出图模型")}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
                <p className="text-sm font-medium text-gray-700">{t("出图数量")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => updateWorkflowState({ generateCount: count })}
                      className={
                        workflowState.generateCount === count
                          ? ACTIVITY_PRIMARY_BUTTON_CLASS
                          : ACTIVITY_SECONDARY_BUTTON_CLASS
                      }
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block rounded-md border border-gray-200 bg-gray-50 p-4">
                <span className="text-sm font-medium text-gray-700">{t("补充提示语")}</span>
                <textarea
                  rows={4}
                  value={workflowState.globalExtraPrompt}
                  onChange={(event) => updateWorkflowState({ globalExtraPrompt: event.target.value })}
                  className={`${ACTIVITY_INPUT_CLASS} mt-3`}
                  placeholder={t("可选，补充画面描述…")}
                />
              </label>
            </div>
            <GenerateButton
              onClick={handleGenerate}
              loading={generating}
              disabled={!canGenerate}
              label={generateButtonLabel}
              className="w-full"
            />
            <p className="text-sm text-gray-500">{t("生成成功后可进入 Step 6 审核归档。")}</p>
          </div>
          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-700">{t("生成结果")}</p>
              {reviewImages.length > 0 && (
                <span className="text-xs text-gray-400">{reviewImages.length} {t("张")}</span>
              )}
            </div>
            {reviewImages.length === 0 ? (
              <p className="text-sm text-gray-400">{t("暂无生成图片")}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {reviewImages.map((image) => {
                  const isRefineTarget = image.reviewStatus === "refine";
                  return (
                    <div
                      key={image.id}
                      className={`overflow-hidden rounded-lg border bg-white ${
                        isRefineTarget ? "border-yellow-400 ring-2 ring-yellow-100" : "border-gray-200"
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={absoluteUrl(image.url)}
                          alt={`daily-post-${image.id}`}
                          onClick={() => setPreviewImageUrl(absoluteUrl(image.url))}
                          className="aspect-square w-full cursor-pointer bg-gray-100 object-cover"
                        />
                        {isRefineTarget && (
                          <span className="absolute left-3 top-3 rounded-full bg-yellow-400 px-2 py-1 text-[11px] font-semibold text-yellow-950">
                            {t("待精修")}
                          </span>
                        )}
                      </div>
                      <div className="space-y-3 p-3">
                        <label className="block">
                          <span className="text-xs font-medium text-gray-700">{t("精修提示语")}</span>
                          <textarea
                            rows={3}
                            value={image.refinePrompt}
                            onChange={(event) =>
                              setWorkflowState((current) => ({
                                ...current,
                                generatedImages: current.generatedImages.map((item) =>
                                  item.id === image.id ? { ...item, refinePrompt: event.target.value } : item,
                                ),
                              }))
                            }
                            className={ACTIVITY_INPUT_CLASS}
                            placeholder={t("输入精修要求…")}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleRefineImage(image.id)}
                          disabled={image.refining}
                          className={image.refining ? ACTIVITY_SECONDARY_BUTTON_CLASS : ACTIVITY_PRIMARY_BUTTON_CLASS}
                        >
                          {image.refining ? t("精修中...") : t("精修")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderStep6() {
    if (reviewCompleted) {
      return (
        <section className={ACTIVITY_SECTION_CARD_CLASS}>
          <WorkflowStepHeader step={6} title={t("审核归档")} description={t("所有图片已处理，本次任务完成。")} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-700">{t("已归档图片")}</p>
                <span className="text-xs text-gray-400">{archivedReviewImages.length} {t("张")}</span>
              </div>
              {archivedReviewImages.length === 0 ? (
                <p className="text-sm text-gray-400">{t("暂无已归档图片")}</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {archivedReviewImages.map((image) => (
                    <img
                      key={image.id}
                      src={absoluteUrl(image.url)}
                      alt={`daily-post-${image.id}`}
                      className="aspect-square w-full rounded-lg border border-emerald-200 bg-gray-100 object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-sm font-medium text-emerald-800">{t("所有图片已处理，本次任务完成")}</p>
              <p className="mt-2 text-sm text-emerald-700">{t("你可以前往成品图库查看结果，或直接开始下一轮生产。")}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/gallery"
                  className="rounded-md border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  {t("查看成品图库")}
                </Link>
                <button type="button" onClick={resetWorkflow} className={ACTIVITY_PRIMARY_BUTTON_CLASS}>
                  {t("继续生产")}
                </button>
              </div>
            </div>
          </div>
        </section>
      );
    }
    return (
      <section className={ACTIVITY_SECTION_CARD_CLASS}>
        <WorkflowStepHeader step={6} title={t("审核归档")} description={t("每张图独立归档、发回精修或删除。")} />
        {refineReviewImages.length > 0 && (
          <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {t("有")} {refineReviewImages.length} {t("张图待精修，请回 Step 5 处理。")}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-700">{t("待审核")}</p>
              <span className="text-xs text-gray-400">{pendingReviewImages.length} {t("张")}</span>
            </div>
            {pendingReviewImages.length === 0 ? (
              <p className="text-sm text-gray-400">{t("暂无待审核图片")}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pendingReviewImages.map((image) => {
                  const isRefineTarget = image.reviewStatus === "refine";
                  return (
                    <div
                      key={image.id}
                      className={`overflow-hidden rounded-lg border bg-white ${
                        isRefineTarget ? "border-yellow-400 ring-2 ring-yellow-100" : "border-gray-200"
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={absoluteUrl(image.url)}
                          alt={`daily-post-${image.id}`}
                          className="aspect-square w-full cursor-pointer bg-gray-100 object-cover"
                          onClick={() => setPreviewImageUrl(absoluteUrl(image.url))}
                        />
                        {isRefineTarget && (
                          <span className="absolute left-3 top-3 rounded-full bg-yellow-400 px-2 py-1 text-[11px] font-semibold text-yellow-950">
                            {t("待精修")}
                          </span>
                        )}
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void handleArchiveImage(image.id)}
                            className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                          >
                            {t("归档")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSendBackToRefine(image.id)}
                            className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                          >
                            {t("发回精修")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteImage(image.id)}
                            className={ACTIVITY_SECONDARY_BUTTON_CLASS}
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
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-700">{t("已归档")}</p>
              <span className="text-xs text-gray-400">{archivedReviewImages.length} {t("张")}</span>
            </div>
            {archivedReviewImages.length === 0 ? (
              <p className="text-sm text-gray-400">{t("暂无已归档图片")}</p>
            ) : (
              <div className="space-y-3">
                {archivedReviewImages.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50">
                    <div className="relative">
                      <img
                        src={absoluteUrl(image.url)}
                        alt={`daily-post-${image.id}`}
                        className="aspect-square w-full cursor-pointer bg-gray-100 object-cover"
                        onClick={() => setPreviewImageUrl(absoluteUrl(image.url))}
                      />
                      <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-2 py-1 text-[11px] font-semibold text-white">
                        已归档
                      </span>
                    </div>
                    <div className="p-3">
                      <button
                        type="button"
                        onClick={() => handleWithdrawImage(image.id)}
                        className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                      >
                        {t("撤回")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderCurrentStep() {
    if (currentStep === 1) return renderStep1();
    if (currentStep === 2) return renderStep2();
    if (currentStep === 3) return renderStep3();
    if (currentStep === 4) return renderStep4();
    if (currentStep === 5) return renderStep5();
    return renderStep6();
  }

  const nextDisabled =
    (currentStep === 1 && (!workflowState.todayTheme || !workflowState.userEmotion || creatingTask)) ||
    (currentStep === 2 && !workflowState.selectedTemplateId) ||
    (currentStep === 4 && creatingJob) ||
    (currentStep === 5 && (workflowState.generatedImages.length === 0 || generating)) ||
    (currentStep === 6 && (workflowState.workflowCompleted || !reviewCanComplete || submittingQc));

  const nextLabel =
    currentStep === 1
      ? creatingTask
        ? t("创建中...")
        : t("创建任务单")
      : currentStep === 4
        ? creatingJob
          ? t("创建中...")
          : t("创建 Job")
        : currentStep === 5
          ? t("进入审核")
          : currentStep === 6 && workflowState.workflowCompleted
            ? t("已完成")
            : currentStep === 6
            ? reviewCanComplete
              ? t("完成任务")
              : refineReviewImages.length > 0
                ? `${t("待精修")} ${refineReviewImages.length}`
                : t("待处理")
            : t("下一步");

  return (
    <div className={ACTIVITY_PAGE_SHELL_CLASS}>
      <div className={ACTIVITY_PAGE_INNER_CLASS}>
        <PageHeader
          title={t("日常互动图工作流")}
          description={t("6 步向导式日常互动图生产工作流")}
          action={
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={savingDraft || restoringSession}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {restoringSession ? t("恢复中...") : savingDraft ? t("保存中...") : t("保存草稿")}
            </button>
          }
        />

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-700">
              {t("Step")} {currentStep}/6：{t(STEP_TITLES[currentStep - 1])}
            </span>
            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              {workflowState.taskId && <span>{t("任务")} #{workflowState.taskId}</span>}
              {workflowState.jobId && <span>Job #{workflowState.jobId}</span>}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}
        {restoringSession ? (
          <div className={ACTIVITY_PANEL_CLASS}>
            <p className="text-sm text-gray-500">{t("草稿恢复中...")}</p>
          </div>
        ) : (
          <StepLayout
            currentStep={currentStep}
            steps={workflowSteps}
            nextLabel={nextLabel}
            nextDisabled={nextDisabled}
            onBack={currentStep > 1 ? () => setCurrentStepAndSave(Math.max(1, currentStep - 1), workflowState) : undefined}
            onNext={currentStep === 4 ? undefined : handleNext}
            onStepSelect={(step) => {
              if (step <= workflowState.maxVisitedStep) {
                setCurrentStepAndSave(step, workflowState);
              }
            }}
            canVisitStep={(step) => step <= workflowState.maxVisitedStep}
          >
            {renderCurrentStep()}
          </StepLayout>
        )}
        {previewImageUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreviewImageUrl(null)}
          >
            <div className="max-h-[90vh] max-w-[90vw]" onClick={(event) => event.stopPropagation()}>
              <img
                src={previewImageUrl}
                alt="preview"
                className="max-h-[90vh] max-w-[90vw] object-contain"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
