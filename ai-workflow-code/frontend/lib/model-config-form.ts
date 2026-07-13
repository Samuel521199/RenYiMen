import type { ModelProvider } from "./types";

export type ModelUsageType = "draft" | "final" | "both";

export interface ModelConfigFormState {
  name: string;
  provider: ModelProvider;
  model_name: string;
  usage_type: ModelUsageType;
  api_key: string;
  base_url: string;
  price_per_image: string;
  daily_limit: string;
}

export interface ModelConfigFormModel {
  name: string;
  provider: ModelProvider | string;
  model_name: string;
  usage_type?: ModelUsageType | string | null;
  base_url?: string | null;
  price_per_image: number | string;
  daily_limit: number | string;
}

export const emptyModelConfigForm: ModelConfigFormState = {
  name: "",
  provider: "openai",
  model_name: "gpt-image-1",
  usage_type: "both",
  api_key: "",
  base_url: "",
  price_per_image: "0",
  daily_limit: "0",
};

export function modelConfigToFormState(model: ModelConfigFormModel): ModelConfigFormState {
  return {
    name: model.name,
    provider: model.provider as ModelProvider,
    model_name: model.model_name,
    usage_type: (model.usage_type || "both") as ModelUsageType,
    api_key: "",
    base_url: model.base_url || "",
    price_per_image: String(model.price_per_image ?? 0),
    daily_limit: String(model.daily_limit ?? 0),
  };
}

export function buildModelConfigCreatePayload(form: ModelConfigFormState) {
  return {
    name: form.name.trim(),
    provider: form.provider,
    model_name: form.model_name.trim(),
    usage_type: form.usage_type,
    api_key: form.api_key.trim(),
    base_url: form.base_url.trim() || null,
    price_per_image: Number(form.price_per_image || 0),
    daily_limit: Number(form.daily_limit || 0),
  };
}

export function buildModelConfigUpdatePayload(form: ModelConfigFormState) {
  const payload: Omit<ReturnType<typeof buildModelConfigCreatePayload>, "api_key"> & {
    api_key?: string;
  } = {
    ...buildModelConfigCreatePayload(form),
  };

  if (!payload.api_key) {
    delete payload.api_key;
  }

  return payload;
}
