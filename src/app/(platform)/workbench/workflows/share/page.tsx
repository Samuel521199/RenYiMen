// @ts-nocheck
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiGet, apiPost } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { ASSET_CATEGORIES } from "@workbench/lib/constants";
import { isImageGenerationModel } from "@workbench/lib/expression-workflow";
import { getTagLabel } from "@workbench/lib/tag-display";

type GeneratedImage = {
  id: string;
  jobId: number;
  url: string;
  reviewStatus: "pending" | "archived" | "refine" | "deleted";
  refinePrompt: string;
};

type ShareWorkflowState = {
  sessionId: number | null;
  shareType: "benefit" | "emotion" | "identity" | "information" | null;
  coreText: string;
  targetAudience: string;
  gameType: string;
  imageLanguage: "english" | "taglish" | "chinese";
  adSize: "1080x1080" | "1080x1920" | "1080x566";
  generateCount: number;
  referenceAssetIds: number[];
  selectedModel: number | null;
  selectedGameInstructions: number[];
  generatedImages: GeneratedImage[];
  currentStep: number;
};

type AssetTag = {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
  group?: string | null;
};

type AssetReference = {
  id: number;
  url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  name?: string | null;
  filename?: string | null;
  tags?: string[] | string | null;
};

type AvailableModel = {
  id: number;
  name: string;
  provider: string;
  model_name?: string | null;
  usage_type?: string | null;
  price_per_image?: number | string | null;
};

type ShareGameInstruction = {
  id: number;
  game_type: string;
  label: string;
  content: string;
  sort_order: number;
  enabled: boolean;
  created_at: string;
};

type WorkflowSessionSaveResponse = {
  session_id?: number | null;
};

type ShareJobApiResponse = {
  id?: number;
  session_id?: number | null;
  generated_image_url?: string | null;
};

type ShareGenerateApiResponse = {
  job?: ShareJobApiResponse | null;
  generation?: {
    images?: Array<{ url?: string | null }>;
  } | null;
};

const STEP_DEFINITIONS = [
  { id: 1, title: "选择转发类型" },
  { id: 2, title: "输入传播内容" },
  { id: 3, title: "图片语言" },
  { id: 4, title: "参考图选择" },
  { id: 5, title: "生成配置" },
  { id: 6, title: "生成图片 + 审核 QC" },
] as const;

const SHARE_TYPE_OPTIONS = [
  {
    value: "benefit",
    title: "利益驱动",
    subtitle: "Benefit",
    description: "活动传播 / 拉人 / 奖励裂变",
  },
  {
    value: "emotion",
    title: "情绪驱动",
    subtitle: "Emotion",
    description: "输赢情绪 / 吐槽 / 上头瞬间",
  },
  {
    value: "identity",
    title: "身份驱动",
    subtitle: "Identity",
    description: "玩家分层 / 社交标签 / 群传播",
  },
  {
    value: "information",
    title: "信息驱动",
    subtitle: "Information",
    description: "攻略 / 技巧 / 教学传播",
  },
] as const;

const LANGUAGE_OPTIONS = [
  {
    value: "english",
    title: "English",
    description: "纯英文",
  },
  {
    value: "taglish",
    title: "Taglish",
    description: "他加禄语+英语混用",
  },
  {
    value: "chinese",
    title: "中文",
    description: "简体中文",
  },
] as const;

const AD_SIZE_OPTIONS = [
  { value: "1080x1080", label: "FB 方图 1080×1080" },
  { value: "1080x1920", label: "TikTok 竖版 1080×1920" },
  { value: "1080x566", label: "FB 横版 1080×566" },
] as const;

const GENERATE_COUNT_OPTIONS = [1, 2, 3, 4] as const;

const API_BASE = "/api/workbench";
const SHARE_REF_EXCLUDED = ["background", "props"];
const DEFAULT_WORKFLOW_STATE: ShareWorkflowState = {
  sessionId: null,
  shareType: null,
  coreText: "",
  targetAudience: "",
  gameType: "Tongits",
  imageLanguage: "english",
  adSize: "1080x1080",
  generateCount: 2,
  referenceAssetIds: [],
  selectedModel: null,
  selectedGameInstructions: [],
  generatedImages: [],
  currentStep: 1,
};

function clampStep(step: number) {
  return Math.min(6, Math.max(1, step));
}

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

function assetDisplayName(asset: AssetReference) {
  return asset.name || asset.filename || `#${asset.id}`;
}

function assetHasTag(asset: AssetReference, tagName: string) {
  if (!tagName) return true;
  if (Array.isArray(asset.tags)) {
    return asset.tags.includes(tagName);
  }
  if (typeof asset.tags === "string") {
    return asset.tags.split(",").map((tag) => tag.trim()).includes(tagName);
  }
  return false;
}

export default function ShareWorkflowPage() {
  const { t, lang } = useLanguage();
  const [workflowState, setWorkflowState] = useState<ShareWorkflowState>(DEFAULT_WORKFLOW_STATE);
  const [assetTags, setAssetTags] = useState<AssetTag[]>([]);
  const [referenceAssets, setReferenceAssets] = useState<AssetReference[]>([]);
  const [selectedReferenceTag, setSelectedReferenceTag] = useState("");
  const [refCategories, setRefCategories] = useState<string[]>([]);
  const [selectedRefCategory, setSelectedRefCategory] = useState<string>("");
  const [loadingAssetTags, setLoadingAssetTags] = useState(false);
  const [loadingReferenceAssets, setLoadingReferenceAssets] = useState(false);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [gameTypes, setGameTypes] = useState<string[]>([]);
  const [gameInstructions, setGameInstructions] = useState<ShareGameInstruction[]>([]);
  const [loadingGameInstructions, setLoadingGameInstructions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [refiningImageIds, setRefiningImageIds] = useState<string[]>([]);
  const [processingJobIds, setProcessingJobIds] = useState<number[]>([]);
  const workflowStateRef = useRef<ShareWorkflowState>(DEFAULT_WORKFLOW_STATE);
  const completedSaveTriggeredRef = useRef(false);

  const currentStepMeta = useMemo(
    () => STEP_DEFINITIONS.find((step) => step.id === workflowState.currentStep) ?? STEP_DEFINITIONS[0],
    [workflowState.currentStep],
  );
  const filteredReferenceAssets = useMemo(() => {
    if (!selectedReferenceTag) {
      return referenceAssets;
    }
    return referenceAssets.filter((asset) => assetHasTag(asset, selectedReferenceTag));
  }, [referenceAssets, selectedReferenceTag]);
  const selectedReferenceAssets = useMemo(() => {
    return workflowState.referenceAssetIds
      .map((assetId) => referenceAssets.find((asset) => asset.id === assetId) || null)
      .filter((asset): asset is AssetReference => Boolean(asset));
  }, [referenceAssets, workflowState.referenceAssetIds]);
  const refCategoryLabelMap = useMemo(
    () =>
      Object.fromEntries(
        ASSET_CATEGORIES.map((item) => [item.value, item.label]),
      ) as Record<string, string>,
    [],
  );
  const reviewImages = useMemo(
    () => workflowState.generatedImages.filter((image) => image.reviewStatus !== "deleted"),
    [workflowState.generatedImages],
  );
  const pendingReviewImages = useMemo(
    () => reviewImages.filter((image) => image.reviewStatus === "pending" || image.reviewStatus === "refine"),
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
  const selectedGameInstructionContents = useMemo(() => {
    const selectedIds = new Set(workflowState.selectedGameInstructions);
    return gameInstructions
      .filter((instruction) => selectedIds.has(instruction.id))
      .map((instruction) => instruction.content.trim())
      .filter(Boolean)
      .join("\n");
  }, [gameInstructions, workflowState.selectedGameInstructions]);
  const isQCDone =
    workflowState.generatedImages.filter(
      (img) => img.reviewStatus === "pending" || img.reviewStatus === "refine",
    ).length === 0 &&
    workflowState.generatedImages.filter((img) => img.reviewStatus === "archived").length >= 1;

  useEffect(() => {
    workflowStateRef.current = workflowState;
  }, [workflowState]);

  const autoSave = useCallback(async (status: "draft" | "completed" = "draft") => {
    try {
      const state = workflowStateRef.current;
      const payload = {
        workflow_type: "share",
        mode: "full",
        status,
        current_step: state.currentStep,
        state_json: JSON.stringify(state),
        ...(state.sessionId ? { session_id: state.sessionId } : {}),
      };
      const res = await apiPost<WorkflowSessionSaveResponse>("/api/workflow-sessions/save", payload);
      if (res?.data?.session_id) {
        setWorkflowState((prev) => ({ ...prev, sessionId: res.data?.session_id ?? prev.sessionId }));
      } else if ((res as { session_id?: number | null })?.session_id) {
        const sessionId = (res as { session_id?: number | null }).session_id;
        setWorkflowState((prev) => ({ ...prev, sessionId: sessionId ?? prev.sessionId }));
      }
    } catch (e) {
      console.error("autoSave failed", e);
    }
  }, [workflowState]);

  function commitWorkflowState(nextState: ShareWorkflowState) {
    workflowStateRef.current = nextState;
    setWorkflowState(nextState);
    return nextState;
  }

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const params =
        typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
      const sessionId = params.get("session_id");
      if (!sessionId) return;

      setIsRestoring(true);
      try {
        const res = await apiGet(`/api/workflow-sessions/${sessionId}`);
        if (cancelled) return;
        const session = res?.data ?? res;
        if (session?.state_json) {
          const restored =
            typeof session.state_json === "string" ? JSON.parse(session.state_json) : session.state_json;
          const restoredState = {
            ...DEFAULT_WORKFLOW_STATE,
            ...restored,
            sessionId: Number(sessionId),
            currentStep: clampStep(Number(restored?.currentStep ?? session?.current_step ?? 1)),
          };
          commitWorkflowState(restoredState);
        }
      } catch {
        if (!cancelled) {
          console.error("session restore failed");
        }
      } finally {
        if (!cancelled) {
          setIsRestoring(false);
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

    function initReferenceCategories() {
      const categories = ASSET_CATEGORIES.map((item) => item.value).filter(
        (value) => !SHARE_REF_EXCLUDED.includes(value),
      );
      if (!cancelled) {
        setRefCategories(categories);
        setSelectedRefCategory((current) => current || categories[0] || "");
      }
    }

    async function loadAvailableModels() {
      setLoadingModels(true);
      try {
        const res = await apiGet<AvailableModel[]>("/api/model-configs/available?purpose=image");
        const items =
          res.code === 0 && Array.isArray(res.data)
            ? res.data.filter(
                (item) =>
                  (item.usage_type === "final" || item.usage_type === "both") &&
                  isImageGenerationModel(item),
              )
            : [];
        if (!cancelled) {
          setAvailableModels(items);
          setWorkflowState((current) => {
            if (current.selectedModel !== null) {
              return current;
            }
            const firstModelId = items[0]?.id ?? null;
            if (firstModelId === null) {
              return current;
            }
            return {
              ...current,
              selectedModel: firstModelId,
            };
          });
        }
      } catch {
        if (!cancelled) {
          setAvailableModels([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingModels(false);
        }
      }
    }

    async function loadGameTypes() {
      try {
        const res = await apiGet<string[]>("/api/share/game-types");
        const items = res.code === 0 && Array.isArray(res.data) && res.data.length > 0 ? res.data : ["Tongits", "Pusoy"];
        if (!cancelled) {
          setGameTypes(items);
          setWorkflowState((current) => {
            const nextGameType = items.includes(current.gameType) ? current.gameType : items[0];
            if (nextGameType === current.gameType) {
              return current;
            }
            const nextState = { ...current, gameType: nextGameType };
            workflowStateRef.current = nextState;
            return nextState;
          });
        }
      } catch {
        if (!cancelled) {
          setGameTypes(["Tongits", "Pusoy"]);
        }
      }
    }

    initReferenceCategories();
    void loadAvailableModels();
    void loadGameTypes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRefCategory) {
      setAssetTags([]);
      setReferenceAssets([]);
      return;
    }

    let cancelled = false;

    async function loadAssetTagsByCategory() {
      setLoadingAssetTags(true);
      try {
        const res = await apiGet<AssetTag[]>(`/api/assets/tags?category=${selectedRefCategory}`);
        if (!cancelled && res.code === 0 && Array.isArray(res.data)) {
          setAssetTags(res.data);
        } else if (!cancelled) {
          setAssetTags([]);
        }
      } catch {
        if (!cancelled) {
          setAssetTags([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingAssetTags(false);
        }
      }
    }

    async function loadReferenceAssetsByCategory() {
      setLoadingReferenceAssets(true);
      try {
        const res = await apiGet<AssetReference[]>(`/api/assets?category=${selectedRefCategory}`);
        if (!cancelled && res.code === 0 && Array.isArray(res.data)) {
          setReferenceAssets(res.data);
        } else if (!cancelled) {
          setReferenceAssets([]);
        }
      } catch {
        if (!cancelled) {
          setReferenceAssets([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingReferenceAssets(false);
        }
      }
    }

    void loadAssetTagsByCategory();
    void loadReferenceAssetsByCategory();

    return () => {
      cancelled = true;
    };
  }, [selectedRefCategory]);

  useEffect(() => {
    if (availableModels.length === 0 || workflowState.selectedModel !== null) {
      return;
    }
    setWorkflowState((current) => {
      if (current.selectedModel !== null) {
        return current;
      }
      const nextState = {
        ...current,
        selectedModel: availableModels[0]?.id ?? null,
      };
      workflowStateRef.current = nextState;
      return nextState;
    });
  }, [availableModels, workflowState.selectedModel]);

  useEffect(() => {
    if (workflowState.currentStep !== 5) {
      return;
    }

    let cancelled = false;

    async function loadGameInstructions() {
      setLoadingGameInstructions(true);
      try {
        const res = await apiGet<ShareGameInstruction[]>(
          `/api/share/game-instructions?game_type=${workflowState.gameType}`,
        );
        const items = res.code === 0 && Array.isArray(res.data) ? res.data : [];
        if (!cancelled) {
          setGameInstructions(items);
          setWorkflowState((current) => {
            const validIds = new Set(items.map((instruction) => instruction.id));
            const nextSelected = current.selectedGameInstructions.filter((id) => validIds.has(id));
            if (nextSelected.length === current.selectedGameInstructions.length) {
              return current;
            }
            const nextState = {
              ...current,
              selectedGameInstructions: nextSelected,
            };
            workflowStateRef.current = nextState;
            return nextState;
          });
        }
      } catch {
        if (!cancelled) {
          setGameInstructions([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingGameInstructions(false);
        }
      }
    }

    void loadGameInstructions();

    return () => {
      cancelled = true;
    };
  }, [workflowState.currentStep, workflowState.gameType]);

  function updateWorkflowState(updater: (current: ShareWorkflowState) => ShareWorkflowState) {
    setWorkflowState((current) => {
      const nextState = updater(current);
      workflowStateRef.current = nextState;
      return nextState;
    });
  }

  function canMoveToNextStep() {
    if (workflowState.currentStep === 1) {
      return workflowState.shareType !== null;
    }
    if (workflowState.currentStep === 2) {
      return workflowState.coreText.trim().length > 0;
    }
    if (workflowState.currentStep === 5) {
      return workflowState.selectedModel !== null;
    }
    return workflowState.currentStep < STEP_DEFINITIONS.length;
  }

  function handleNext() {
    const nextStep = clampStep(workflowState.currentStep + 1);
    const nextState = {
      ...workflowStateRef.current,
      currentStep: nextStep,
    };
    commitWorkflowState(nextState);
    setTimeout(() => {
      void autoSave("draft");
    }, 100);
  }

  function handlePrev() {
    const prevStep = clampStep(workflowState.currentStep - 1);
    const nextState = {
      ...workflowStateRef.current,
      currentStep: prevStep,
    };
    commitWorkflowState(nextState);
    setTimeout(() => {
      void autoSave("draft");
    }, 100);
  }

  function resolveGeneratedImageUrl(payload?: ShareGenerateApiResponse | null) {
    return (
      payload?.job?.generated_image_url ||
      payload?.generation?.images?.find((item) => item?.url)?.url ||
      ""
    );
  }

  function buildNextGeneratedImage(jobId: number, url: string): GeneratedImage {
    return {
      id: `${jobId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      jobId,
      url,
      reviewStatus: "pending",
      refinePrompt: "",
    };
  }

  async function handleGenerateImages() {
    if (!workflowState.shareType || !workflowState.selectedModel) {
      setError(t("请先完成前置配置"));
      return;
    }

    setError("");
    setMessage("");
    setGenerating(true);
    setGenerationProgress({ current: 0, total: workflowState.generateCount });

    const baseState: ShareWorkflowState = {
      ...workflowStateRef.current,
      generatedImages: [],
    };
    commitWorkflowState(baseState);

    try {
      for (let index = 0; index < workflowState.generateCount; index += 1) {
        setGenerationProgress({ current: index, total: workflowState.generateCount });
        const createRes = await apiPost<ShareJobApiResponse>("/api/share/jobs/create", {
          share_type: workflowStateRef.current.shareType,
          core_text: workflowStateRef.current.coreText,
          target_audience: workflowStateRef.current.targetAudience || undefined,
          game_type: workflowStateRef.current.gameType,
          image_language: workflowStateRef.current.imageLanguage,
          size: workflowStateRef.current.adSize,
          ...(workflowStateRef.current.sessionId ? { session_id: workflowStateRef.current.sessionId } : {}),
        });
        const createdJob = createRes?.data;
        if (createRes.code !== 0 || !createdJob?.id) {
          throw new Error(createRes.msg || t("Job 创建失败"));
        }

        const generateRes = await apiPost<ShareGenerateApiResponse>(
          `/api/share/jobs/${createdJob.id}/generate`,
          {
            reference_asset_ids: workflowStateRef.current.referenceAssetIds,
            model_config_id: workflowStateRef.current.selectedModel,
            game_instruction_contents: selectedGameInstructionContents,
          },
          120000,
        );
        if (generateRes.code !== 0) {
          throw new Error(generateRes.msg || t("生成失败"));
        }

        const imageUrl = resolveGeneratedImageUrl(generateRes.data);
        if (!imageUrl) {
          throw new Error(t("未收到生成图片"));
        }

        const nextState: ShareWorkflowState = {
          ...workflowStateRef.current,
          generatedImages: [
            ...workflowStateRef.current.generatedImages,
            buildNextGeneratedImage(createdJob.id, imageUrl),
          ],
        };
        commitWorkflowState(nextState);
        setGenerationProgress({ current: index + 1, total: workflowState.generateCount });
        void autoSave("draft");
      }
      setMessage(t("生成完成，请继续下方审核"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("生成失败"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleRefineImage(imageId: string) {
    const targetImage = workflowStateRef.current.generatedImages.find((image) => image.id === imageId);
    if (!targetImage) {
      return;
    }

    setError("");
    setMessage("");
    setRefiningImageIds((current) => [...current, imageId]);
    try {
      const res = await apiPost<ShareGenerateApiResponse>(
        `/api/share/jobs/${targetImage.jobId}/refine`,
        { refine_prompt: targetImage.refinePrompt || "" },
        120000,
      );
      if (res.code !== 0) {
        throw new Error(res.msg || t("精修失败"));
      }
      const imageUrl = resolveGeneratedImageUrl(res.data);
      if (!imageUrl) {
        throw new Error(t("未收到精修图片"));
      }
      const nextState: ShareWorkflowState = {
        ...workflowStateRef.current,
        generatedImages: workflowStateRef.current.generatedImages.map((image) =>
          image.id === imageId
            ? { ...image, url: imageUrl, reviewStatus: "pending", refinePrompt: image.refinePrompt }
            : image,
        ),
      };
      commitWorkflowState(nextState);
      void autoSave("draft");
      setMessage(t("精修完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("精修失败"));
    } finally {
      setRefiningImageIds((current) => current.filter((id) => id !== imageId));
    }
  }

  async function handleQcAction(imageId: string, status: "archived" | "deleted") {
    const targetImage = workflowStateRef.current.generatedImages.find((image) => image.id === imageId);
    if (!targetImage) {
      return;
    }

    setError("");
    setMessage("");
    setProcessingJobIds((current) => [...current, targetImage.jobId]);
    try {
      const res = await apiPost(`/api/share/jobs/${targetImage.jobId}/qc`, { status });
      if (res.code !== 0) {
        throw new Error(res.msg || `${status === "archived" ? t("归档") : t("删除")}${t("失败")}`);
      }
      const nextState: ShareWorkflowState = {
        ...workflowStateRef.current,
        generatedImages: workflowStateRef.current.generatedImages.map((image) =>
          image.id === imageId ? { ...image, reviewStatus: status } : image,
        ),
      };
      commitWorkflowState(nextState);
      void autoSave("draft");
      setMessage(status === "archived" ? t("图片已归档") : t("图片已删除"));
    } catch (err) {
      setError(err instanceof Error ? err.message : `${status === "archived" ? t("归档") : t("删除")}${t("失败")}`);
    } finally {
      setProcessingJobIds((current) => current.filter((jobId) => jobId !== targetImage.jobId));
    }
  }

  function handleSendBackToRefine(imageId: string) {
    const nextState: ShareWorkflowState = {
      ...workflowStateRef.current,
      currentStep: 6,
      generatedImages: workflowStateRef.current.generatedImages.map((image) =>
        image.id === imageId ? { ...image, reviewStatus: "refine" } : image,
      ),
    };
    commitWorkflowState(nextState);
    void autoSave("draft");
    setMessage(t("已发回精修"));
  }

  function handleWithdrawArchived(imageId: string) {
    const nextState: ShareWorkflowState = {
      ...workflowStateRef.current,
      generatedImages: workflowStateRef.current.generatedImages.map((image) =>
        image.id === imageId ? { ...image, reviewStatus: "pending" } : image,
      ),
    };
    commitWorkflowState(nextState);
    void autoSave("draft");
    setMessage(t("已撤回"));
  }

  function handleResetWorkflow() {
    setError("");
    setMessage("");
    setGenerating(false);
    setGenerationProgress({ current: 0, total: 0 });
    setRefiningImageIds([]);
    setProcessingJobIds([]);
    setSelectedReferenceTag("");
    commitWorkflowState({
      ...DEFAULT_WORKFLOW_STATE,
      selectedModel: availableModels[0]?.id ?? null,
    });
  }

  async function handleManualSave() {
    setIsSaving(true);
    try {
      await autoSave("draft");
      setMessage(t("草稿已保存"));
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (isQCDone && !completedSaveTriggeredRef.current) {
      completedSaveTriggeredRef.current = true;
      void autoSave("completed");
      return;
    }
    if (!isQCDone) {
      completedSaveTriggeredRef.current = false;
    }
  }, [autoSave, isQCDone]);

  function renderStepContent() {
    if (workflowState.currentStep === 1) {
      return (
        <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-4">
          {SHARE_TYPE_OPTIONS.map((option) => {
            const isSelected = workflowState.shareType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  updateWorkflowState((current) => ({
                    ...current,
                    shareType: option.value,
                  }))
                }
                className={`rounded-3xl border p-5 text-left transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                  {option.subtitle}
                </div>
                <div className="mt-3 text-xl font-semibold text-gray-900">{t(option.title)}</div>
                <div className="mt-2 text-sm text-gray-500">{t(option.description)}</div>
              </button>
            );
          })}
        </div>
      );
    }

    if (workflowState.currentStep === 2) {
      return (
        <div className="flex flex-col gap-6 p-6">
          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <label className="block text-sm font-semibold text-gray-900" htmlFor="share-core-text">
              {t("核心传播文案")}
            </label>
            <input
              id="share-core-text"
              type="text"
              value={workflowState.coreText}
              onChange={(event) =>
                updateWorkflowState((current) => ({
                  ...current,
                  coreText: event.target.value,
                }))
              }
              placeholder={t("例如：今日免费金币")}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
            />
            <p className="mt-2 text-xs text-gray-500">{t("≤ 8 words，口语化，像聊天里发的内容")}</p>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <label className="block text-sm font-semibold text-gray-900" htmlFor="share-target-audience">
              {t("目标人群")}
            </label>
            <input
              id="share-target-audience"
              type="text"
              value={workflowState.targetAudience}
              onChange={(event) =>
                updateWorkflowState((current) => ({
                  ...current,
                  targetAudience: event.target.value,
                }))
              }
              placeholder={t("例如：新手玩家 / 老玩家")}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
            />
          </div>

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <label className="block text-sm font-semibold text-gray-900" htmlFor="share-game-type">
              {t("游戏类型")}
            </label>
            <select
              id="share-game-type"
              value={workflowState.gameType}
              onChange={(event) =>
                updateWorkflowState((current) => ({
                  ...current,
                  gameType: event.target.value,
                }))
              }
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
            >
              {(gameTypes.length > 0 ? gameTypes : ["Tongits", "Pusoy"]).map((gameType) => (
                <option key={gameType} value={gameType}>
                  {gameType}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    if (workflowState.currentStep === 3) {
      return (
        <div className="grid gap-4 p-6 md:grid-cols-3">
          {LANGUAGE_OPTIONS.map((option) => {
            const isSelected = workflowState.imageLanguage === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  updateWorkflowState((current) => ({
                    ...current,
                    imageLanguage: option.value,
                  }))
                }
                className={`rounded-3xl border p-5 text-left transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 shadow-sm"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="text-lg font-semibold text-gray-900">{t(option.title)}</div>
                <div className="mt-2 text-sm text-gray-500">{t(option.description)}</div>
              </button>
            );
          })}
        </div>
      );
    }

    if (workflowState.currentStep === 4) {
      return (
        <div className="p-6">
          <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_260px]">
            <aside className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t("分类切换")}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {refCategories.map((category) => {
                    const active = selectedRefCategory === category;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => {
                          setSelectedRefCategory(category);
                          setSelectedReferenceTag("");
                        }}
                        className={`rounded-full border px-4 py-2 text-sm transition ${
                          active
                            ? "border-blue-500 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                        }`}
                      >
                        {t(refCategoryLabelMap[category] || category)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900">{t("标签筛选")}</p>
                {loadingAssetTags && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
              </div>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedReferenceTag("")}
                  className={`w-full rounded-2xl border px-4 py-2 text-left text-sm transition ${
                    !selectedReferenceTag
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                  }`}
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
                      className={`w-full rounded-2xl border px-4 py-2 text-left text-sm transition ${
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                      }`}
                    >
                      {getTagLabel(tag, lang)}
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="rounded-3xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{t("参考图列表")}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {t("当前分类：")} {t(refCategoryLabelMap[selectedRefCategory] || selectedRefCategory || "-")} {t("，最多选择 4 张参考图")}
                  </p>
                </div>
                {loadingReferenceAssets && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredReferenceAssets.length === 0 ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
                    {t("暂无参考图")}
                  </div>
                ) : (
                  filteredReferenceAssets.map((asset) => {
                    const selected = workflowState.referenceAssetIds.includes(asset.id);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() =>
                          updateWorkflowState((current) => {
                            const alreadySelected = current.referenceAssetIds.includes(asset.id);
                            if (alreadySelected) {
                              return {
                                ...current,
                                referenceAssetIds: current.referenceAssetIds.filter((id) => id !== asset.id),
                              };
                            }
                            if (current.referenceAssetIds.length >= 4) {
                              return current;
                            }
                            return {
                              ...current,
                              referenceAssetIds: [...current.referenceAssetIds, asset.id],
                            };
                          })
                        }
                        className={`overflow-hidden rounded-3xl border text-left transition ${
                          selected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                            : "border-gray-200 bg-white hover:border-gray-300"
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
                        <div className="px-4 py-3">
                          <p className="truncate text-sm font-medium text-gray-900">{assetDisplayName(asset)}</p>
                          <p className="mt-1 text-xs text-gray-500">{selected ? t("已选中") : t("点击选择")}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <aside className="rounded-3xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{t("已选参考图")}</p>
                <span className="text-xs text-gray-400">{workflowState.referenceAssetIds.length}/4</span>
              </div>
              <div className="mt-4 space-y-3">
                {selectedReferenceAssets.length === 0 ? (
                  <p className="text-sm text-gray-400">{t("尚未选择")}</p>
                ) : (
                  selectedReferenceAssets.map((asset) => (
                    <div key={asset.id} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-3">
                      {assetImageUrl(asset) ? (
                        <img
                          src={assetImageUrl(asset)}
                          alt={assetDisplayName(asset)}
                          className="h-14 w-14 rounded-xl border border-gray-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 text-[10px] text-gray-400">
                          {t("无预览")}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{assetDisplayName(asset)}</p>
                        <button
                          type="button"
                          onClick={() =>
                            updateWorkflowState((current) => ({
                              ...current,
                              referenceAssetIds: current.referenceAssetIds.filter((id) => id !== asset.id),
                            }))
                          }
                          className="mt-2 text-xs font-medium text-red-600 transition hover:text-red-700"
                        >
                          {t("取消选择")}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </div>
      );
    }

    if (workflowState.currentStep === 5) {
      return (
        <div className="flex flex-col gap-6 p-6">
          <section className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="text-sm font-semibold text-gray-900">{t("图片尺寸")}</div>
            <div className="mt-4 flex flex-wrap gap-3">
              {AD_SIZE_OPTIONS.map((item) => {
                const isSelected = workflowState.adSize === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() =>
                      updateWorkflowState((current) => ({
                        ...current,
                        adSize: item.value,
                      }))
                    }
                    className={`rounded-full border px-5 py-2 text-sm font-medium transition ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="text-sm font-semibold text-gray-900">{t("出图数量")}</div>
            <div className="mt-4 flex flex-wrap gap-3">
              {GENERATE_COUNT_OPTIONS.map((count) => {
                const isSelected = workflowState.generateCount === count;
                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() =>
                      updateWorkflowState((current) => ({
                        ...current,
                        generateCount: count,
                      }))
                    }
                    className={`rounded-full border px-5 py-2 text-sm font-medium transition ${
                      isSelected
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                    }`}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t("模型选择")}</div>
                <p className="mt-1 text-xs text-gray-500">{t("仅展示支持 final / both 的可用模型")}</p>
              </div>
              {loadingModels && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
            </div>
            <div className="mt-4 space-y-3">
              {availableModels.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  {t("暂无可用模型，请联系管理员")}
                </div>
              ) : (
                availableModels.map((model) => {
                  const isSelected = workflowState.selectedModel === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() =>
                        updateWorkflowState((current) => ({
                          ...current,
                          selectedModel: model.id,
                        }))
                      }
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{model.name}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {model.provider}
                            {model.model_name ? ` · ${model.model_name}` : ""}
                          </p>
                        </div>
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">
                          {model.usage_type || "unknown"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{t("游戏元素指令")}</div>
                <p className="mt-1 text-xs text-gray-500">
                  {t("根据当前游戏类型加载，建议至少选择一条游戏指令")}
                </p>
              </div>
              {loadingGameInstructions && <span className="text-xs text-gray-400">{t("加载中…")}</span>}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {gameInstructions.length === 0 ? (
                <div className="md:col-span-2 rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
                  {t("当前游戏暂无可用指令")}
                </div>
              ) : (
                gameInstructions.map((instruction) => {
                  const isSelected = workflowState.selectedGameInstructions.includes(instruction.id);
                  return (
                    <button
                      key={instruction.id}
                      type="button"
                      onClick={() =>
                        updateWorkflowState((current) => {
                          const alreadySelected = current.selectedGameInstructions.includes(instruction.id);
                          return {
                            ...current,
                            selectedGameInstructions: alreadySelected
                              ? current.selectedGameInstructions.filter((id) => id !== instruction.id)
                              : [...current.selectedGameInstructions, instruction.id],
                          };
                        })
                      }
                      className={`rounded-3xl border p-4 text-left transition ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-100"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900">{instruction.label}</p>
                      <p className="mt-2 text-xs leading-6 text-gray-500">
                        {instruction.content.slice(0, 60)}
                        {instruction.content.length > 60 ? "..." : ""}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      );
    }

    if (workflowState.currentStep === 6) {
      if (isQCDone) {
        return (
          <div className="flex flex-col gap-6 p-6">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
              <p className="text-lg font-semibold text-emerald-800">{t("本批生产完成")}</p>
              <p className="mt-2 text-sm text-emerald-700">{t("所有待审核图片都已处理，且至少有 1 张图片已归档。")}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href="/workbench/gallery"
                  className="rounded-full border border-emerald-300 bg-white px-5 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                >
                  {t("查看成品图库")}
                </Link>
                <button
                  type="button"
                  onClick={handleResetWorkflow}
                  className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
                >
                  {t("继续生产")}
                </button>
              </div>
            </div>

            <section className="rounded-3xl border border-gray-200 bg-white p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{t("已归档")}</p>
                <span className="text-xs text-gray-400">{archivedReviewImages.length} 张</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {archivedReviewImages.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50">
                    <div className="relative">
                      <img
                        src={absoluteUrl(image.url)}
                        alt={`share-archived-${image.jobId}`}
                        className="aspect-square w-full bg-gray-100 object-cover"
                      />
                      <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white">
                        {t("已归档")}
                      </span>
                    </div>
                    <div className="p-4">
                      <button
                        type="button"
                        onClick={() => handleWithdrawArchived(image.id)}
                        className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                      >
                        {t("撤回")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        );
      }

      return (
        <div className="flex flex-col gap-6 p-6">
          <section className="rounded-3xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-lg font-semibold text-gray-900">{t("生成")}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {generating
                    ? `${t("生成中")} ${generationProgress.current}/${generationProgress.total}…`
                    : t("按设定循环生成图片，可实时查看并单张精修。")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleGenerateImages()}
                disabled={generating || !workflowState.shareType || !workflowState.selectedModel}
                className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generating ? t("生成中...") : t("开始生成")}
              </button>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <div>
              <p className="text-sm font-semibold text-gray-900">{t("图片列表")}</p>
              <p className="mt-1 text-xs text-gray-500">{t("生成结果会实时追加在这里，支持逐张精修。")}</p>
            </div>
          </div>

          {refineReviewImages.length > 0 && (
            <div className="rounded-3xl border border-yellow-200 bg-yellow-50 px-5 py-4 text-sm text-yellow-800">
              {t("有")} {refineReviewImages.length} {t("张图待精修，请优先处理这些图片。")}
            </div>
          )}

          {workflowState.generatedImages.length > 0 && !generating && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <div>
                <p className="text-sm font-semibold text-emerald-800">{t("生成完成，请继续审核")}</p>
                <p className="mt-1 text-xs text-emerald-700">{t("本轮已生成")} {workflowState.generatedImages.length} {t("张图片，下方可直接 QC。")}</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {workflowState.generatedImages.length === 0 ? (
              <div className="col-span-full rounded-3xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-400">
                {t("暂无生成图片")}
              </div>
            ) : (
              workflowState.generatedImages.map((image) => {
                const isRefineTarget = image.reviewStatus === "refine";
                const isRefining = refiningImageIds.includes(image.id);
                return (
                  <div
                    key={image.id}
                    className={`overflow-hidden rounded-3xl border bg-white ${
                      isRefineTarget ? "border-yellow-400 ring-2 ring-yellow-100" : "border-gray-200"
                    }`}
                  >
                    <div className="relative">
                      <img
                        src={absoluteUrl(image.url)}
                        alt={`share-${image.jobId}`}
                        className="aspect-square w-full bg-gray-100 object-cover"
                      />
                      <span
                        className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[11px] font-semibold ${
                          image.reviewStatus === "archived"
                            ? "bg-emerald-500 text-white"
                            : image.reviewStatus === "deleted"
                              ? "bg-gray-700 text-white"
                              : image.reviewStatus === "refine"
                                ? "bg-yellow-400 text-yellow-950"
                                : "bg-blue-500 text-white"
                        }`}
                      >
                        {image.reviewStatus === "archived"
                          ? "archived"
                          : image.reviewStatus === "deleted"
                            ? "deleted"
                            : image.reviewStatus === "refine"
                              ? t("待精修")
                              : t("待审核")}
                      </span>
                    </div>
                    <div className="space-y-3 p-4">
                      <label className="block">
                        <span className="text-xs font-medium text-gray-700">{t("精修输入框")}</span>
                        <textarea
                          rows={3}
                          value={image.refinePrompt}
                          onChange={(event) =>
                            updateWorkflowState((current) => ({
                              ...current,
                              generatedImages: current.generatedImages.map((item) =>
                                item.id === image.id ? { ...item, refinePrompt: event.target.value } : item,
                              ),
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-400"
                          placeholder={t("输入精修要求…")}
                        />
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleRefineImage(image.id)}
                          disabled={isRefining}
                          className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isRefining ? t("精修中...") : t("精修")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-dashed border-gray-200" />

          <div className="rounded-3xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-sm font-semibold text-gray-900">{t("审核 QC")}</p>
            <p className="mt-1 text-xs text-gray-500">{t("逐图归档、发回精修或删除。所有待审核项清空且至少归档 1 张后，本批次完成。")}</p>
          </div>

          <section className="rounded-3xl border border-gray-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-900">{t("待审核")}</p>
              <span className="text-xs text-gray-400">{pendingReviewImages.length} 张</span>
            </div>
            {pendingReviewImages.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
                {t("暂无待审核图片")}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {pendingReviewImages.map((image) => {
                  const isProcessing = processingJobIds.includes(image.jobId);
                  const isRefineTarget = image.reviewStatus === "refine";
                  return (
                    <div
                      key={image.id}
                      className={`overflow-hidden rounded-3xl border bg-white ${
                        isRefineTarget ? "border-yellow-400 ring-2 ring-yellow-100" : "border-gray-200"
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={absoluteUrl(image.url)}
                          alt={`share-review-${image.jobId}`}
                          className="aspect-square w-full bg-gray-100 object-cover"
                        />
                        {isRefineTarget && (
                          <span className="absolute left-3 top-3 rounded-full bg-yellow-400 px-3 py-1 text-[11px] font-semibold text-yellow-950">
                            {t("待精修")}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 p-4">
                        <button
                          type="button"
                          onClick={() => void handleQcAction(image.id, "archived")}
                          disabled={isProcessing}
                          className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t("归档")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSendBackToRefine(image.id)}
                          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                        >
                          {t("发回精修")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQcAction(image.id, "deleted")}
                          disabled={isProcessing}
                          className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {t("删除")}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-900">{t("已归档")}</p>
              <span className="text-xs text-gray-400">{archivedReviewImages.length} 张</span>
            </div>
            {archivedReviewImages.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
                {t("暂无已归档图片")}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {archivedReviewImages.map((image) => (
                  <div key={image.id} className="overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50">
                    <div className="relative">
                      <img
                        src={absoluteUrl(image.url)}
                        alt={`share-archived-${image.jobId}`}
                        className="aspect-square w-full bg-gray-100 object-cover"
                      />
                      <span className="absolute left-3 top-3 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-semibold text-white">
                        已归档
                      </span>
                    </div>
                    <div className="p-4">
                      <button
                        type="button"
                        onClick={() => handleWithdrawArchived(image.id)}
                        className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                      >
                        撤回
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      );
    }

    return (
      <div className="p-8 text-center text-gray-400">
        {t("Step")} {currentStepMeta.id}：{t(currentStepMeta.title)} - {t("待实现")}
      </div>
    );
  }

  if (isRestoring) {
    return <div className="flex h-64 items-center justify-center text-gray-400">{t("草稿恢复中…")}</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-gray-400">Share Workflow</p>
              <div>
                <h1 className="text-3xl font-semibold text-gray-900">{t("转发图生产")}</h1>
                <p className="mt-2 text-sm text-gray-500">{t("完成转发图的配置、批量生成、精修和逐图审核归档。")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleManualSave()}
              disabled={isSaving}
              className="rounded-full border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? t("保存中…") : t("保存草稿")}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}

        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-6">
            {STEP_DEFINITIONS.map((step) => {
              const isActive = step.id === workflowState.currentStep;
              const isCompleted = step.id < workflowState.currentStep;
              return (
                <div
                  key={step.id}
                  className={`rounded-2xl border px-4 py-3 text-sm transition-colors ${
                    isActive
                      ? "border-gray-900 bg-gray-900 text-white"
                      : isCompleted
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-gray-200 bg-gray-50 text-gray-500"
                  }`}
                >
                  <div className="text-xs font-semibold uppercase tracking-[0.2em]">{t("Step")} {step.id}</div>
                  <div className="mt-1 font-medium">{t(step.title)}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-dashed border-gray-200 bg-white shadow-sm">
          {renderStepContent()}
        </div>

        <div className="flex items-center justify-between rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={handlePrev}
            disabled={workflowState.currentStep <= 1}
            className="rounded-full border border-gray-200 px-5 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("上一步")}
          </button>
          <div className="text-sm text-gray-400">
            {t("当前步骤：")} {workflowState.currentStep} / {STEP_DEFINITIONS.length}
          </div>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canMoveToNextStep()}
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("下一步")}
          </button>
        </div>
      </div>
    </div>
  );
}
