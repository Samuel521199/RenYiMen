import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVITY_AD_SIZES, ASSET_CATEGORIES } from "./constants.ts";
import type { AssetCategory } from "./types.ts";

const typedAssetCategories: AssetCategory[] = ASSET_CATEGORIES.map((category) => category.value as AssetCategory);

test("asset category type covers all configured asset categories", () => {
  assert.deepEqual(typedAssetCategories, [
    "bull_reference",
    "expression",
    "action",
    "game_content",
    "holiday",
    "hot_topic",
    "background",
    "props",
  ]);
});

test("activity ad size constants expose FB square and TikTok vertical sizes", () => {
  assert.deepEqual(ACTIVITY_AD_SIZES, [
    { value: "1080x1080", label: "1080×1080（FB 方图）" },
    { value: "1080x1920", label: "1080×1920（TikTok 竖图）" },
  ]);
});
