// @ts-nocheck
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import GenerateButton from "@workbench/components/workflow/GenerateButton";
import ModelSelector from "@workbench/components/workflow/ModelSelector";
import StepLayout from "@workbench/components/workflow/StepLayout";
import WorkflowStepHeader from "@workbench/components/workflow/WorkflowStepHeader";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { apiGet, apiPost } from "@workbench/lib/api";
import { getTagLabel } from "@workbench/lib/tag-display";
import {
  buildActivityPromptPreview,
  buildActivityReferenceAssetQueryPath,
  buildActivityVariablesJson,
  collectActivityReferenceAssetIds,
  initialActivityFieldValues,
  normalizeActivityBatchImages,
  validateActivityFieldValues,
  type ActivityAdSize,
  type ActivityBatchImageView,
  type ActivityReferenceImages,
} from "@workbench/lib/activity-production-workflow";
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
} from "@workbench/lib/activity-workflow-theme";
import { ACTIVITY_AD_SIZES, ASSET_CATEGORIES } from "@workbench/lib/constants";
import { isImageGenerationModel, type AvailableExpressionModel } from "@workbench/lib/expression-workflow";

const API_BASE = "/api/workbench";
const GENERATION_TIMEOUT_MS = 660000;
const STEP_TITLES = ["选模板", "填写内容", "生成图片", "质检归档"];
const REF_PAGE_SIZE = 9;

interface ActivityTemplateType {
  id: number;
  name: string;
  code: string;
  sort_order: number;
}

interface FieldDef {
  id: number;
  field_key: string;
  field_name: string;
  field_type: "text" | "textarea" | "number" | "select" | "switch";
  is_required: boolean;
  default_value: string;
  hint: string;
  options_json: string[] | null;
  sort_order: number;
}

interface ActivityTemplate {
  id: number;
  template_no: string;
  name: string;
  name_en?: string | null;
  type_id: number;
  usage_scenario: string;
  scenario_en?: string | null;
  fields: FieldDef[];
  structure_layer1: string;
  structure_layer2: string;
  structure_layer3: string;
  bg_description?: string | null;
  forbidden_rules?: string | null;
  rule_character?: string | null;
  style_guide?: string | null;
  rule_scene?: string | null;
  rule_visual?: string | null;
  rule_copy?: string | null;
  rule_button?: string | null;
  rule_quality?: string | null;
  rule_forbidden?: string | null;
}

interface ModelConfig {
  id: number;
  name: string;
  provider: string;
  model_name?: string;
  price_per_image: number | string;
  usage_type: string;
}

interface Asset {
  id: number;
  filename: string;
  category: string;
  tags?: string | null;
  url: string;
}

interface WorkflowState {
  selectedTemplate: ActivityTemplate | null;
  fieldValues: Record<string, string>;
  adSize: ActivityAdSize;
  referenceImages: ActivityReferenceImages;
  modelConfigId: number | null;
  taskId: number | null;
  batchId: number | null;
  batchImages: BatchImage[];
  batchStatus: string;
  globalExtraPrompt: string;
  imageConfigs: ImageConfig[];
  qc: { reward_visible: boolean; action_clear: boolean; character_consistent: boolean };
}

interface TaskCreateResponse {
  id: number;
}

interface ImageConfig {
  extraPrompt: string;
}

type BatchImage = ActivityBatchImageView;

interface ActivityBatchResponse {
  id: number;
  task_id: number;
  status: string;
  template_id?: number | null;
  images: unknown[];
}

interface DraftBatch {
  id: number;
  template_id?: number;
  template_name?: string | null;
  created_at?: string | null;
  image_count?: number;
}

interface RefImageSelectorProps {
  title: string;
  refKey: "character" | "background" | "props";
  defaultCategory: string;
  allowCategorySwitch: boolean;
  selectedAssetId: number | null;
  onSelect: (assetId: number | null) => void;
}

interface ActivityAssetTagOption {
  name: string;
  name_en?: string | null;
  name_zh?: string | null;
}

const DEFAULT_STATE: WorkflowState = {
  selectedTemplate: null,
  fieldValues: {},
  adSize: "1024x1024",
  referenceImages: { character: null, background: null, props: null },
  modelConfigId: null,
  taskId: null,
  batchId: null,
  batchImages: [],
  batchStatus: "",
  globalExtraPrompt: "",
  imageConfigs: [{ extraPrompt: "" }],
  qc: { reward_visible: false, action_clear: false, character_consistent: false },
};

function absoluteUrl(url: string) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:")) {
    return url;
  }
  return `${API_BASE}${url}`;
}

function modelPrice(model: ModelConfig) {
  return Number(model.price_per_image || 0);
}

function sortedFields(template: ActivityTemplate | null) {
  return [...(template?.fields || [])].sort(
    (a, b) => a.sort_order - b.sort_order || a.field_key.localeCompare(b.field_key),
  );
}

export default function ActivityWorkflowPage() {
  const { t } = useLanguage();
  return (
    <Suspense
      fallback={
        <div className={ACTIVITY_PAGE_SHELL_CLASS}>
          <div className={ACTIVITY_PAGE_INNER_CLASS}>
            <div className={ACTIVITY_PANEL_CLASS}>
              <p className="text-sm text-gray-500">{t("活动图工作流加载中…")}</p>
            </div>
          </div>
        </div>
      }
    >
      <ActivityWorkflowPageContent />
    </Suspense>
  );
}

function normalizeTemplates(templates: ActivityTemplate[]) {
  return templates.map((template) => ({
    ...template,
    usage_scenario: template.usage_scenario || "",
    scenario_en: template.scenario_en || "",
    fields: sortedFields(template),
  }));
}

function getTemplateDisplayName(template: ActivityTemplate, lang: string) {
  return lang === "en" ? template.name_en ?? template.name : template.name;
}

function getTemplateDisplayScenario(template: ActivityTemplate, lang: string) {
  return lang === "en" ? template.scenario_en ?? template.usage_scenario : template.usage_scenario;
}

function RefImageSelector({
  title,
  refKey,
  defaultCategory,
  allowCategorySwitch,
  selectedAssetId,
  onSelect,
}: RefImageSelectorProps) {
  const { t, lang } = useLanguage();
  const [activeCategory, setActiveCategory] = useState(defaultCategory);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [categories] = useState(ASSET_CATEGORIES);
  const [tags, setTags] = useState<ActivityAssetTagOption[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(assets.length / REF_PAGE_SIZE));
  const pagedAssets = useMemo(() => {
    const start = (page - 1) * REF_PAGE_SIZE;
    return assets.slice(start, start + REF_PAGE_SIZE);
  }, [assets, page]);

  useEffect(() => {
    let cancelled = false;

    async function loadTags() {
      try {
        const res = await apiGet<Array<string | { id?: number; name?: string | null; name_en?: string | null; name_zh?: string | null }>>(
          `/api/assets/tags?category=${encodeURIComponent(activeCategory)}`,
        );
        if (cancelled) return;
        const nextTags = (Array.isArray(res.data) ? res.data : [])
          .map((tag) => {
            if (typeof tag === "string") {
              return { name: tag.trim(), name_en: null, name_zh: null };
            }
            return {
              name: String(tag?.name || "").trim(),
              name_en: tag?.name_en ?? null,
              name_zh: tag?.name_zh ?? null,
            };
          })
          .filter((tag) => tag.name);
        setTags(nextTags);
        setActiveTag(null);
      } catch {
        if (cancelled) return;
        setTags([]);
        setActiveTag(null);
      }
    }

    loadTags();
    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  useEffect(() => {
    let cancelled = false;

    async function loadAssets() {
      setLoading(true);
      try {
        const res = await apiGet<{ items?: Asset[] } | Asset[]>(
          buildActivityReferenceAssetQueryPath(activeCategory, activeTag),
        );
        if (cancelled) return;
        const payload = res.data as { items?: Asset[] } | Asset[] | null | undefined;
        const nextAssets = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.items)
            ? payload.items
            : [];
        setAssets(nextAssets);
      } catch {
        if (cancelled) return;
        setAssets([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, [activeCategory, activeTag]);

  useEffect(() => {
    setPage(1);
  }, [activeCategory, activeTag]);

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedAsset(null);
      return;
    }
    const found = assets.find((asset) => asset.id === selectedAssetId) || null;
    setSelectedAsset(found);
  }, [selectedAssetId, assets]);

  return (
    <div data-ref-key={refKey} className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3">
        <span className="text-sm font-medium text-gray-700">{title}{t("（可选）")}</span>
        <span className="ml-2 text-xs text-gray-400">{t("选择后会作为本次生成的视觉参考")}</span>
      </div>

      <div className="grid grid-cols-4 gap-4" style={{ gridTemplateColumns: "1fr 2fr 1fr" }}>
        <div className="flex flex-col gap-2">
          {allowCategorySwitch && (
            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
              {categories.map((category) => (
                <div key={category.value}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCategory(category.value);
                      setActiveTag(null);
                    }}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition ${
                      activeCategory === category.value
                        ? "bg-emerald-50 font-medium text-emerald-700"
                        : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <span>{t(category.label)}</span>
                    {activeCategory === category.value && tags.length > 0 && (
                      <span className="text-xs text-emerald-400">▶</span>
                    )}
                  </button>

                  {activeCategory === category.value && tags.length > 0 && (
                    <div className="mt-0.5 mb-1 ml-3 flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => setActiveTag(null)}
                        className={`rounded px-2 py-1 text-left text-xs transition ${
                          !activeTag
                            ? "bg-emerald-50 font-medium text-emerald-700"
                            : "text-gray-400 hover:bg-gray-50"
                        }`}
                      >
                        {t("全部")}
                      </button>
                      {tags.map((tag) => (
                        <button
                          key={tag.name}
                          type="button"
                          onClick={() => setActiveTag(tag.name === activeTag ? null : tag.name)}
                          className={`rounded px-2 py-1 text-left text-xs transition ${
                            activeTag === tag.name
                              ? "bg-emerald-50 font-medium text-emerald-700"
                              : "text-gray-400 hover:bg-gray-50"
                          }`}
                        >
                          {getTagLabel(tag, lang)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!allowCategorySwitch && (
            <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                className={`rounded px-2 py-1.5 text-left text-xs ${
                  !activeTag ? "bg-emerald-50 font-medium text-emerald-700" : "text-gray-400 hover:bg-gray-50"
                }`}
                >
                {t("全部")}
                </button>
              {tags.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  onClick={() => setActiveTag(tag.name === activeTag ? null : tag.name)}
                  className={`rounded px-2 py-1.5 text-left text-xs ${
                    activeTag === tag.name ? "bg-emerald-50 font-medium text-emerald-700" : "text-gray-400 hover:bg-gray-50"
                  }`}
                >
                  {getTagLabel(tag, lang)}
                </button>
              ))}
              {tags.length === 0 && <span className="px-2 text-xs text-gray-300">{t("暂无标签")}</span>}
            </div>
          )}
        </div>

        <div>
          {loading ? (
            <div className="py-8 text-center text-xs text-gray-400">{t("加载中…")}</div>
          ) : assets.length === 0 ? (
            <div className="py-8 text-center text-xs text-gray-400">{t("暂无素材")}</div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {pagedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    onClick={() => onSelect(asset.id === selectedAssetId ? null : asset.id)}
                    className={`relative cursor-pointer overflow-hidden rounded-lg border-2 transition ${
                      asset.id === selectedAssetId
                        ? "border-emerald-500"
                        : "border-transparent hover:border-emerald-300"
                    }`}
                  >
                    <img
                      src={absoluteUrl(asset.url)}
                      className="aspect-square w-full object-cover"
                      alt={asset.filename}
                    />
                  </div>
                ))}
              </div>

              {assets.length > REF_PAGE_SIZE && (
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() => setPage((current) => current - 1)}
                    className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 transition hover:border-emerald-400 disabled:opacity-30"
                  >
                    {t("上一页")}
                  </button>
                  <span className="text-xs text-gray-400">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                    className="rounded border border-gray-200 px-3 py-1 text-xs text-gray-500 transition hover:border-emerald-400 disabled:opacity-30"
                  >
                    {t("下一页")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col items-center justify-start gap-2">
          {selectedAsset ? (
            <>
              <img
                src={absoluteUrl(selectedAsset.url)}
                className="w-full rounded-lg border border-emerald-200 object-cover"
                alt={selectedAsset.filename}
              />
              <span className="text-center text-xs break-all text-gray-500">{selectedAsset.filename}</span>
              <button type="button" onClick={() => onSelect(null)} className="text-xs text-red-400 hover:text-red-600">
                {t("取消选择")}
              </button>
            </>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-gray-200">
              <span className="text-xs text-gray-300">{t("未选择")}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityWorkflowPageContent() {
  const { t, lang } = useLanguage();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [types, setTypes] = useState<ActivityTemplateType[]>([]);
  const [templates, setTemplates] = useState<ActivityTemplate[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | null>(null);
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WorkflowState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [drafts, setDrafts] = useState<DraftBatch[]>([]);
  const [refiningImageId, setRefiningImageId] = useState<number | null>(null);
  const [refinePromptInput, setRefinePromptInput] = useState("");
  const [refiningLoading, setRefiningLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);

  const finalModels = useMemo(
    () => models.filter((model) => model.usage_type === "final" || model.usage_type === "both"),
    [models],
  );

  const filteredTemplates = useMemo(() => {
    if (activeTypeId === null) return templates;
    return templates.filter((template) => template.type_id === activeTypeId);
  }, [activeTypeId, templates]);

  const selectedFields = useMemo(() => sortedFields(state.selectedTemplate), [state.selectedTemplate]);
  const validationError = validateActivityFieldValues(selectedFields, state.fieldValues);
  const allQcPassed = state.qc.reward_visible && state.qc.action_clear && state.qc.character_consistent;
  const visibleBatchImages = state.batchImages.filter((image) => image.status !== "deleted");
  const handledImageCount = state.batchImages.filter((image) => image.status === "archived" || image.status === "deleted").length;
  const promptPreview = state.selectedTemplate
    ? buildActivityPromptPreview(state.selectedTemplate, state.fieldValues, state.adSize)
    : "";
  const workflowSteps = useMemo(() => STEP_TITLES.map((label) => ({ label: t(label) })), [t]);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [typeRes, templateRes, modelRes] = await Promise.all([
          apiGet<ActivityTemplateType[]>("/api/activity/template-types"),
          apiGet<ActivityTemplate[]>("/api/activity/templates?is_active=true"),
          apiGet<ModelConfig[]>("/api/model-configs/available?purpose=image"),
        ]);

        if (typeRes.code !== 0) throw new Error(typeRes.msg || t("模板类型加载失败"));
        if (templateRes.code !== 0) throw new Error(templateRes.msg || t("模板加载失败"));
        if (modelRes.code !== 0) throw new Error(modelRes.msg || t("模型加载失败"));

        const nextTypes = Array.isArray(typeRes.data) ? typeRes.data : [];
        const nextModels = (Array.isArray(modelRes.data) ? modelRes.data : []).filter((model) =>
          isImageGenerationModel(model as AvailableExpressionModel),
        );
        const recommendedModel = [...nextModels]
          .filter((model) => model.usage_type === "final" || model.usage_type === "both")
          .sort((a, b) => modelPrice(b) - modelPrice(a))[0];

        setTypes(nextTypes);
        setTemplates(normalizeTemplates(Array.isArray(templateRes.data) ? templateRes.data : []));
        setModels(nextModels);
        setState((current) => ({
          ...current,
          modelConfigId: current.modelConfigId || recommendedModel?.id || null,
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("活动图工作流加载失败"));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  useEffect(() => {
    async function loadDrafts() {
      try {
        const res = await apiGet<DraftBatch[]>("/api/activity/batches/drafts");
        setDrafts(Array.isArray(res.data) ? res.data : []);
      } catch {
        setDrafts([]);
      }
    }

    loadDrafts();
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    async function restoreFromSession() {
      const sessionRes = await apiGet<{ state_json?: string | null }>(`/api/workflow-sessions/${sessionId}`);
      if (sessionRes.code !== 0 || !sessionRes.data?.state_json) return;

      let state: { batch_id?: number } = {};
      try {
        state = JSON.parse(sessionRes.data.state_json);
      } catch {
        return;
      }
      if (!state.batch_id) return;

      const batchRes = await apiGet<ActivityBatchResponse>(`/api/activity/batches/${state.batch_id}`);
      if (batchRes.code !== 0 || !batchRes.data) return;
      const batch = batchRes.data;
      setState((current) => ({
        ...current,
        batchId: batch.id,
        batchImages: normalizeActivityBatchImages(batch.images),
        batchStatus: batch.status,
        taskId: batch.task_id,
      }));
      setStep(4);
    }

    restoreFromSession();
  }, [sessionId]);

  function selectTemplate(template: ActivityTemplate) {
    setState((current) => ({
      ...DEFAULT_STATE,
      selectedTemplate: template,
      fieldValues: initialActivityFieldValues(template.fields),
      modelConfigId: current.modelConfigId,
      adSize: current.adSize,
    }));
    setError(null);
  }

  function updateField(field: FieldDef, value: string) {
    setState((current) => ({
      ...current,
      fieldValues: {
        ...current.fieldValues,
        [field.field_key]: value,
      },
      batchId: null,
      batchImages: [],
      batchStatus: "",
      qc: DEFAULT_STATE.qc,
    }));
  }

  function resetGeneratedResult(current: WorkflowState) {
    return {
      ...current,
      batchId: null,
      batchImages: [],
      batchStatus: "",
      qc: DEFAULT_STATE.qc,
    };
  }

  function updateAdSize(adSize: ActivityAdSize) {
    setState((current) => ({
      ...resetGeneratedResult(current),
      adSize,
      taskId: null,
    }));
  }

  function updateModelConfig(modelConfigId: number | null) {
    setState((current) => ({ ...resetGeneratedResult(current), modelConfigId }));
  }

  async function ensureTaskCreated(template: ActivityTemplate) {
    if (state.taskId) return state.taskId;

    const taskRes = await apiPost<TaskCreateResponse>("/api/tasks/create", {
      title: `${t("活动图生产")}-${getTemplateDisplayName(template, lang)}`,
      scene: "activity",
      size: state.adSize,
      description: "",
      budget: 10,
    });

    if (taskRes.code !== 0 || !taskRes.data?.id) {
      throw new Error(taskRes.msg || t("创建任务失败"));
    }

    setState((current) => ({ ...current, taskId: taskRes.data.id }));
    return taskRes.data.id;
  }

  async function handleGenerate() {
    if (!state.selectedTemplate) {
      setError(t("请先选择模板"));
      return;
    }
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!state.modelConfigId) {
      setError(t("请选择模型"));
      return;
    }

    setGenerating(true);
    setError(null);
    setState((current) => ({
      ...current,
      batchId: null,
      batchImages: [],
      batchStatus: "generating",
      qc: DEFAULT_STATE.qc,
    }));

    try {
      const taskId = await ensureTaskCreated(state.selectedTemplate);
      const referenceAssetIds = collectActivityReferenceAssetIds(state.referenceImages);
      const batchRes = await apiPost<ActivityBatchResponse>(
        "/api/activity/batches/create",
        {
          template_id: state.selectedTemplate.id,
          task_id: taskId,
          variables_json: buildActivityVariablesJson(selectedFields, state.fieldValues),
          global_extra_prompt: state.globalExtraPrompt.trim() || null,
          model_config_id: state.modelConfigId,
          ad_size: state.adSize,
          reference_asset_ids: referenceAssetIds,
          image_configs: state.imageConfigs.map((config) => ({
            extra_prompt: config.extraPrompt.trim(),
          })),
        },
        GENERATION_TIMEOUT_MS,
      );

      if (batchRes.code !== 0) {
        throw new Error(batchRes.msg || t("生成失败，请重试"));
      }

      const batch = batchRes.data;
      setState((current) => ({
        ...current,
        taskId,
        batchId: batch.id,
        batchImages: normalizeActivityBatchImages(batch.images),
        batchStatus: batch.status,
      }));
      setStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("生成失败，请重试"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleArchiveImage(imageId: number) {
    if (!state.batchId) return;
    setArchivingId(imageId);
    setError(null);
    try {
      const res = await apiPost<{ completed?: boolean; image?: unknown }>(
        `/api/activity/batches/${state.batchId}/archive-image`,
        { image_id: imageId },
      );
      if (res.code !== 0) throw new Error(res.msg || t("归档失败"));
      const [updatedImage] = normalizeActivityBatchImages(res.data?.image ? [res.data.image] : []);
      setState((current) => ({
        ...current,
        batchImages: current.batchImages.map((image) =>
          image.id === imageId ? updatedImage || { ...image, status: "archived" } : image,
        ),
        batchStatus: res.data?.completed ? "completed" : current.batchStatus,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("归档失败"));
    } finally {
      setArchivingId(null);
    }
  }

  async function handleDeleteImage(imageId: number) {
    if (!state.batchId) return;
    setDeletingId(imageId);
    setError(null);
    try {
      const res = await apiPost<{ completed?: boolean }>(
        `/api/activity/batches/${state.batchId}/delete-image`,
        { image_id: imageId },
      );
      if (res.code !== 0) throw new Error(res.msg || t("删除失败"));
      setState((current) => ({
        ...current,
        batchImages: current.batchImages.map((image) =>
          image.id === imageId ? { ...image, status: "deleted" } : image,
        ),
        batchStatus: res.data?.completed ? "completed" : current.batchStatus,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("删除失败"));
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRefine(imageId: number) {
    if (!state.batchId || !refinePromptInput.trim()) return;
    if (refiningLoading) return;
    setRefiningLoading(true);
    setError(null);
    try {
      const res = await apiPost<unknown>(
        `/api/activity/batches/${state.batchId}/refine`,
        {
          image_id: imageId,
          refine_prompt: refinePromptInput.trim(),
        },
        GENERATION_TIMEOUT_MS,
      );
      if (res.code !== 0) throw new Error(res.msg || t("精修失败"));
      const [nextImage] = normalizeActivityBatchImages([res.data]);
      setState((current) => ({
        ...current,
        batchImages: nextImage ? [...current.batchImages, nextImage] : current.batchImages,
      }));
      setRefiningImageId(null);
      setRefinePromptInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("精修失败"));
    } finally {
      setRefiningLoading(false);
    }
  }

  async function handleSaveDraft() {
    if (!state.batchId) return;
    setSavingDraft(true);
    setError(null);
    try {
      const res = await apiPost(`/api/activity/batches/${state.batchId}/save-draft`, {});
      if (res.code !== 0) throw new Error(res.msg || t("保存草稿失败"));
      setState((current) => ({ ...current, batchStatus: "draft" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("保存草稿失败"));
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleResumeDraft(draft: DraftBatch) {
    const res = await apiGet<ActivityBatchResponse>(`/api/activity/batches/${draft.id}`);
    if (res.code !== 0) return;
    const batch = res.data;
    setState((current) => ({
      ...current,
      batchId: batch.id,
      batchImages: normalizeActivityBatchImages(batch.images),
      batchStatus: batch.status,
      taskId: batch.task_id,
    }));
    setStep(4);
  }

  function handleContinueProduction() {
    setState((current) => ({
      ...DEFAULT_STATE,
      modelConfigId: current.modelConfigId,
    }));
    setStep(1);
    setError(null);
  }

  function renderField(field: FieldDef) {
    const value = state.fieldValues[field.field_key] ?? "";
    const requiredError = field.is_required && !value.trim();
    const onChange = (nextValue: string) => updateField(field, nextValue);

    return (
      <div key={field.field_key} className="flex flex-col gap-1">
        <label className="text-sm font-medium text-gray-700">
          {field.field_name}
          {field.is_required && <span className="ml-1 text-red-500">*</span>}
        </label>
        {field.field_type === "textarea" ? (
          <textarea
            rows={3}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={ACTIVITY_INPUT_CLASS}
          />
        ) : field.field_type === "number" ? (
          <input
            type="number"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={ACTIVITY_INPUT_CLASS}
          />
        ) : field.field_type === "select" ? (
          <select value={value} onChange={(event) => onChange(event.target.value)} className={ACTIVITY_INPUT_CLASS}>
            <option value="">{t("请选择")}</option>
            {(field.options_json || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.field_type === "switch" ? (
          <label className="mt-1 inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={value === "true" || value === "1"}
              onChange={(event) => onChange(event.target.checked ? "true" : "false")}
              className="h-4 w-4 rounded border-gray-300 text-emerald-600"
            />
            {t("开启")}
          </label>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={ACTIVITY_INPUT_CLASS}
          />
        )}
        {field.hint && <p className="text-xs text-gray-400">{field.hint}</p>}
        {requiredError && <p className="text-xs text-red-500">{t("请填写该项")}</p>}
      </div>
    );
  }

  return (
    <div className={ACTIVITY_PAGE_SHELL_CLASS}>
      <div className={ACTIVITY_PAGE_INNER_CLASS}>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t("活动图生产")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            {t("选择模板、填写内容、生成图片并完成质检归档。")}
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <StepLayout
          currentStep={step}
          steps={workflowSteps}
          onStepSelect={(targetStep) => {
            if (step > targetStep) setStep(targetStep);
          }}
          canVisitStep={(targetStep) => step === targetStep || step > targetStep}
        >
        {loading ? (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
            {t("正在加载活动图模板与模型...")}
          </div>
        ) : (
          <>
            {step === 1 && (
              <section className={ACTIVITY_SECTION_CARD_CLASS}>
                {drafts.length > 0 && (
                  <div className="mb-5 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="text-sm text-amber-700">
                      {t("你有")} {drafts.length} {t("个未完成的草稿批次")}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleResumeDraft(drafts[0])}
                      className="text-sm text-amber-600 underline hover:text-amber-800"
                    >
                      {t("继续上次")}
                    </button>
                  </div>
                )}

                <WorkflowStepHeader
                  step={1}
                  title={t("选模板")}
                  description={t("点击模板卡片即选中，无需额外确认。")}
                />

                <div className="mb-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTypeId(null)}
                    className={getActivityTemplateTypeTabClasses(activeTypeId === null)}
                  >
                    {t("全部")}
                  </button>
                  {types.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setActiveTypeId(type.id)}
                      className={getActivityTemplateTypeTabClasses(activeTypeId === type.id)}
                    >
                      {t(type.name)}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTemplates.map((template) => {
                    const selected = state.selectedTemplate?.id === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => selectTemplate(template)}
                        className={getActivityTemplateCardClasses(selected)}
                      >
                        <div className="text-xs font-semibold text-emerald-600">{template.template_no}</div>
                        <div className="mt-1 text-lg font-semibold text-gray-900">
                          {getTemplateDisplayName(template, lang)}
                        </div>
                        <div className="mt-4 text-sm leading-6 text-gray-500">
                          <div className="font-medium text-gray-600">{t("使用场景：")}</div>
                          <div>{getTemplateDisplayScenario(template, lang) || t("暂无使用场景描述")}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-500">
                    {state.selectedTemplate
                      ? `${t("已选：")} ${state.selectedTemplate.template_no} ${getTemplateDisplayName(state.selectedTemplate, lang)}`
                      : t("请选择一个模板")}
                  </div>
                  <button
                    type="button"
                    disabled={!state.selectedTemplate}
                    onClick={() => setStep(2)}
                    className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {t("下一步")}
                  </button>
                </div>
              </section>
            )}

            {step === 2 && state.selectedTemplate && (
              <section className={ACTIVITY_SECTION_CARD_CLASS}>
                <WorkflowStepHeader
                  step={2}
                  title={t("填写内容")}
                  description={t("填写变量内容、投放尺寸和参考素材。")}
                />
                <div className="mb-5">
                  <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm text-gray-600">
                    {t("当前模板：")}{state.selectedTemplate.template_no} {getTemplateDisplayName(state.selectedTemplate, lang)}
                  </div>
                  <p className="mt-3 text-sm text-gray-500">
                    {t("使用场景：")}{getTemplateDisplayScenario(state.selectedTemplate, lang) || t("暂无使用场景描述")}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">{selectedFields.map(renderField)}</div>

                <div className="mt-6 flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-700">{t("投放尺寸")}</label>
                  <div className="flex flex-wrap gap-3">
                    {ACTIVITY_AD_SIZES.map((size) => (
                      <button
                        key={size.value}
                        type="button"
                        onClick={() => updateAdSize(size.value)}
                        className={`rounded-lg border px-4 py-3 text-left text-sm transition ${
                          state.adSize === size.value
                            ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-700"
                            : "border-gray-200 bg-white text-gray-600 hover:border-emerald-400"
                        }`}
                      >
                        {size.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-4">
                  <RefImageSelector
                    title={t("角色参考图")}
                    refKey="character"
                    defaultCategory="expression"
                    allowCategorySwitch={true}
                    selectedAssetId={state.referenceImages.character}
                    onSelect={(assetId) =>
                      setState((current) => ({
                        ...resetGeneratedResult(current),
                        referenceImages: {
                          ...current.referenceImages,
                          character: assetId,
                        },
                      }))
                    }
                  />
                  <p className="text-xs text-gray-500">{t("背景图库中的素材均可直接选用，如需新背景可前往背景图生成工作流制作后入库")}</p>
                  <RefImageSelector
                    title={t("背景参考图")}
                    refKey="background"
                    defaultCategory="background"
                    allowCategorySwitch={false}
                    selectedAssetId={state.referenceImages.background}
                    onSelect={(assetId) =>
                      setState((current) => ({
                        ...resetGeneratedResult(current),
                        referenceImages: {
                          ...current.referenceImages,
                          background: assetId,
                        },
                      }))
                    }
                  />
                  <RefImageSelector
                    title={t("关键道具")}
                    refKey="props"
                    defaultCategory="props"
                    allowCategorySwitch={false}
                    selectedAssetId={state.referenceImages.props}
                    onSelect={(assetId) =>
                      setState((current) => ({
                        ...resetGeneratedResult(current),
                        referenceImages: {
                          ...current.referenceImages,
                          props: assetId,
                        },
                      }))
                    }
                  />
                </div>

                <details className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-700">{t("出图指令预览")}</summary>
                  <p className="mt-3 text-xs text-gray-500">{t("实际指令由系统生成，此处仅供参考。")}</p>
                  <pre className="mt-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
                    {promptPreview}
                  </pre>
                </details>

                <div className="mt-5 flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
                    {t("上一步")}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(validationError)}
                    onClick={() => setStep(3)}
                    className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {t("下一步")}
                  </button>
                </div>
              </section>
            )}

            {step === 3 && state.selectedTemplate && (
              <section className={ACTIVITY_SECTION_CARD_CLASS}>
                <WorkflowStepHeader
                  step={3}
                  title={t("生成图片")}
                  description={t("配置本批次的模型、数量和辅助词，生成后进入批量质检。")}
                />

                <div className={ACTIVITY_PANEL_CLASS}>
                  <div className="grid gap-5">
                    <ModelSelector
                      models={finalModels}
                      value={state.modelConfigId}
                      onChange={(id) => updateModelConfig(id || null)}
                    />

                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-gray-700">{t("生成数量")}</span>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => {
                              const configs = Array.from(
                                { length: count },
                                (_, index) => state.imageConfigs[index] ?? { extraPrompt: "" },
                              );
                              setState((current) => ({
                                ...resetGeneratedResult(current),
                                imageConfigs: configs,
                              }));
                            }}
                            className={`h-10 w-10 rounded-lg border text-sm font-medium transition ${
                              state.imageConfigs.length === count
                                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                : "border-gray-200 text-gray-500 hover:border-emerald-400"
                            }`}
                          >
                            {count}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="block">
                      <span className="text-sm font-medium text-gray-700">{t("全局辅助词（可选）")}</span>
                      <input
                        type="text"
                        value={state.globalExtraPrompt}
                        onChange={(event) =>
                          setState((current) => ({
                            ...resetGeneratedResult(current),
                            globalExtraPrompt: event.target.value,
                          }))
                        }
                        placeholder={t("适用于所有图片")}
                        className={ACTIVITY_INPUT_CLASS}
                      />
                    </label>

                    {state.imageConfigs.length > 1 && (
                      <div className="flex flex-col gap-2">
                        <span className="text-sm font-medium text-gray-700">{t("每张图辅助词（可选）")}</span>
                        {state.imageConfigs.map((config, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="w-10 shrink-0 text-xs text-gray-400">{t("图片")} {index + 1}</span>
                            <input
                              type="text"
                              value={config.extraPrompt}
                              onChange={(event) => {
                                const configs = [...state.imageConfigs];
                                configs[index] = { ...configs[index], extraPrompt: event.target.value };
                                setState((current) => ({
                                  ...resetGeneratedResult(current),
                                  imageConfigs: configs,
                                }));
                              }}
                              placeholder={t("留空则使用全局辅助词")}
                              className={ACTIVITY_INPUT_CLASS}
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <GenerateButton
                      onClick={handleGenerate}
                      loading={generating}
                      disabled={generating || !state.modelConfigId}
                      loadingLabel={t("正在生成...")}
                      className="w-full"
                    />

                    {generating && (
                      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <span className="text-sm text-gray-600">{t("正在生成，请稍候...")}</span>
                        <div className="flex flex-wrap gap-3">
                          {state.imageConfigs.map((_, index) => (
                            <div key={index} className="flex flex-col items-center gap-1">
                              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-gray-200 bg-gray-100">
                                <span className="text-xs text-gray-400">{t("图")} {index + 1}</span>
                              </div>
                              <span className="text-xs text-gray-400">{t("生成中")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {state.batchImages.length > 0 && (
                      <div className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="mb-3 text-sm font-medium text-gray-700">{t("最近生成批次")}</div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {state.batchImages.map((image) => (
                            <button key={image.id} type="button" onClick={() => setPreviewUrl(image.imageUrl)}>
                              <img
                                src={absoluteUrl(image.imageUrl)}
                                alt={t("批次生成结果")}
                                className="aspect-square w-full rounded-lg border border-gray-200 object-cover"
                              />
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setStep(4)}
                          className={`${ACTIVITY_SECONDARY_BUTTON_CLASS} mt-4`}
                        >
                          {t("去质检归档")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 flex justify-between">
                  <button type="button" onClick={() => setStep(2)} className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
                    {t("上一步")}
                  </button>
                  <button
                    type="button"
                    disabled={state.batchImages.length === 0}
                    onClick={() => setStep(4)}
                    className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                  >
                    {t("下一步")}
                  </button>
                </div>
              </section>
            )}

            {step === 4 && (
              <section className={ACTIVITY_SECTION_CARD_CLASS}>
                <WorkflowStepHeader
                  step={4}
                  title={t("质检归档")}
                  description={t("整批共用质检项，单张图片可归档、精修或删除。")}
                  actions={
                    state.batchImages.length > 0 ? (
                      <div className="text-xs text-gray-400">
                        {handledImageCount} / {state.batchImages.length} {t("已处理")}
                      </div>
                    ) : null
                  }
                />

                <div className="grid gap-5">
                  <div className="rounded-xl border border-gray-200 bg-white p-4">
                    <h3 className="mb-3 text-sm font-medium text-gray-700">{t("质检（整批共用）")}</h3>
                    <p className="mb-3 text-xs text-gray-400">{t("只需3秒判断，任一不满足请直接废图重出")}</p>
                    {[
                      { key: "reward_visible", label: t("奖励是否一眼可见") },
                      { key: "action_clear", label: t("行动路径是否清晰（知道要点哪里）") },
                      { key: "character_consistent", label: t("角色与品牌是否一致（还是那只牛）") },
                    ].map((item) => (
                      <label key={item.key} className="mb-2 flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={state.qc[item.key as keyof WorkflowState["qc"]]}
                          onChange={(event) =>
                            setState((current) => ({
                              ...current,
                              qc: {
                                ...current.qc,
                                [item.key]: event.target.checked,
                              },
                            }))
                          }
                          className="h-4 w-4 accent-emerald-500"
                        />
                      <span className="text-sm text-gray-600">{item.label}</span>
                    </label>
                    ))}
                  </div>

                  {visibleBatchImages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
                      {t("暂无待处理图片")}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {visibleBatchImages.map((image) => (
                        <div key={image.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                          <div className="relative">
                            <img
                              src={absoluteUrl(image.imageUrl)}
                              className="aspect-square w-full cursor-pointer object-cover"
                              alt={t("批次活动图")}
                              onClick={() => setPreviewUrl(image.imageUrl)}
                            />
                            {image.status === "archived" && (
                              <div className="absolute top-2 right-2 rounded-full bg-emerald-500 px-2 py-0.5 text-xs text-white">
                              {t("已归档")}
                            </div>
                            )}
                          </div>

                          <div className="flex flex-col gap-2 p-3">
                            <div className="flex items-center justify-between text-xs text-gray-400">
                              <span>{t("图")} {image.sortOrder + 1}</span>
                              <span>${image.costUsd.toFixed(4)} · {image.tokenUsed || "-"} token</span>
                            </div>

                            {image.status === "archived" ? (
                              <span className="text-center text-xs text-emerald-600">{t("已归档")}</span>
                            ) : refiningImageId === image.id ? (
                              <div className="flex flex-col gap-2">
                                <input
                                  type="text"
                                  value={refinePromptInput}
                                  onChange={(event) => setRefinePromptInput(event.target.value)}
                                  placeholder={t("输入精修词，如：增加光效")}
                                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                                  autoFocus
                                />
                                <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleRefine(image.id)}
                                  disabled={!refinePromptInput.trim() || refiningLoading}
                                  className="flex-1 rounded bg-emerald-500 px-2 py-1 text-xs text-white disabled:opacity-40"
                                >
                                  {refiningLoading ? t("生成中…") : t("重新生成")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefiningImageId(null);
                                    setRefinePromptInput("");
                                  }}
                                  disabled={refiningLoading}
                                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 disabled:opacity-40"
                                >
                                  {t("取消")}
                                </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleArchiveImage(image.id)}
                                  disabled={!allQcPassed || archivingId === image.id}
                                  className="flex-1 rounded bg-emerald-500 px-2 py-1 text-xs text-white disabled:opacity-40"
                                >
                                  {archivingId === image.id ? t("归档中...") : t("归档")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRefiningImageId(image.id);
                                    setRefinePromptInput("");
                                  }}
                                  disabled={visibleBatchImages.length >= 8}
                                  className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 disabled:opacity-40"
                                >
                                  {t("精修")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteImage(image.id)}
                                  disabled={deletingId === image.id}
                                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
                                >
                                  {t("删除")}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={savingDraft || !state.batchId}
                      className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                    >
                      {savingDraft ? t("保存中...") : t("存为草稿")}
                    </button>

                    {state.batchStatus === "completed" && (
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-emerald-600">{t("本批次已全部处理完成")}</span>
                        <button
                          type="button"
                          onClick={handleContinueProduction}
                          className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                        >
                          {t("继续生产")}
                        </button>
                        <Link href="/workbench/gallery" className="text-sm text-emerald-600 underline">
                          {t("查看图库")}
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
        </StepLayout>

        {previewUrl && (
          <button
            type="button"
            onClick={() => setPreviewUrl("")}
            className="fixed inset-0 z-50 flex items-center justify-center bg-white/95 p-6"
          >
            <img src={absoluteUrl(previewUrl)} alt={t("活动图全屏预览")} className="max-h-full max-w-full object-contain" />
          </button>
        )}
      </div>
    </div>
  );
}
