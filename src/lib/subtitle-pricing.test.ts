import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AUTO_SUBTITLE_CREDITS } from "./subtitle-pricing.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("automatic subtitles have one shared fixed price", () => {
  assert.equal(AUTO_SUBTITLE_CREDITS, 100);

  const catalog = readFileSync(`${root}/src/app/api/skus/route.ts`, "utf8");
  const route = readFileSync(`${root}/src/app/api/gateway/subtitles/route.ts`, "utf8");
  const studio = readFileSync(`${root}/src/components/WorkflowForm/WorkflowStudio.tsx`, "utf8");

  assert.match(catalog, /sellCredits:\s*AUTO_SUBTITLE_CREDITS/);
  assert.match(route, /deductUserBalance\([\s\S]*AUTO_SUBTITLE_CREDITS/);
  assert.doesNotMatch(studio, /isAutoSubtitle\s*\?\s*\(locale === "en" \? "Free"/);
  assert.doesNotMatch(studio, /headerAction=\{selectedSku\s*&&\s*!isAutoSubtitleTool/);
});
