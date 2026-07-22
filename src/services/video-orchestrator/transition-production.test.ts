import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { selectReferenceCandidates } from "./reference-selector.ts";

test("transition scene-layout reference is selected without replacing hard identity", () => {
  const result = selectReferenceCandidates({
    targetOrientation: "front",
    candidates: [
      { artifactId: "person:front", url: "person.jpg", sourceType: "hard_anchor", quotaType: "character", purpose: "identity", relevanceScore: 1, conflictScore: 0, recencyScore: 1, viewMatchScore: 1, hardRequired: true, anchorId: "person", assetView: "front" },
      { artifactId: "transition_reference:cam2:2", url: "layout.jpg", sourceType: "transition_reference", quotaType: "space_layout", purpose: "layout", relevanceScore: 0.92, conflictScore: 0.06, recencyScore: 1, viewMatchScore: 0.8, hardRequired: true, usageNote: "SCENE-LAYOUT ONLY; never inherit identity or text" },
      { artifactId: "style", url: "style.jpg", sourceType: "style_brand", quotaType: "style_brand", purpose: "style", relevanceScore: 0.7, conflictScore: 0.1, recencyScore: 0.4, viewMatchScore: 0.4 },
    ],
  });
  assert.deepEqual(new Set(result.selected.map((item) => item.artifactId)), new Set(["person:front", "transition_reference:cam2:2", "style"]));
  assert.equal(result.selected.find((item) => item.quotaType === "character")?.artifactId, "person:front");
});

test("full transition chain extracts, evaluates, reviews and locks frames", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-evaluator.ts"), "utf8");
  assert.match(service, /status: "video_running"/);
  assert.match(service, /status: "evaluating_frames"/);
  assert.match(service, /extractVideoFrameDataUrls\(videoUrl\)/);
  assert.match(service, /purpose: "transition_reference_frame"/);
  assert.match(service, /Select a quality-passed transition frame before approval/);
  assert.match(service, /status: "approved"[\s\S]{0,140}locked: true/);
  assert.match(evaluator, /fractions = \[0\.2, 0\.4, 0\.6, 0\.8\]/);
});

test("short mode inherits layout from an approved or current quality-passed parent keyframe", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(service, /item\.mode === "short"/);
  assert.match(service, /isUsableTransitionParentKeyframe\(project, keyframe\)/);
  assert.match(service, /report\?\.passed === true && report\.mediaUrl === keyframe\.imageUrl/);
  assert.match(service, /SCENE-LAYOUT ONLY/);
  assert.match(service, /Never inherit person\/product identity, logos, typography, accidental text/);
  assert.match(service, /Required transition scene-layout reference was not selected/);
});

test("boundary reference selection scopes transition candidates to its resolved segment", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(service, /collectTransitionReferenceCandidates\(params\.project, targetSegmentNo\)/);
  assert.doesNotMatch(service, /collectTransitionReferenceCandidates\(params\.project, params\.segment\?\.segmentNo\)/);
  assert.match(service, /blockedBoundaryKeyframeNos/);
});

test("URL deduplication preserves a mandatory transition alias over its parent-camera alias", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  const dedupe = service.slice(
    service.indexOf("function dedupeReferenceCandidates"),
    service.indexOf("function quotaTypeForReferenceKind"),
  );
  assert.match(dedupe, /referenceCandidateDedupePriority\(candidate\) > referenceCandidateDedupePriority\(current\)/);
  assert.match(dedupe, /candidate\.sourceType === "transition_reference" && candidate\.hardRequired/);
});

test("required transition layout evidence bypasses generic conflict veto", () => {
  const selector = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/reference-selector.ts"), "utf8");
  const evaluator = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/reference-vision-evaluator.ts"), "utf8");
  assert.match(selector, /isMandatoryTransitionCandidate/);
  assert.match(selector, /isMandatoryTransitionCandidate\(candidate\) \|\| candidate\.conflictScore < conflictThreshold/);
  assert.match(evaluator, /candidate\.sourceType === "transition_reference" && candidate\.hardRequired/);
});

test("generated bridges use a distinct artifact state and block composition until approval", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(service, /generated_bridge:\$\{transition\.fromSegmentNo\}:\$\{transition\.toSegmentNo\}/);
  assert.match(service, /kind: "generated_bridge"/);
  assert.match(service, /purpose: "generated_bridge"/);
  assert.match(service, /must be generated, quality-passed, reviewed and locked before final composition/);
  assert.match(service, /entries\.push\(\{ url: bridge\.selectedVideoUrl/);
  assert.doesNotMatch(service, /transition_reference:[^\n]{0,120}entersFinalComposition: true/);
});

test("transition and bridge revisions are independently addressable", () => {
  const types = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/types.ts"), "utf8");
  const route = readFileSync(path.join(process.cwd(), "src/app/api/video-projects/[projectId]/media-revisions/rollback/route.ts"), "utf8");
  assert.match(types, /"transition_reference" \| "generated_bridge"/);
  assert.match(route, /"transition_reference"/);
  assert.match(route, /"generated_bridge"/);
});

test("upstream media changes invalidate approvals without deleting revisions", () => {
  const service = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/project-service.ts"), "utf8");
  assert.match(service, /invalidateTransitionReferencesForParent\(project\.id, keyframe\.keyframeNo/);
  assert.match(service, /Parent-camera keyframe candidate changed; transition reference approval must be renewed/);
  assert.match(service, /invalidateGeneratedBridgesForSegment\(project\.id, segment\.segmentNo/);
  assert.match(service, /Adjacent segment candidate changed; generated bridge approval must be renewed/);
  assert.match(service, /status: parentKeyframeNo !== undefined \? "waiting_parent" : "planned"/);
  assert.match(service, /appendVideoMediaRevision\(projectId, \{ kind: "transition_reference"/);
  assert.match(service, /appendVideoMediaRevision\(projectId, \{ kind: "generated_bridge"/);
});
