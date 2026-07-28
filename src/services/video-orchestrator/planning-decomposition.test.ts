import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assemblePlanningAssetSpecs,
  planningDecompositionMode,
  validateLocalJsonSchema,
} from "./three-stage-planner.ts";
import type { VideoConsistencyAnchor } from "./types.ts";

const root = process.cwd();
const plannerSource = readFileSync(
  path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"),
  "utf8",
);

test("split planning is the default with explicit legacy and shadow rollback modes", () => {
  const previous = process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION;
  try {
    delete process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION;
    assert.equal(planningDecompositionMode(), "split");
    process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION = "legacy";
    assert.equal(planningDecompositionMode(), "legacy");
    process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION = "split_shadow";
    assert.equal(planningDecompositionMode(), "split_shadow");
    process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION = "unknown";
    assert.equal(planningDecompositionMode(), "split");
  } finally {
    if (previous === undefined) delete process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION;
    else process.env.ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION = previous;
  }
});

test("asset spec assembler preserves narrative fields and mirrors anchors into compatibility locations", () => {
  const anchors: VideoConsistencyAnchor[] = [{
    id: "hero",
    type: "person",
    displayNameZh: "女主角",
    displayNameEn: "heroine",
    mustStayConsistent: true,
    needsReferenceImage: true,
    referenceStrength: "hard",
    descriptionZh: "红夹克女性",
    descriptionEn: "woman in a red jacket",
    appliesTo: ["keyframes", "segments", "micro_shots"],
    userEditable: true,
    imagePromptZh: "资产提示词",
    imagePromptEn: "asset prompt",
  }];
  const assembled = assemblePlanningAssetSpecs({
    classification: { video_type: "product_ad" },
    narrative_events: [{ event_id: "event_1" }],
    consistency_manifest: { anchors: [{ id: "old" }] },
    planning_manifest: {
      project_intent: { video_type: "product_ad" },
      timeline_blueprint: { segments: [] },
    },
  }, anchors);
  assert.deepEqual(assembled.classification, { video_type: "product_ad" });
  assert.deepEqual(assembled.narrative_events, [{ event_id: "event_1" }]);
  assert.equal(
    ((assembled.consistency_manifest as Record<string, unknown>).anchors as VideoConsistencyAnchor[])[0].id,
    "hero",
  );
  assert.equal(
    ((((assembled.planning_manifest as Record<string, unknown>).consistency_manifest as Record<string, unknown>).anchors as VideoConsistencyAnchor[])[0].imagePromptEn),
    "asset prompt",
  );
});

test("planning decomposition uses per-anchor bounded workers and checkpoint fingerprints", () => {
  assert.match(plannerSource, /PLANNING_ARCHITECT_LITE_SYSTEM_PROMPT/);
  assert.match(plannerSource, /Do not output asset_image_contract, image_prompt_zh, image_prompt_en/);
  assert.match(plannerSource, /ASSET_VISUAL_SPEC_DETAILER_SYSTEM_PROMPT/);
  assert.match(plannerSource, /detailPlanningAssetVisualSpecs/);
  assert.match(plannerSource, /mapWithConcurrency\(\s*targets,\s*assetVisualSpecConcurrency\(\)/);
  assert.match(plannerSource, /assetVisualSpecsByAnchorId/);
  assert.match(plannerSource, /assetVisualSpecFingerprints/);
  assert.match(plannerSource, /assemblePlanningAssetSpecs/);
  assert.match(plannerSource, /planningDecompositionMode\(\)/);
  assert.match(plannerSource, /split_shadow/);
});

test("segment contracts use local strict schema validation because DashScope only transports JSON mode", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["source"],
    properties: {
      source: { type: "string", enum: ["verified"] },
    },
  };
  assert.deepEqual(validateLocalJsonSchema({ source: "verified" }, schema), []);
  assert.ok(validateLocalJsonSchema({ source: "guessed", extra: true }, schema).some(
    (message) => message.includes("allowed enum"),
  ));
  assert.ok(validateLocalJsonSchema({ source: "guessed", extra: true }, schema).some(
    (message) => message.includes("additional property"),
  ));
  assert.match(plannerSource, /json_object_plus_local_strict_schema/);
  assert.doesNotMatch(plannerSource, /type:\s*"json_schema"/);
});
