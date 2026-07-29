import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceStructuredFailureState,
  shouldStopStructuredFailureRetry,
  structuredContractIssueFingerprint,
  structuredStageJsonSchema,
  validateStructuredStageValue,
} from "./structured-stage-contract.ts";
import {
  segmentShotDecomposerContract,
  segmentShotDecomposerExample,
} from "./segment-shot-decomposer-contract.ts";

test("the prompt example is valid against the same Zod stage contract", () => {
  const result = validateStructuredStageValue(
    segmentShotDecomposerContract,
    segmentShotDecomposerExample,
  );
  assert.equal(result.status, "valid");
});

test("JSON Schema is generated from the Zod contract", () => {
  const jsonSchema = structuredStageJsonSchema(segmentShotDecomposerContract);
  assert.equal(jsonSchema.$ref, "#/definitions/segment_shot_decomposer_contract");
  const definitions = jsonSchema.definitions as Record<string, Record<string, unknown>>;
  assert.equal(definitions.segment_shot_decomposer_contract.type, "object");
});

test("safe aliases normalize but lossy prop objects remain contract failures", () => {
  const safeAlias = structuredClone(segmentShotDecomposerExample) as unknown as Record<string, any>;
  const description =
    safeAlias.shot_decomposer_plan.segment_render_descriptions[0] as Record<string, any>;
  description.motion_contract.prop_paths = [{ path: "cards move to the table" }];
  const normalized = validateStructuredStageValue(segmentShotDecomposerContract, safeAlias);
  assert.equal(normalized.status, "valid");

  const lossyObject = structuredClone(segmentShotDecomposerExample) as unknown as Record<string, any>;
  const lossyDescription =
    lossyObject.shot_decomposer_plan.segment_render_descriptions[0] as Record<string, any>;
  lossyDescription.motion_contract.prop_paths = [{
    path: "cards move to the table",
    confidence: 0.5,
  }];
  const invalid = validateStructuredStageValue(segmentShotDecomposerContract, lossyObject);
  assert.equal(invalid.status, "repairable");
  if (invalid.status !== "repairable") return;
  assert.ok(invalid.issues.some((issue) =>
    issue.path.includes("motion_contract.prop_paths[0]")
    && issue.kind === "shape"
  ));
});

test("motion_steps above the contract limit is a semantic issue", () => {
  const value = structuredClone(segmentShotDecomposerExample) as unknown as Record<string, any>;
  value.shot_decomposer_plan.segment_render_descriptions[0]
    .video_prompt_contract.motion_steps.push("A fourth independent movement.");
  const result = validateStructuredStageValue(segmentShotDecomposerContract, value);
  assert.equal(result.status, "repairable");
  if (result.status !== "repairable") return;
  assert.ok(result.issues.some((issue) =>
    issue.path.endsWith(".video_prompt_contract.motion_steps")
    && issue.kind === "semantic"
  ));
});

test("empty endpoint and single-take contracts are rejected before final audit", () => {
  const value = structuredClone(segmentShotDecomposerExample) as unknown as Record<string, any>;
  const description = value.shot_decomposer_plan.segment_render_descriptions[0];
  description.start_frame_contract = {};
  description.end_frame_contract = {};
  description.single_take_contract = {};
  const result = validateStructuredStageValue(segmentShotDecomposerContract, value);
  assert.equal(result.status, "repairable");
  if (result.status !== "repairable") return;
  for (const field of [
    "start_frame_contract",
    "end_frame_contract",
    "single_take_contract",
  ]) {
    assert.ok(result.issues.some((issue) => issue.path.endsWith(`.${field}`)));
  }
});

test("unchanged stage, segment, schema version, and issue fingerprint stops at two", () => {
  const identity = structuredContractIssueFingerprint(
    {
      stage: "shot_decomposer_s2",
      segment: 2,
      schemaVersion: segmentShotDecomposerContract.version,
    },
    [{
      path: "$.shot_decomposer_plan.segment_render_descriptions[0].motion_contract.prop_paths[0]",
      code: "invalid_type",
      kind: "shape",
      message: "Expected string, received object",
    }],
  );
  const first = advanceStructuredFailureState(undefined, identity);
  const second = advanceStructuredFailureState(first, identity);
  assert.equal(first.count, 1);
  assert.equal(shouldStopStructuredFailureRetry(first), false);
  assert.equal(second.count, 2);
  assert.equal(shouldStopStructuredFailureRetry(second), true);
});

test("a changed issue fingerprint resets the consecutive count", () => {
  const base = {
    stage: "shot_decomposer_s2",
    segment: 2,
    schemaVersion: segmentShotDecomposerContract.version,
  };
  const firstIdentity = structuredContractIssueFingerprint(base, [{
    path: "$.a",
    code: "invalid_type",
    kind: "shape" as const,
    message: "Expected string",
  }]);
  const changedIdentity = structuredContractIssueFingerprint(base, [{
    path: "$.b",
    code: "too_big",
    kind: "semantic" as const,
    message: "Array must contain at most 3 elements",
  }]);
  const first = advanceStructuredFailureState(undefined, firstIdentity);
  const changed = advanceStructuredFailureState(first, changedIdentity);
  assert.equal(changed.count, 1);
});
