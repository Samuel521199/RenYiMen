"use client";

import { ACTIVITY_INPUT_CLASS } from "@/lib/activity-workflow-theme";

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
  const selectedModel = models.find((model) => model.id === value) || null;

  return (
    <div className="grid gap-3">
      <label className="block">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <select
          value={value || ""}
          onChange={(event) => onChange(Number(event.target.value) || 0)}
          disabled={loading || disabled}
          className={ACTIVITY_INPUT_CLASS}
        >
          <option value="">请选择模型</option>
          {models.map((model) => (
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
