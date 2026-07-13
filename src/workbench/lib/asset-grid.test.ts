import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_GRID_SIZE_OPTIONS,
  buildAssetCardMetaText,
  buildAssetCategoryButtonLabel,
  getAllAssetIds,
  getAssetGridDisplayConfig,
  toggleAssetSelection,
} from "./asset-grid.ts";

test("maps asset grid display sizes to columns and complete-image classes", () => {
  assert.deepEqual(
    ASSET_GRID_SIZE_OPTIONS.map((option) => option.value),
    ["small", "medium", "large"],
  );
  const large = getAssetGridDisplayConfig("large");
  assert.equal(large.columns, 5);
  assert.equal(large.gridClassName, "grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");
  assert.equal(large.imageClassName, "aspect-square w-full object-contain");

  const medium = getAssetGridDisplayConfig("medium");
  assert.equal(medium.columns, 8);
  assert.equal(medium.gridClassName, "grid gap-3 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8");
  assert.equal(medium.imageClassName, "aspect-square w-full object-contain");

  const small = getAssetGridDisplayConfig("small");
  assert.equal(small.columns, 10);
  assert.equal(small.gridClassName, "grid gap-2 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10");
  assert.equal(small.imageClassName, "aspect-square w-full object-contain");
});

test("falls back to large asset grid size for invalid values", () => {
  assert.equal(getAssetGridDisplayConfig("unknown").columns, 5);
});

test("builds compact asset card meta text from category and custom tags", () => {
  assert.equal(buildAssetCardMetaText("表情", ["思考", "开心"]), "表情 · 思考 · 开心");
  assert.equal(buildAssetCardMetaText("牛形象", []), "牛形象");
});

test("builds category button labels with image counts", () => {
  assert.equal(buildAssetCategoryButtonLabel("全部", 42), "全部 (42)");
  assert.equal(buildAssetCategoryButtonLabel("表情", 15), "表情 (15)");
  assert.equal(buildAssetCategoryButtonLabel("动作", undefined), "动作 (0)");
});

test("selects all currently loaded asset ids for migration", () => {
  assert.deepEqual(
    getAllAssetIds([
      { id: 3 },
      { id: 1 },
      { id: 3 },
      { id: 2 },
    ]),
    [3, 1, 2],
  );
});

test("toggles one asset id in the migration selection", () => {
  assert.deepEqual(toggleAssetSelection([1, 2], 2), [1]);
  assert.deepEqual(toggleAssetSelection([1, 2], 3), [1, 2, 3]);
});
