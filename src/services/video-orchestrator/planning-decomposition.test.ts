import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assemblePlanningAssetSpecs,
} from "./three-stage-planner.ts";
import type { VideoConsistencyAnchor } from "./types.ts";

const root = process.cwd();
const plannerSource = readFileSync(
  path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"),
  "utf8",
);

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
  assert.match(plannerSource, /const eligibility = params\.planningManifest\.consistencyManifest\.anchors\.map\(\s*assessAssetVisualSpecEligibility/);
  assert.match(plannerSource, /const callGate = assessAssetVisualSpecEligibility\(anchor\)/);
  assert.match(plannerSource, /asset_visual_spec\.skipped_ineligible/);
  assert.match(plannerSource, /mapWithConcurrency\(\s*targets,\s*assetVisualSpecConcurrency\(\)/);
  assert.match(plannerSource, /const batchController = new AbortController\(\)/);
  assert.match(plannerSource, /signal: batchController\.signal/);
  assert.match(plannerSource, /asset_visual_spec\.batch_cancel_requested/);
  assert.match(plannerSource, /asset_visual_spec\.batch_cancel_settled/);
  assert.match(plannerSource, /throw rootFailure\.error/);
  assert.match(plannerSource, /assetVisualSpecsByAnchorId/);
  assert.match(plannerSource, /assetVisualSpecFingerprints/);
  assert.match(plannerSource, /assemblePlanningAssetSpecs/);
  assert.doesNotMatch(plannerSource, /fallback_legacy/);
  assert.doesNotMatch(plannerSource, /splitPlanningLegacyFallbackEnabled/);
  assert.doesNotMatch(plannerSource, /shotDecomposerMode/);
  assert.doesNotMatch(plannerSource, /callWholeShotDecomposerPlan/);
  assert.doesNotMatch(plannerSource, /ONE_PROMPT_VIDEO_PLANNING_DECOMPOSITION/);
});

test("segment contracts use Zod locally because DashScope only transports JSON mode", () => {
  assert.match(plannerSource, /json_object_plus_local_zod_contract/);
  assert.match(plannerSource, /contract:\s*segmentShotDecomposerContract/);
  assert.match(plannerSource, /JSON\.stringify\(segmentShotDecomposerExample/);
  assert.doesNotMatch(plannerSource, /SEGMENT_SHOT_DECOMPOSER_JSON_SCHEMA/);
  assert.doesNotMatch(plannerSource, /type:\s*"json_schema"/);
});

test("unchanged structured contract failures persist a checkpoint fuse and stop retrying", () => {
  assert.match(plannerSource, /structuredFailures\?: Record<string, StructuredFailureState>/);
  assert.match(plannerSource, /shouldStopStructuredFailureRetry\(state\)/);
  assert.match(plannerSource, /disposition: "contract_repair_required"/);
  assert.match(plannerSource, /retryable: false/);
});
