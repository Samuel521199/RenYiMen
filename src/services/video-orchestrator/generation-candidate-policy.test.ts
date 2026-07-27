import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGenerationInputFingerprint,
  buildQualityEvaluationFingerprint,
} from "./generation-candidate-policy";

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
    mediaUrl: "https://example.com/result.png",
    prompt: "Draw the bull.",
    selectedReferenceUrls: ["https://example.com/bull.png"],
    targetContract: { subject: "opponent bull" },
  };
  const first = buildQualityEvaluationFingerprint(base);
  assert.equal(first, buildQualityEvaluationFingerprint(base));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    mediaUrl: "https://example.com/another-result.png",
  }));
  assert.notEqual(first, buildQualityEvaluationFingerprint({
    ...base,
    selectedReferenceUrls: ["https://example.com/other-bull.png"],
  }));
});
