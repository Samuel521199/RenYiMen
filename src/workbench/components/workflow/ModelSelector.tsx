"use client";

import { useEffect, useMemo } from "react";

import { ACTIVITY_INPUT_CLASS } from "@workbench/lib/activity-workflow-theme";
import { isImageGenerationModel, resolveSelectedModelId, type AvailableExpressionModel } from "@workbench/lib/expression-workflow";

interface ModelConfig {
  id: number;
  name: string;
  provider: string;
  model_name?: string;
  price_per_image?: number | string | null;
  usage_type?: string | null;
}

interface ModelSelectorProps {
  models: ModelConfig[];
  value: number | null;
  onChange: (id: number) => void;
  loading?: boolean;
  showPrice?: boolean;
  disabled?: boolean;
  label?: string;
  loadingText?: string;
}

function modelPrice(model: ModelConfig) {
  return Number(model.price_per_image || 0);
}

export default function ModelSelector({
  models,
  value,
  onChange,
  loading = false,
  showPrice = true,
  disabled = false,
  label = "模型选择",
  loadingText = "正在加载模型…",
}: ModelSelectorProps) {
  const imageModels = useMemo(
    () =>
      (Array.isArray(models) ? models : []).filter((model) =>
        isImageGenerationModel(model as AvailableExpressionModel),
      ),
    [models],
  );
  const resolvedValue = useMemo(() => {
    const picked = resolveSelectedModelId(imageModels as AvailableExpressionModel[], value);
    return picked ? Number(picked) : null;
  }, [imageModels, value]);
  const selectedModel = imageModels.find((model) => model.id === resolvedValue) || null;

  useEffect(() => {
    if (loading || imageModels.length === 0) return;
    if (resolvedValue != null && resolvedValue !== value) {
      onChange(resolvedValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync invalid external value once models load
  }, [imageModels, loading, resolvedValue, value]);

  return (
    <div className="grid gap-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <select
          value={resolvedValue ?? ""}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          disabled={loading || disabled || imageModels.length === 0}
          className={ACTIVITY_INPUT_CLASS}
        >
          <option value="">{imageModels.length === 0 ? "暂无可用模型" : "请选择模型"}</option>
          {imageModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>

      {showPrice && selectedModel && (
        <p className="text-sm text-gray-500">
          {selectedModel.provider} · ${modelPrice(selectedModel).toFixed(4)}
        </p>
      )}

      {loading && <p className="text-sm text-gray-500">{loadingText}</p>}
    </div>
  );
}
