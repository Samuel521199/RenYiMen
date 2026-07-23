import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackQualityDisplaySummary,
  qualitySummarySourceHash,
} from "./quality-display-summary";
import type { GenerationQualityReport } from "./types";

function report(): GenerationQualityReport {
  return {
    assetId: "keyframe:5:image",
    identityScore: 85,
    layoutScore: 70,
    promptAlignmentScore: 65,
    continuityScore: 75,
    artifactIssues: [],
    passed: false,
    issueLedger: [
      {
        issueId: "resolved",
        fingerprint: "resolved",
        category: "layout",
        summary: "old layout issue",
        severity: "soft",
        applicableStage: "static_image",
        status: "resolved",
        occurrenceCount: 1,
      },
      {
        issueId: "brand",
        fingerprint: "brand",
        category: "text_brand",
        summary: "duplicate logo and wrong bonus text",
        severity: "soft",
        applicableStage: "static_image",
        status: "open",
        occurrenceCount: 1,
      },
      {
        issueId: "ui",
        fingerprint: "ui",
        category: "game_ui",
        summary: "timer and score are inaccurate",
        severity: "soft",
        applicableStage: "static_image",
        status: "regressed",
        occurrenceCount: 2,
      },
      {
        issueId: "video",
        fingerprint: "video",
        category: "artifact",
        summary: "motion must be checked in video",
        severity: "advisory",
        applicableStage: "video",
        status: "invalid_for_stage",
        occurrenceCount: 1,
      },
    ],
  };
}

test("fallback display summary is localized, prioritized, and capped at three items", () => {
  const summary = fallbackQualityDisplaySummary(report(), "zh");
  assert.equal(summary.model, "local-fallback");
  assert.equal(summary.items.length, 3);
  assert.deepEqual(summary.items.map((item) => item.status), ["open", "open", "resolved"]);
  assert.match(summary.items[0].text, /游戏界面/);
  assert.match(summary.items[1].text, /品牌文字/);
  assert.ok(summary.items.every((item) => item.text.length <= 32));
});

test("quality summary cache hash changes with visual findings", () => {
  const original = report();
  const changed = report();
  changed.issueLedger![1].summary = "single correct logo";
  assert.notEqual(qualitySummarySourceHash(original), qualitySummarySourceHash(changed));
});
