import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  detectReferenceOrientation,
  referenceFinalScore,
  referenceRecencyScore,
  referenceViewMatchScore,
  selectReferenceCandidates,
  type ReferenceOrientation,
  type SelectableReferenceCandidate,
} from "./reference-selector.ts";

function personCandidate(view: "front" | "side" | "back", options: Partial<SelectableReferenceCandidate> = {}): SelectableReferenceCandidate {
  return {
    artifactId: `person:${view}`,
    url: `fixture://person-${view}.png`,
    sourceType: "hard_anchor",
    quotaType: "character",
    purpose: `${view} identity`,
    relevanceScore: 1,
    conflictScore: 0,
    recencyScore: 1,
    viewMatchScore: referenceViewMatchScore(options.detectedOrientation as ReferenceOrientation ?? "unknown", view),
    anchorId: "hero",
    assetView: view,
    hardRequired: true,
    usageNote: `${view} identity reference`,
    ...options,
  };
}

function selectForOrientation(orientation: ReferenceOrientation, candidates: SelectableReferenceCandidate[]) {
  return selectReferenceCandidates({
    targetOrientation: orientation,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      viewMatchScore: candidate.assetView ? referenceViewMatchScore(orientation, candidate.assetView) : candidate.viewMatchScore,
    })),
  });
}

test("reference score rewards relevance, matching view, and recency while penalizing conflict", () => {
  assert.ok(Math.abs(referenceFinalScore({ relevanceScore: 1, viewMatchScore: 1, recencyScore: 1, conflictScore: 0 }) - 0.9) < 1e-9);
  assert.ok(referenceFinalScore({ relevanceScore: 1, viewMatchScore: 1, recencyScore: 1, conflictScore: 0 }) >
    referenceFinalScore({ relevanceScore: 1, viewMatchScore: 0, recencyScore: 0, conflictScore: 0 }));
  assert.ok(referenceFinalScore({ relevanceScore: 1, viewMatchScore: 1, recencyScore: 1, conflictScore: 0 }) >
    referenceFinalScore({ relevanceScore: 1, viewMatchScore: 1, recencyScore: 1, conflictScore: 1 }));
  assert.ok(referenceRecencyScore(0) > referenceRecencyScore(3));
});

test("orientation detector handles Chinese and English front, side, and back descriptions", () => {
  assert.equal(detectReferenceOrientation("人物正面面向镜头"), "front");
  assert.equal(detectReferenceOrientation("left profile side view"), "side");
  assert.equal(detectReferenceOrientation("人物背对镜头走远"), "back");
  assert.equal(detectReferenceOrientation("人物站在房间里"), "unknown");
});

test("front-facing keyframe selects the approved front view", () => {
  const decision = selectForOrientation("front", [personCandidate("front"), personCandidate("side"), personCandidate("back")]);
  assert.equal(decision.selected.find((candidate) => candidate.quotaType === "character")?.assetView, "front");
});

test("back-facing keyframe selects the approved back view", () => {
  const decision = selectForOrientation("back", [personCandidate("front"), personCandidate("side"), personCandidate("back")]);
  assert.equal(decision.selected.find((candidate) => candidate.quotaType === "character")?.assetView, "back");
});

test("missing side view falls back to front and records the reason", () => {
  const decision = selectForOrientation("side", [personCandidate("front"), personCandidate("back")]);
  assert.equal(decision.selected.find((candidate) => candidate.quotaType === "character")?.assetView, "front");
  assert.equal(decision.orientationFallbackReason, "requested_side_view_unavailable_or_conflicted; fallback_to_front");
});

test("hard person and hard product are both selected before style", () => {
  const product: SelectableReferenceCandidate = {
    artifactId: "product:main",
    url: "fixture://product.png",
    sourceType: "hard_anchor",
    quotaType: "product",
    purpose: "product identity",
    relevanceScore: 1,
    conflictScore: 0,
    recencyScore: 1,
    viewMatchScore: 0.5,
    anchorId: "product",
    hardRequired: true,
    usageNote: "product identity reference",
  };
  const style: SelectableReferenceCandidate = {
    artifactId: "style:high-score",
    url: "fixture://style.png",
    sourceType: "style_brand",
    quotaType: "style_brand",
    purpose: "style only",
    relevanceScore: 1,
    conflictScore: 0,
    recencyScore: 1,
    viewMatchScore: 1,
    usageNote: "style only",
  };
  const decision = selectForOrientation("front", [personCandidate("front"), product, style]);
  assert.ok(decision.selected.some((candidate) => candidate.artifactId === "person:front"));
  assert.ok(decision.selected.some((candidate) => candidate.artifactId === "product:main"));
  assert.notEqual(decision.selected.find((candidate) => candidate.quotaType === "character")?.artifactId, "style:high-score");
});

test("high-conflict candidate is rejected with an explicit reason", () => {
  const conflicted = personCandidate("front", { conflictScore: 0.95, conflictReasons: ["wrong_identity", "wrong_text"] });
  const decision = selectForOrientation("front", [conflicted]);
  assert.equal(decision.selected.length, 0);
  assert.equal(decision.candidates[0]?.rejectionReason, "conflict_threshold_exceeded:wrong_identity|wrong_text");
});

test("required transition layout evidence cannot be vetoed by generic visual conflict scoring", () => {
  const transition: SelectableReferenceCandidate = {
    artifactId: "transition_reference:camera_02:2",
    url: "fixture://layout.png",
    sourceType: "transition_reference",
    quotaType: "space_layout",
    purpose: "required scene layout",
    relevanceScore: 0.92,
    conflictScore: 0.99,
    conflictReasons: ["different_character_pose", "incidental_text"],
    recencyScore: 1,
    viewMatchScore: 0.7,
    hardRequired: true,
  };
  const decision = selectForOrientation("front", [personCandidate("front"), transition]);
  assert.ok(decision.selected.some((candidate) => candidate.artifactId === transition.artifactId));
});

test("project integration preserves front-first derivation and approved media", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /onePromptRolloutEnabled\("ONE_PROMPT_THREE_VIEW_DERIVATION"\) && category === "person" && view !== "front" \? "derived_from_front" : "primary"/);
  assert.match(source, /if \(!onePromptRolloutEnabled\("ONE_PROMPT_THREE_VIEW_DERIVATION"\)\) return true/);
  assert.match(source, /Approve and lock each person front view before generating its side and back views/);
  assert.match(source, /candidate\.assetView === "front"/);
  assert.match(source, /NOT: \{ locked: true, imageUrl: \{ not: null \} \}/);
});

test("vision evaluation only enriches scores and deterministic selector remains final authority", () => {
  const source = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/reference-vision-evaluator.ts"), "utf8");
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(source, /do not select the final references/i);
  assert.match(source, /conflictScore: Math\.max\(candidate\.conflictScore, evaluation\.conflictScore\)/);
  assert.match(source, /candidate\.sourceType === "transition_reference" && candidate\.hardRequired/);
  assert.match(service, /const decision = selectReferenceCandidates/);
});
