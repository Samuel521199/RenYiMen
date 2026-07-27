import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildGenerationInputFingerprint,
  buildQualityEvaluationFingerprint,
  buildQualityReferenceSetHash,
  QUALITY_POLICY_VERSION,
  QUALITY_PROMPT_VERSION,
} from "./generation-candidate-policy";
import { hashMediaContent } from "./media-content-hash";
import { generationCandidateMatchesActivePlanningRevision } from "./project-service";

test("obsolete micro-shot candidates are excluded without affecting other candidate kinds", () => {
  const planJson = {
    segments: [{
      segmentNo: 1,
      microShots: [{
        microShotNo: 1,
        purpose: "motion checkpoint",
        resolvedRevisionId: "boundary-revision-2",
      }],
    }],
  };
  const candidate = (revision: string) => ({
    kind: "micro_shot_image",
    metadata: {
      segmentNo: 1,
      microShotNo: 1,
      targetContract: { resolvedRevisionId: revision },
    },
  });

  assert.equal(generationCandidateMatchesActivePlanningRevision(
    planJson,
    candidate("boundary-revision-2"),
  ), true);
  assert.equal(generationCandidateMatchesActivePlanningRevision(
    planJson,
    candidate("boundary-revision-1"),
  ), false);
  assert.equal(generationCandidateMatchesActivePlanningRevision(
    planJson,
    { kind: "keyframe_image", metadata: {} },
  ), true);
});

test("generation fingerprint ignores candidate counters but detects meaningful changes", () => {
  const first = buildGenerationInputFingerprint({
    kind: "keyframe_image",
    prompt: "Draw the bull.\nThis is candidate #2. Preserve history.\nPrior attempts reviewed: 1; visually evaluated: 1.",
    referenceImageUrls: ["https://example.com/bull.png"],
    parameters: { aspectRatio: "9:16", model: "wanx" },
  });
  const sameInput = buildGenerationInputFingerprint({
    kind: "keyframe_image",
    prompt: "Draw the bull.\nThis is candidate #3. Preserve history.\nPrior attempts reviewed: 2; visually evaluated: 2.",
    referenceImageUrls: ["https://example.com/bull.png"],
    parameters: { model: "wanx", aspectRatio: "9:16" },
  });
  const corrected = buildGenerationInputFingerprint({
    kind: "keyframe_image",
    prompt: "Draw only the opponent bull on a plain white background.",
    referenceImageUrls: ["https://example.com/bull.png"],
    parameters: { aspectRatio: "9:16", model: "wanx" },
  });
  assert.equal(first, sameInput);
  assert.notEqual(first, corrected);
});

test("quality fingerprint reuses only the same media and evaluation contract", () => {
  const base = {
    kind: "keyframe_image",
    candidateContentHash: "sha256:result-a",
    referenceSetHash: "sha256:references-a",
    qualityPolicyVersion: "quality-policy-v4",
    qualityPromptVersion: "image-quality-prompt-v5",
    qualityModelId: "qwen-vl",
    evaluationContract: {
      prompt: "Draw the bull.",
      targetContract: { subject: "opponent bull" },
    },
  };
  const first = buildQualityEvaluationFingerprint(base);
  assert.equal(first, buildQualityEvaluationFingerprint(base));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    candidateContentHash: "sha256:result-b",
  }));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    referenceSetHash: "sha256:references-b",
  }));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    qualityPolicyVersion: "quality-policy-v5",
  }));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    qualityModelId: "qwen-vl-next",
  }));
});

test("quality reference hashing treats references as a normalized set", () => {
  const first = buildQualityReferenceSetHash([
    { contentHash: "sha256:b", usageNote: "layout" },
    { contentHash: "sha256:a", usageNote: "identity" },
  ]);
  const reordered = buildQualityReferenceSetHash([
    { contentHash: "sha256:a", usageNote: "identity" },
    { contentHash: "sha256:b", usageNote: "layout" },
    { contentHash: "sha256:a", usageNote: "identity" },
  ]);
  const changed = buildQualityReferenceSetHash([
    { contentHash: "sha256:a", usageNote: "identity" },
    { contentHash: "sha256:c", usageNote: "layout" },
  ]);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test("media content hashing follows bytes rather than URL identity", async () => {
  const first = await hashMediaContent("data:image/png;base64,aGVsbG8=");
  const sameBytes = await hashMediaContent("data:application/octet-stream;base64,aGVsbG8=");
  const changed = await hashMediaContent("data:image/png;base64,d29ybGQ=");
  assert.equal(first, sameBytes);
  assert.notEqual(first, changed);
});

test("persistent quality cache has a project-scoped unique key and atomic lease", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const cache = readFileSync(path.join(process.cwd(), "src/services/video-orchestrator/generation-quality-cache.ts"), "utf8");
  assert.match(schema, /model VideoQualityEvaluationCache/);
  assert.match(schema, /@@unique\(\[projectId, cacheKey\]\)/);
  assert.match(cache, /leaseToken = randomUUID\(\)/);
  assert.match(cache, /PrismaClientKnownRequestError/);
  assert.match(cache, /status === "completed" && existing\.reportJson/);
  assert.match(cache, /status: "technical_failed"/);
  assert.equal(QUALITY_POLICY_VERSION, "quality-policy-v4");
  assert.equal(QUALITY_PROMPT_VERSION, "image-quality-prompt-v5");
});
