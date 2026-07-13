// @ts-nocheck
"use client";

import Link from "next/link";
import { ChangeEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import PageHeader from "@workbench/components/common/PageHeader";
import GenerateButton from "@workbench/components/workflow/GenerateButton";
import ModelSelector from "@workbench/components/workflow/ModelSelector";
import { useLanguage } from "@workbench/lib/LanguageContext";
import { apiGet, apiPost, apiUpload, workbenchStaticUrl } from "@workbench/lib/api";
import {
  ACTIVITY_INPUT_CLASS,
  ACTIVITY_PAGE_INNER_CLASS,
  ACTIVITY_PAGE_SHELL_CLASS,
  ACTIVITY_PANEL_CLASS,
  ACTIVITY_PRIMARY_BUTTON_CLASS,
  ACTIVITY_SECONDARY_BUTTON_CLASS,
  ACTIVITY_SECTION_CARD_CLASS,
} from "@workbench/lib/activity-workflow-theme";
import type { Asset } from "@workbench/lib/types";
import { isImageGenerationModel, resolveSelectedModelId, type AvailableExpressionModel } from "@workbench/lib/expression-workflow";

const GENERATION_TIMEOUT_MS = 660000;
const MAX_REFERENCE_UPLOADS = 4;
const GENERATION_COUNT_OPTIONS = [1, 2, 3, 4] as const;
const SIZE_OPTIONS = [
  { value: "1024x1024", label: "1024×1024（方图）" },
  { value: "1536x1024", label: "1536×1024（横图）" },
  { value: "1024x1536", label: "1024×1536（竖图）" },
];

interface MultiFusionImage {
  id: number;
  job_id: number;
  image_url?: string | null;
  thumbnail_url?: string | null;
}

interface MultiFusionJob {
  id: number;
  prompt: string;
  size: string;
  count: number;
  reference_asset_ids: number[];
  status: string;
  session_id?: number | null;
  model_config_id?: number | null;
  images: MultiFusionImage[];
}

interface ModelConfig {
  id: number;
  name: string;
  provider: string;
  model_name?: string;
  price_per_image: number | string;
  usage_type: string;
}

interface WorkflowSessionRecord {
  state_json?: string | null;
}

function absoluteUrl(url?: string | null) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return "";
  if (safeUrl.startsWith("http://") || safeUrl.startsWith("https://") || safeUrl.startsWith("blob:")) {
    return safeUrl;
  }
  return workbenchStaticUrl(safeUrl);
}

function parseSessionState(stateJson?: string | null): Record<string, unknown> {
  try {
    return stateJson ? JSON.parse(stateJson) : {};
  } catch {
    return {};
  }
}

function MultiFusionWorkflowPageInner() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session_id");

  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [count, setCount] = useState(1);
  const [referenceAssets, setReferenceAssets] = useState<Asset[]>([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);

  const [availableModels, setAvailableModels] = useState<ModelConfig[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelConfigId, setModelConfigId] = useState<number | null>(null);
  const [modelSelectionWarning, setModelSelectionWarning] = useState("");

  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<MultiFusionJob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [regeneratingImageId, setRegeneratingImageId] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const hasReferenceAssets = referenceAssets.length > 0;

  useEffect(() => {
    void loadAvailableModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasReferenceAssets]);

  useEffect(() => {
    if (!sessionIdParam) return;
    void restoreSession(Number(sessionIdParam));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdParam]);

  async function fetchAvailableModels(mode?: "refine") {
    const res = await apiGet<ModelConfig[]>(
      `/api/multi-fusion/available-models${mode ? `?mode=${mode}` : ""}`,
    );
    if (res.code !== 0) {
      throw new Error(res.msg || t("多图融合模型加载失败"));
    }
    return Array.isArray(res.data)
      ? res.data.filter((model) => isImageGenerationModel(model as AvailableExpressionModel))
      : [];
  }

  async function loadAvailableModels() {
    setLoadingModels(true);
    try {
      const mode = hasReferenceAssets ? "refine" : undefined;
      const allModels = await fetchAvailableModels(mode);
      setAvailableModels(allModels);
      const resolvedId =
        Number(resolveSelectedModelId(allModels as AvailableExpressionModel[], modelConfigId) || "") || null;
      const nextSelectedModelId = resolvedId ?? allModels[0]?.id ?? null;
      setModelConfigId(nextSelectedModelId);
      if (modelConfigId != null && nextSelectedModelId != null && modelConfigId !== nextSelectedModelId) {
        setModelSelectionWarning(t("已选模型不支持参考图，已自动切换"));
      } else {
        setModelSelectionWarning("");
      }
    } catch (err) {
      setAvailableModels([]);
      setModelConfigId(null);
      setError(err instanceof Error ? err.message : t("多图融合模型加载失败"));
    } finally {
      setLoadingModels(false);
    }
  }

  async function refreshJob(nextJobId: number) {
    const res = await apiGet<MultiFusionJob>(`/api/multi-fusion/jobs/${nextJobId}`);
    if (res.code !== 0 || !res.data) {
      throw new Error(res.msg || t("多图融合任务加载失败"));
    }
    setJob(res.data);
    setPrompt(res.data.prompt || "");
    setSize(res.data.size || "1024x1024");
    setCount(res.data.count || 1);
    if (res.data.model_config_id) {
      setModelConfigId(res.data.model_config_id);
    }
    return res.data;
  }

  async function restoreSession(sessionId: number) {
    setRestoring(true);
    setError("");
    try {
      const sessionRes = await apiGet<WorkflowSessionRecord>(`/api/workflow-sessions/${sessionId}`);
      if (sessionRes.code !== 0 || !sessionRes.data) {
        throw new Error(sessionRes.msg || t("Session 恢复失败"));
      }
      const state = parseSessionState(sessionRes.data.state_json);
      const restoredJobId = Number(state.job_id || 0);
      if (!restoredJobId) {
        throw new Error(t("Session 中缺少 job_id"));
      }
      setJobId(restoredJobId);
      await refreshJob(restoredJobId);

      const assetIds = Array.isArray(state.reference_asset_ids)
        ? state.reference_asset_ids.map((item) => Number(item)).filter((item) => item > 0)
        : [];
      if (assetIds.length > 0) {
        const assetsRes = await apiGet<Asset[]>("/api/assets");
        if (assetsRes.code === 0 && Array.isArray(assetsRes.data)) {
          const selected = assetsRes.data.filter((asset) => assetIds.includes(asset.id));
          setReferenceAssets(selected);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Session 恢复失败"));
    } finally {
      setRestoring(false);
    }
  }

  async function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const remaining = Math.max(MAX_REFERENCE_UPLOADS - referenceAssets.length, 0);
    const uploadFiles = files.slice(0, remaining);
    if (uploadFiles.length === 0) {
      setError(`${t("参考图最多 4 张，当前已上传")} ${referenceAssets.length} ${t("张")}`);
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
        formData.append("category", "multi_fusion");
        formData.append("tags", "multi-fusion-reference,参考图");
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

  async function ensureJob(): Promise<number> {
    if (jobId) return jobId;

    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt.length < 2) {
      throw new Error(t("请填写融合提示词（至少 2 个字符）"));
    }
    if (referenceAssets.length < 1) {
      throw new Error(t("请至少上传 1 张参考图"));
    }
    if (!modelConfigId) {
      throw new Error(t("请选择生成模型"));
    }

    const res = await apiPost<MultiFusionJob>("/api/multi-fusion/jobs/create", {
      prompt: trimmedPrompt,
      size,
      count,
      reference_asset_ids: referenceAssets.map((asset) => asset.id),
      model_config_id: modelConfigId,
    });
    if (res.code !== 0 || !res.data) {
      throw new Error(res.msg || t("创建多图融合任务失败"));
    }
    setJobId(res.data.id);
    setJob(res.data);
    return res.data.id;
  }

  async function handleGenerate() {
    setGenerating(true);
    setError("");
    setMessage("");
    try {
      const nextJobId = await ensureJob();
      if (!modelConfigId) {
        throw new Error(t("请选择生成模型"));
      }
      const res = await apiPost<MultiFusionJob>(
        `/api/multi-fusion/jobs/${nextJobId}/generate`,
        {
          model_config_id: modelConfigId,
          reference_asset_ids: referenceAssets.map((asset) => asset.id),
          count,
        },
        GENERATION_TIMEOUT_MS,
      );
      if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || t("多图融合生成失败"));
      }
      setJob(res.data);
      setMessage(t("多图融合生成完成"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("多图融合生成失败"));
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerateImage(imageId: number) {
    if (!jobId || !modelConfigId) return;
    setRegeneratingImageId(imageId);
    setError("");
    setMessage("");
    try {
      const res = await apiPost<MultiFusionJob>(
        `/api/multi-fusion/jobs/${jobId}/generate`,
        {
          model_config_id: modelConfigId,
          reference_asset_ids: referenceAssets.map((asset) => asset.id),
          count: 1,
          regenerate_image_id: imageId,
        },
        GENERATION_TIMEOUT_MS,
      );
      if (res.code !== 0 || !res.data) {
        throw new Error(res.msg || t("重新生成失败"));
      }
      setJob(res.data);
      setMessage(t("已重新生成该图片"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("重新生成失败"));
    } finally {
      setRegeneratingImageId(null);
    }
  }

  const resultImages = job?.images || [];

  return (
    <div className={ACTIVITY_PAGE_SHELL_CLASS}>
      <div className={ACTIVITY_PAGE_INNER_CLASS}>
        <PageHeader
          title={t("多图融合")}
          description={t("上传 2–4 张参考图，填写融合提示词，选择 gpt-image 系列模型生成合成结果。")}
        />

        <div className="flex flex-wrap gap-3">
          <Link href="/workbench/workflows" className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
            {t("返回任务列表")}
          </Link>
          <Link href="/workbench/assets" className={ACTIVITY_SECONDARY_BUTTON_CLASS}>
            {t("打开素材库")}
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        {message && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}
        {restoring && (
          <div className={ACTIVITY_PANEL_CLASS}>
            <p className="text-sm text-gray-500">{t("正在恢复多图融合 session…")}</p>
          </div>
        )}

        <section className={ACTIVITY_SECTION_CARD_CLASS}>
          <h2 className="text-lg font-semibold text-gray-900">{t("参考图")}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {t("最多 4 张。上传参考图后，生成模型将自动限制为支持参考图模式的模型（gpt-image 系列），不支持参考图的模型（如 Gemini）将被过滤。")}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
              {uploadingReferences ? t("上传中…") : t("上传参考图")}
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleReferenceUpload} />
            </label>
            <span className="text-xs text-gray-500">
              {referenceAssets.length}/{MAX_REFERENCE_UPLOADS} {t("张参考图")}
            </span>
          </div>

          {referenceAssets.length > 0 && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {referenceAssets.map((asset, index) => (
                <div key={asset.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <div className="bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                    {t("图")}{index + 1}
                  </div>
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
        </section>

        <section className={ACTIVITY_SECTION_CARD_CLASS}>
          <h2 className="text-lg font-semibold text-gray-900">{t("融合提示词")}</h2>
          <p className="mt-1 text-sm text-gray-500">
            {t("建议明确说明每张参考图的作用，例如：图1是人物，图2是背景，将图1人物自然融入图2场景。")}
          </p>
          <textarea
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("描述如何融合多张参考图…")}
            className={`${ACTIVITY_INPUT_CLASS} mt-4 min-h-[120px]`}
          />
        </section>

        <section className={ACTIVITY_SECTION_CARD_CLASS}>
          <h2 className="text-lg font-semibold text-gray-900">{t("生成参数")}</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <ModelSelector
              models={availableModels}
              value={modelConfigId}
              onChange={setModelConfigId}
              loading={loadingModels}
              label={t("生成模型")}
              loadingText={t("正在加载模型…")}
            />
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("输出尺寸")}</span>
              <select
                value={size}
                onChange={(event) => setSize(event.target.value)}
                className={`${ACTIVITY_INPUT_CLASS} mt-1`}
              >
                {SIZE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("生成数量")}</span>
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value) || 1)}
                className={`${ACTIVITY_INPUT_CLASS} mt-1`}
              >
                {GENERATION_COUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option} {t("张")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {modelSelectionWarning && (
            <p className="mt-2 text-xs text-amber-700">{modelSelectionWarning}</p>
          )}
          {!hasReferenceAssets && (
            <p className="mt-2 text-xs text-gray-500">{t("上传参考图后将自动筛选支持参考图模式的模型")}</p>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <GenerateButton
            onClick={handleGenerate}
            loading={generating}
            disabled={generating || referenceAssets.length < 1 || !prompt.trim() || !modelConfigId}
            label={t("开始融合生成")}
            loadingLabel={t("生成中…")}
          />
          {jobId && <span className="text-sm text-gray-500">{t("任务 ID")}: {jobId}</span>}
        </div>

        {resultImages.length > 0 && (
          <section className={ACTIVITY_SECTION_CARD_CLASS}>
            <h2 className="text-lg font-semibold text-gray-900">{t("生成结果")}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {resultImages.map((image) => (
                <div key={image.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                  <img
                    src={absoluteUrl(image.image_url || image.thumbnail_url)}
                    alt={`fusion-${image.id}`}
                    className="aspect-square w-full object-cover"
                  />
                  <div className="flex flex-wrap gap-2 p-3">
                    <a
                      href={absoluteUrl(image.image_url || image.thumbnail_url)}
                      target="_blank"
                      rel="noreferrer"
                      className={ACTIVITY_SECONDARY_BUTTON_CLASS}
                    >
                      {t("查看原图")}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleRegenerateImage(image.id)}
                      disabled={regeneratingImageId === image.id}
                      className={ACTIVITY_PRIMARY_BUTTON_CLASS}
                    >
                      {regeneratingImageId === image.id ? t("重新生成中…") : t("重新生成")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default function MultiFusionWorkflowPage() {
  const { t } = useLanguage();
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">{t("多图融合工作流加载中…")}</div>}>
      <MultiFusionWorkflowPageInner />
    </Suspense>
  );
}
