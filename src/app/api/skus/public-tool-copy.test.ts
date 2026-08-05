import assert from "node:assert/strict";
import test from "node:test";

import { GET as getSkuCatalog } from "./route";

const NEW_TOOL_SKU_IDS = [
  "LOCAL_AUTO_SUBTITLES",
  "BAILIAN_WAN27_CAMERA_REPLICATION",
  "BAILIAN_WAN27_EFFECT_REPLICATION",
  "BAILIAN_WAN27_VIDEO_CONTINUATION",
] as const;

const PUBLIC_COPY_KEYS = new Set([
  "displayName",
  "displayNameEn",
  "title",
  "titleEn",
  "description",
  "descriptionEn",
  "label",
  "labelEn",
  "placeholder",
  "placeholderEn",
  "enumNames",
]);

const FORBIDDEN_VENDOR_OR_MODEL_NAME =
  /阿里(?:云)?百炼|Alibaba(?: Cloud)? Model Studio|DashScope|通义万相|万相\s*\d|Wan\s*\d|wan\d|HappyHorse|GPT-image-\d|Kling/i;

function collectPublicCopy(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectPublicCopy);
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => {
    if (PUBLIC_COPY_KEYS.has(key)) {
      if (typeof nestedValue === "string") return [nestedValue];
      if (Array.isArray(nestedValue)) {
        return nestedValue.filter((item): item is string => typeof item === "string");
      }
      return [];
    }
    return collectPublicCopy(nestedValue);
  });
}

test("new tools keep vendor and exact model names out of public copy", async () => {
  const body = await (await getSkuCatalog()).json() as {
    skus: Array<Record<string, unknown> & { skuId: string }>;
  };

  for (const skuId of NEW_TOOL_SKU_IDS) {
    const sku = body.skus.find((item) => item.skuId === skuId);
    assert.ok(sku, `missing catalog entry for ${skuId}`);

    const publicCopy = collectPublicCopy(sku).join("\n");
    assert.ok(publicCopy.trim().length > 0, `missing public copy for ${skuId}`);
    assert.doesNotMatch(publicCopy, FORBIDDEN_VENDOR_OR_MODEL_NAME, skuId);
  }
});

test("removed video detail editing tool is absent from the catalog", async () => {
  const body = await (await getSkuCatalog()).json() as {
    skus: Array<{ skuId: string }>;
  };

  assert.equal(
    body.skus.some((item) => item.skuId === "BAILIAN_HAPPYHORSE_VIDEO_EDIT"),
    false,
  );
});
