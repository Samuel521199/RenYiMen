import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackQualityDisplaySummary,
  qualitySummarySourceHash,
} from "./quality-display-summary";
import type { GenerationQualityReport } from "./types";

function baseReport(): GenerationQualityReport {
  return {
    assetId: "keyframe:5:image",
    identityScore: 90,
    layoutScore: 86,
    promptAlignmentScore: 88,
    continuityScore: 84,
    artifactIssues: [],
    passed: true,
    qualityDecision: "recommended",
    atomicRequirements: [
      {
        requirementId: "identity:hero",
        domain: "identity",
        target: "hero matches the approved reference",
        severity: "hard",
        authority: "approved_reference",
        appliesTo: "both",
      },
      {
        requirementId: "narrative:object",
        domain: "narrative",
        target: "the required product is visible",
        severity: "hard",
        authority: "structured_contract",
        appliesTo: "both",
      },
      {
        requirementId: "layout:balance",
        domain: "layout",
        target: "balanced cinematic composition",
        severity: "soft",
        authority: "planner_inference",
        appliesTo: "static_image",
      },
      {
        requirementId: "brand:label",
        domain: "brand_text",
        target: "approved package label",
        severity: "hard",
        authority: "structured_contract",
        appliesTo: "static_image",
      },
    ],
    evidenceObservations: [
      {
        requirementId: "identity:hero",
        status: "satisfied",
        confidence: 0.95,
        evidenceSource: "current_output",
      },
      {
        requirementId: "narrative:object",
        status: "violated",
        confidence: 0.94,
        evidenceSource: "current_output",
        description: "the required product is missing",
      },
      {
        requirementId: "layout:balance",
        status: "violated",
        confidence: 0.9,
        evidenceSource: "current_output",
        description: "composition is slightly left-heavy",
      },
      {
        requirementId: "brand:label",
        status: "violated",
        confidence: 0.61,
        evidenceSource: "current_output",
        description: "label may differ",
      },
    ],
  };
}

test("v3 classifies hard evidence, advice, satisfied checks, and uncertainty separately", () => {
  const summary = fallbackQualityDisplaySummary(baseReport(), "zh");
  assert.equal(summary.version, "quality-summary-v3");
  assert.equal(summary.model, "deterministic-policy");
  assert.deepEqual(summary.items.map((item) => item.status), [
    "must_fix",
    "pending_review",
    "improvement",
    "satisfied",
  ]);
  assert.equal(summary.gateStatus, "hard_fail");
  assert.equal(summary.blocksQualityPass, true);
  assert.deepEqual(summary.counts, {
    must_fix: 1,
    pending_review: 1,
    improvement: 1,
    satisfied: 1,
  });
});

test("soft advice never blocks the quality gate", () => {
  const report = baseReport();
  report.atomicRequirements = report.atomicRequirements?.filter((item) => item.requirementId === "layout:balance");
  report.evidenceObservations = report.evidenceObservations?.filter((item) => item.requirementId === "layout:balance");
  const summary = fallbackQualityDisplaySummary(report, "en");
  assert.equal(summary.gateStatus, "pass_with_advice");
  assert.equal(summary.blocksQualityPass, false);
  assert.equal(summary.items[0]?.status, "improvement");
});

test("low-confidence hard findings wait for review instead of forcing regeneration", () => {
  const report = baseReport();
  report.atomicRequirements = report.atomicRequirements?.filter((item) => item.requirementId === "brand:label");
  report.evidenceObservations = report.evidenceObservations?.filter((item) => item.requirementId === "brand:label");
  report.passed = false;
  report.qualityDecision = "review";
  const summary = fallbackQualityDisplaySummary(report, "en");
  assert.equal(summary.gateStatus, "pending_review");
  assert.equal(summary.blocksQualityPass, false);
  assert.equal(summary.items[0]?.status, "pending_review");
});

test("missing references and technical failures are not reported as visual defects", () => {
  const missing = fallbackQualityDisplaySummary({
    ...baseReport(),
    evaluationStatus: "reference_missing",
    referenceComparable: false,
    passed: false,
  }, "zh");
  assert.equal(missing.gateStatus, "blocked_input");
  assert.equal(missing.items[0]?.status, "blocked_input");
  assert.equal(missing.blocksQualityPass, false);

  const technical = fallbackQualityDisplaySummary({
    ...baseReport(),
    evaluationStatus: "technical_failed",
    passed: false,
  }, "en");
  assert.equal(technical.gateStatus, "technical_retry");
  assert.equal(technical.items[0]?.status, "technical_retry");
  assert.equal(technical.blocksQualityPass, false);
});

test("verified contract conflicts are shown as an input block, not an image defect", () => {
  const summary = fallbackQualityDisplaySummary({
    ...baseReport(),
    contractConflictsVerified: true,
    contractConflicts: ["two incompatible approved product colors"],
    qualityDecision: "blocked",
    passed: false,
  }, "zh");
  assert.equal(summary.gateStatus, "blocked_input");
  assert.equal(summary.items[0]?.status, "blocked_input");
  assert.equal(summary.blocksQualityPass, false);
});

test("legacy ledgers still map hard and soft findings to distinct v3 categories", () => {
  const report: GenerationQualityReport = {
    ...baseReport(),
    atomicRequirements: undefined,
    evidenceObservations: undefined,
    issueLedger: [
      {
        issueId: "hard",
        fingerprint: "hard",
        category: "identity",
        summary: "wrong person",
        severity: "hard",
        applicableStage: "static_image",
        status: "open",
        occurrenceCount: 1,
      },
      {
        issueId: "soft",
        fingerprint: "soft",
        category: "layout",
        summary: "could be better balanced",
        severity: "soft",
        applicableStage: "static_image",
        status: "open",
        occurrenceCount: 1,
      },
      {
        issueId: "resolved",
        fingerprint: "resolved",
        category: "continuity",
        summary: "old issue",
        severity: "soft",
        applicableStage: "static_image",
        status: "resolved",
        occurrenceCount: 1,
      },
    ],
    passed: false,
    qualityDecision: "retry",
  };
  const summary = fallbackQualityDisplaySummary(report, "en");
  assert.deepEqual(summary.items.map((item) => item.status), ["must_fix", "improvement", "satisfied"]);
  assert.equal(summary.gateStatus, "hard_fail");
});

test("quality summary cache hash changes with evidence", () => {
  const original = baseReport();
  const changed = baseReport();
  changed.evidenceObservations![1].confidence = 0.5;
  assert.notEqual(qualitySummarySourceHash(original), qualitySummarySourceHash(changed));
});
