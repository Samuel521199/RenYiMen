import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseWorkflowFavoriteIds, workflowFavoritesStorageKey } from "./workflow-favorites.ts";

test("workflow favorites are isolated by account and tolerate invalid stored data", () => {
  assert.notEqual(workflowFavoritesStorageKey("user-a"), workflowFavoritesStorageKey("user-b"));
  assert.deepEqual(Array.from(parseWorkflowFavoriteIds('["SKU_B","SKU_A","SKU_A"]')).sort(), ["SKU_A", "SKU_B"]);
  assert.deepEqual(Array.from(parseWorkflowFavoriteIds("not-json")), []);
});

test("workflow cards expose an independent favorite control and favorite filtering", () => {
  const studioSource = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");
  const topNavSource = readFileSync("src/workbench/components/layout/TopNavigation.tsx", "utf8");

  assert.match(studioSource, /aria-pressed=\{isFavorite\}/);
  assert.match(studioSource, /<Star[\s\S]*fill=\{isFavorite \? "currentColor" : "none"\}/);
  assert.match(studioSource, /activeToolGroup === "favorites"[\s\S]*favoriteSkuIds\.has\(s\.skuId\)/);
  assert.match(topNavSource, /group=favorites/);
  assert.ok(
    topNavSource.indexOf("group=favorites") > topNavSource.indexOf("group=audio-post"),
    "favorites should remain a dedicated general-workspace destination",
  );
});
