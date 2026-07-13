import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStaticCacheControl,
  DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE,
  isWorkbenchStaticAssetPath,
  parseWorkbenchStaticCacheMaxAge,
} from "./workbench-static-cache.ts";

test("isWorkbenchStaticAssetPath detects static segments", () => {
  assert.equal(isWorkbenchStaticAssetPath(["static", "assets", "a.png"]), true);
  assert.equal(isWorkbenchStaticAssetPath(["api", "assets"]), false);
  assert.equal(isWorkbenchStaticAssetPath([]), false);
});

test("buildStaticCacheControl uses must-revalidate for overwrite-safe caching", () => {
  assert.equal(
    buildStaticCacheControl(3600),
    "public, max-age=3600, must-revalidate",
  );
});

test("parseWorkbenchStaticCacheMaxAge falls back to default", () => {
  assert.equal(parseWorkbenchStaticCacheMaxAge(undefined), DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE);
  assert.equal(parseWorkbenchStaticCacheMaxAge("invalid"), DEFAULT_WORKBENCH_STATIC_CACHE_MAX_AGE);
  assert.equal(parseWorkbenchStaticCacheMaxAge("7200"), 7200);
});
