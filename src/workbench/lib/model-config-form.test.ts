import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelConfigUpdatePayload,
  modelConfigToFormState,
} from "./model-config-form.ts";

const existingModel = {
  id: 7,
  name: "Primary Image",
  provider: "google",
  model_name: "gemini-2.5-flash-image",
  usage_type: "final",
  api_key: "abcd",
  base_url: "https://generativelanguage.googleapis.com",
  price_per_image: "0.012345",
  daily_limit: "25.5",
  used_today: "3",
  active: true,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-02T00:00:00Z",
};

test("prefills edit form fields from the selected model", () => {
  assert.deepEqual(modelConfigToFormState(existingModel), {
    name: "Primary Image",
    provider: "google",
    model_name: "gemini-2.5-flash-image",
    usage_type: "final",
    api_key: "",
    base_url: "https://generativelanguage.googleapis.com",
    price_per_image: "0.012345",
    daily_limit: "25.5",
  });
});

test("builds update payload without api_key when the edit key field is blank", () => {
  assert.deepEqual(
    buildModelConfigUpdatePayload({
      name: " Updated Image ",
      provider: "openai",
      model_name: " gpt-image-1 ",
      usage_type: "draft",
      api_key: "   ",
      base_url: "  ",
      price_per_image: "0.04",
      daily_limit: "0",
    }),
    {
      name: "Updated Image",
      provider: "openai",
      model_name: "gpt-image-1",
      usage_type: "draft",
      base_url: null,
      price_per_image: 0.04,
      daily_limit: 0,
    },
  );
});

test("includes api_key when the edit key field has a new value", () => {
  assert.equal(
    buildModelConfigUpdatePayload({
      name: "Updated Image",
      provider: "openai",
      model_name: "gpt-image-1",
      usage_type: "both",
      api_key: "sk-new-secret",
      base_url: "https://api.openai.com/v1",
      price_per_image: "0.04",
      daily_limit: "100",
    }).api_key,
    "sk-new-secret",
  );
});
