// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import PageHeader from "@workbench/components/common/PageHeader";
import ImageGrid from "@workbench/components/image/ImageGrid";
import TaskStatusBadge from "@workbench/components/tasks/TaskStatusBadge";
import { apiGet, apiPost } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import type { ModelProvider, Task, TaskImage } from "@workbench/lib/types";

interface TaskDetail extends Task {
  images?: TaskImage[];
}

interface AvailableModel {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  active: boolean;
}

interface GenerateResponse {
  task_id: number;
  model_provider: string;
  model_name: string;
  images: Array<{ image_id?: number; id?: number; url?: string; image_url?: string; type?: string }>;
  token_used: number;
  cost_usd: number;
}

function formatMoney(value: number | string | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function normalizeGeneratedImages(response: GenerateResponse, mode: "draft" | "final"): TaskImage[] {
  const safeImages = Array.isArray(response.images) ? response.images : [];
  const imageCost = Number(response.cost_usd || 0) / Math.max(safeImages.length, 1);

  return safeImages.reduce<TaskImage[]>((items, image, index) => {
    const url = image.url || image.image_url;
    if (!url) return items;

    items.push({
      id: Number(image.image_id || image.id || Date.now() + index),
      task_id: response.task_id,
      image_url: url,
      type: mode,
      model_provider: response.model_provider as ModelProvider,
      model_name: response.model_name,
      prompt_used: "",
      token_used: response.token_used,
      cost: imageCost,
      created_at: new Date().toISOString(),
    });
    return items;
  }, []);
}

const secondaryButtonClass =
  "rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";

const primaryButtonClass =
  "rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60";

export default function TaskDetailPage() {
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const taskId = Number(params.id);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [images, setImages] = useState<TaskImage[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [pendingMode, setPendingMode] = useState<"draft" | "final" | null>(null);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<"draft" | "final" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeImages = Array.isArray(images) ? images : [];
  const safeAvailableModels = Array.isArray(availableModels) ? availableModels : [];
  const hasAvailableModels = safeAvailableModels.length > 0;

  useEffect(() => {
    let active = true;

    async function loadPageData() {
      setLoading(true);
      setError("");

      try {
        const [taskRes, modelRes] = await Promise.all([
          apiGet<TaskDetail>(`/api/tasks/${taskId}`),
          apiGet<AvailableModel[]>("/api/model-configs/available"),
        ]);
        if (!active) return;

        if (taskRes.code !== 0) {
          setError(taskRes.msg || t("任务详情加载失败"));
          return;
        }
        if (modelRes.code !== 0) {
          setError(modelRes.msg || t("可用模型加载失败"));
          return;
        }

        const nextModels = Array.isArray(modelRes.data) ? modelRes.data : [];
        setTask(taskRes.data ?? null);
        setImages(Array.isArray(taskRes.data?.images) ? taskRes.data.images : []);
        setAvailableModels(nextModels);
        setSelectedModelId((current) => current || String(nextModels[0]?.id || ""));
      } catch {
        if (active) setError(t("无法连接后端服务"));
      } finally {
        if (active) setLoading(false);
      }
    }

    if (Number.isFinite(taskId)) loadPageData();

    return () => {
      active = false;
    };
  }, [taskId]);

  function openModelSelector(mode: "draft" | "final") {
    if (!hasAvailableModels) return;
    setPendingMode(mode);
    setSelectedModelId((current) => current || String(safeAvailableModels[0]?.id || ""));
  }

  async function generateImage(mode: "draft" | "final") {
    if (!task) return;
    const selectedModel = safeAvailableModels.find((model) => model.id === Number(selectedModelId));
    if (!selectedModel) {
      setError(t("请选择可用模型"));
      return;
    }

    setGenerating(mode);
    setError("");
    setMessage("");

    try {
      const prompt = `${task.title}. ${task.description || task.purpose || ""}`.trim();
      const res = await apiPost<GenerateResponse>("/api/generate/image", {
        task_id: task.id,
        model_config_id: selectedModel.id,
        mode,
        model_provider: selectedModel.provider,
        model_name: selectedModel.model_name,
        prompt,
        size: task.size || "1080x1080",
        count: mode === "draft" ? 4 : 1,
        reference_asset_ids: [],
      });

      if (res.code !== 0) {
        setError(res.msg || t("图片生成失败"));
        return;
      }

      const generatedImages = normalizeGeneratedImages(res.data ?? {
        task_id: task.id,
        model_provider: selectedModel.provider,
        model_name: selectedModel.model_name,
        images: [],
        token_used: 0,
        cost_usd: 0,
      }, mode);
      setImages((current) => [
        ...generatedImages,
        ...(Array.isArray(current) ? current : []),
      ]);
      setPendingMode(null);
      setMessage(`${mode === "draft" ? t("草图") : t("定稿")}${t("生成请求已完成")}`);
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setGenerating(null);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
        {t("正在加载任务详情...")}
      </div>
    );
  }

  if (!task) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || t("任务不存在")}
      </div>
    );
  }

  const activeMode = pendingMode || generating;
  const draftButtonClass = activeMode === "draft" ? primaryButtonClass : secondaryButtonClass;
  const finalButtonClass = activeMode === "draft" ? secondaryButtonClass : primaryButtonClass;

  return (
    <div>
      <PageHeader
        title={task.title}
        description={`${t("任务")} #${task.id}`}
        action={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openModelSelector("draft")}
              disabled={generating !== null || !hasAvailableModels}
              className={draftButtonClass}
            >
              {!hasAvailableModels ? t("无可用模型") : generating === "draft" ? t("生成中...") : t("生成草图")}
            </button>
            <button
              type="button"
              onClick={() => openModelSelector("final")}
              disabled={generating !== null || !hasAvailableModels}
              className={finalButtonClass}
            >
              {!hasAvailableModels ? t("无可用模型") : generating === "final" ? t("生成中...") : t("生成定稿")}
            </button>
          </div>
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

      {pendingMode && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700" htmlFor="model-config">
                {t("选择模型")}
              </label>
              <select
                id="model-config"
                value={selectedModelId}
                onChange={(event) => setSelectedModelId(event.target.value)}
                className="mt-1 min-w-80 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
              >
                {safeAvailableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} / {model.model_name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => generateImage(pendingMode)}
              disabled={generating !== null || !selectedModelId}
              className={primaryButtonClass}
            >
              {generating ? t("生成中...") : `${t("确认生成")}${pendingMode === "draft" ? t("草图") : t("定稿")}`}
            </button>
            <button
              type="button"
              onClick={() => setPendingMode(null)}
              disabled={generating !== null}
              className={secondaryButtonClass}
            >
              {t("取消")}
            </button>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">{t("场景")}</p>
            <p className="mt-1 text-sm text-gray-900">{task.scene || "-"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">{t("尺寸")}</p>
            <p className="mt-1 text-sm text-gray-900">{task.size || "-"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">{t("状态")}</p>
            <div className="mt-1">
              <TaskStatusBadge status={task.status} />
            </div>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-gray-400">{t("预算")}</p>
            <p className="mt-1 text-sm text-gray-900">{formatMoney(task.budget)}</p>
          </div>
          <div className="md:col-span-2">
            <p className="text-xs font-medium uppercase text-gray-400">{t("描述")}</p>
            <p className="mt-1 text-sm leading-6 text-gray-700">
              {task.description || task.purpose || t("暂无描述")}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">{t("关联图片")}</h2>
        <ImageGrid images={safeImages} />
      </section>
    </div>
  );
}
