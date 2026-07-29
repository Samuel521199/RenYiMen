import assert from "node:assert/strict";
import test from "node:test";
import {
  StoryboardStageError,
  isRetryableStoryboardStageError,
  runStoryboardStageWithRetry,
  storyboardContractValidationFeedback,
  storyboardStageHttpStatus,
} from "./storyboard-stage-retry";
import { StructuredOutputSyntaxError } from "./structured-output-error";
import {
  clearPlannerCheckpointFailureAfterStageSuccess,
  mapWithConcurrency,
  invalidatePlannerCheckpointAfterFailure,
  migrateCheckpointV12ToV13,
  migrateCheckpointV13ToV14,
  mergeTargetedShotDecomposerRepair,
  normalizeAliyunStoryboardPlannerCheckpoint,
  parseScopedPlannerFailureStage,
} from "./three-stage-planner";

test("shot decomposer retry only reruns the failed stage", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await runStoryboardStageWithRetry({
    stage: "shot_decomposer_s4",
    maxAttempts: 3,
    baseDelayMs: 2000,
    run: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new StoryboardStageError("first chunk timeout", {
          code: "first_chunk_timeout",
          retryable: true,
        });
      }
      return "segment-4";
    },
    sleep: async (delayMs) => { delays.push(delayMs); },
  });

  assert.equal(result, "segment-4");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test("scoped shot stage parsing identifies the base stage and segment", () => {
  assert.deepEqual(parseScopedPlannerFailureStage("shot_decomposer_s4"), {
    raw: "shot_decomposer_s4",
    baseStage: "shot_decomposer",
    segmentNo: 4,
  });
  assert.deepEqual(parseScopedPlannerFailureStage("storyboard_artist"), {
    raw: "storyboard_artist",
    baseStage: "storyboard_artist",
  });
});

test("scoped shot contract failure invalidates only the failed segment", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.shotDecomposerSegmentPlans = {
    "1": { segment: 1 },
    "3": { segment: 3 },
    "4": { segment: 4 },
  };
  checkpoint.approvedShotDecomposerSegmentPlans = {
    "1": { approved: 1 },
    "3": { approved: 3 },
    "4": { approved: 4 },
  };
  checkpoint.promptDetailSegmentPlans = {
    "1": { segmentVideoPrompts: [] },
    "3": { segmentVideoPrompts: [] },
    "4": { segmentVideoPrompts: [] },
  };

  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "shot_decomposer_s4",
    new StoryboardStageError("segment 4 motion contract missing", {
      code: "contract_validation_error",
      retryable: false,
      stage: "shot_decomposer_s4",
    }),
  );

  assert.deepEqual(Object.keys(checkpoint.shotDecomposerSegmentPlans), ["1", "3"]);
  assert.deepEqual(Object.keys(checkpoint.approvedShotDecomposerSegmentPlans), ["1", "3"]);
  assert.deepEqual(Object.keys(checkpoint.promptDetailSegmentPlans), ["1", "3"]);
  assert.equal(checkpoint.resumeFromStage, "shot_decomposer");
  assert.equal(checkpoint.lastFailure?.stage, "shot_decomposer_s4");
});

test("checkpoint normalization preserves bounded structured diagnostics", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.structuredFailures = {
    "shot_decomposer_s4:segment=4:schema=segment-shot-decomposer-v1": {
      stage: "shot_decomposer_s4",
      segment: 4,
      schemaVersion: "segment-shot-decomposer-v1",
      issueFingerprint: "fingerprint",
      count: 2,
      lastSeenAt: new Date().toISOString(),
      issues: [{
        path: "$.motion_contract.camera_motion",
        code: "invalid_type",
        kind: "shape",
        message: "Required",
      }],
      candidatePreview: { authorization: "secret", prompt: "safe" },
      systemic: true,
      affectedSegments: [2, 4],
    },
  };

  const normalized = normalizeAliyunStoryboardPlannerCheckpoint(checkpoint, input);
  const failure = Object.values(normalized.structuredFailures ?? {})[0];
  assert.equal(failure.issues?.[0]?.path, "$.motion_contract.camera_motion");
  assert.deepEqual(failure.affectedSegments, [2, 4]);
  assert.equal((failure.candidatePreview as Record<string, unknown>).authorization, "[redacted]");
});

test("non-retryable upstream errors fail immediately", async () => {
  let attempts = 0;
  await assert.rejects(() => runStoryboardStageWithRetry({
    stage: "shot_decomposer_s2",
    maxAttempts: 3,
    baseDelayMs: 0,
    run: async () => {
      attempts += 1;
      throw new StoryboardStageError("bad request", {
        code: "upstream_http_error",
        retryable: false,
        httpStatus: 400,
      });
    },
  }), /bad request/);
  assert.equal(attempts, 1);
});

test("an aborted batch never starts or retries the stage", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("peer failed", "AbortError"));
  let attempts = 0;

  await assert.rejects(
    () => runStoryboardStageWithRetry({
      stage: "asset_visual_spec_anchor_logo",
      maxAttempts: 3,
      baseDelayMs: 0,
      signal: controller.signal,
      run: async () => {
        attempts += 1;
        return "should-not-run";
      },
    }),
    (error: unknown) => (
      error instanceof StoryboardStageError
      && error.code === "batch_cancelled"
      && error.retryable === false
    ),
  );
  assert.equal(attempts, 0);
});

test("batch cancellation interrupts retry backoff without starting another request", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let backoffStarted!: () => void;
  const reachedBackoff = new Promise<void>((resolve) => { backoffStarted = resolve; });

  const pending = runStoryboardStageWithRetry({
    stage: "asset_visual_spec_anchor_logo",
    maxAttempts: 3,
    baseDelayMs: 10_000,
    signal: controller.signal,
    run: async () => {
      attempts += 1;
      throw new StoryboardStageError("invalid contract", {
        code: "contract_validation_error",
        retryable: true,
      });
    },
    sleep: async () => {
      backoffStarted();
      await new Promise<void>(() => undefined);
    },
  });

  await reachedBackoff;
  controller.abort(new DOMException("peer failed", "AbortError"));
  await assert.rejects(
    pending,
    (error: unknown) => (
      error instanceof StoryboardStageError
      && error.code === "batch_cancelled"
    ),
  );
  assert.equal(attempts, 1);
});

test("structured output syntax errors retry only the current model stage", async () => {
  let attempts = 0;
  const result = await runStoryboardStageWithRetry({
    stage: "reference_fact_extractor",
    maxAttempts: 2,
    baseDelayMs: 0,
    run: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new StructuredOutputSyntaxError(
          "reference_fact_extractor",
          "local and model syntax repair failed",
        );
        assert.equal(error.code, "STRUCTURED_OUTPUT_SYNTAX_ERROR");
        assert.equal(error.classification, "stage_repairable");
        assert.equal(error.stageRetryable, true);
        assert.equal(error.jobRetryable, false);
        throw error;
      }
      return { reference_facts: [] };
    },
  });

  assert.deepEqual(result, { reference_facts: [] });
  assert.equal(attempts, 2);
});

test("network failures are retryable but ordinary validation errors are not", () => {
  assert.equal(isRetryableStoryboardStageError(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(isRetryableStoryboardStageError(new Error("invalid storyboard JSON")), false);
  assert.equal(isRetryableStoryboardStageError(new StoryboardStageError("invalid model contract", {
    code: "contract_validation_error",
    retryable: true,
  })), true);
  assert.equal(isRetryableStoryboardStageError(new StructuredOutputSyntaxError(
    "reference_fact_extractor",
    "invalid JSON",
  )), true);
});

test("strict schema errors retain field-level feedback for the next model attempt", () => {
  const error = new StoryboardStageError("Strict JSON Schema validation failed", {
    code: "contract_validation_error",
    retryable: true,
    validationErrors: [
      "$.video_prompt_contract.motion_steps: expected at most 3 items",
      "$.motion_contract.prop_paths[0]: expected string, received object",
    ],
  });

  assert.equal(
    storyboardContractValidationFeedback(error),
    "$.video_prompt_contract.motion_steps: expected at most 3 items; $.motion_contract.prop_paths[0]: expected string, received object",
  );
});

test("concurrent mapping stops scheduling queued work and waits for in-flight work before rejecting", async () => {
  const started: number[] = [];
  const completed: number[] = [];
  let releaseSecond!: () => void;
  const secondInFlight = new Promise<void>((resolve) => { releaseSecond = resolve; });

  const pending = mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
    started.push(item);
    if (item === 1) throw new Error("segment 1 failed");
    if (item === 2) {
      await secondInFlight;
      completed.push(item);
    }
    return item;
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [1, 2]);
  releaseSecond();
  await assert.rejects(pending, /segment 1 failed/);
  assert.deepEqual(completed, [2]);
  assert.deepEqual(started, [1, 2]);
});

test("timeouts and upstream failures use gateway status codes", () => {
  assert.equal(storyboardStageHttpStatus(new StoryboardStageError("timeout", {
    code: "first_chunk_timeout",
    retryable: true,
  })), 504);
  assert.equal(storyboardStageHttpStatus(new StoryboardStageError("busy", {
    code: "upstream_http_error",
    retryable: true,
    httpStatus: 503,
  })), 503);
  assert.equal(storyboardStageHttpStatus(new Error("invalid local input")), 400);
});

test("planner checkpoints are reused only when the input fingerprint matches", () => {
  const input = {
    userPrompt: "一个游戏广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference.png"],
  };
  const initial = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const stored = {
    plannerCheckpoint: {
      ...initial,
      planningRaw: { ok: true },
      shotDecomposerSegmentPlans: { "4": { segment: 4 } },
      approvedShotDecomposerSegmentPlans: { "4": { approved: true } },
      promptDetailSegmentPlans: {
        "4": {
          segmentVideoPrompts: [{ segmentNo: 4, videoPromptZh: "连续镜头" }],
        },
      },
    },
  };
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint(stored, input);
  assert.deepEqual(resumed.planningRaw, { ok: true });
  assert.deepEqual(resumed.shotDecomposerSegmentPlans?.["4"], { segment: 4 });
  assert.deepEqual(resumed.approvedShotDecomposerSegmentPlans?.["4"], { approved: true });
  assert.equal(resumed.promptDetailSegmentPlans?.["4"]?.segmentVideoPrompts?.[0]?.segmentNo, 4);

  const changed = normalizeAliyunStoryboardPlannerCheckpoint(stored, { ...input, userPrompt: "修改后的游戏广告" });
  assert.equal(changed.planningRaw, undefined);
  assert.deepEqual(changed.shotDecomposerSegmentPlans, {});
  assert.deepEqual(changed.approvedShotDecomposerSegmentPlans, {});
  assert.deepEqual(changed.promptDetailSegmentPlans, {});
});

test("prompt contract changes invalidate only prompt compilation", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 45,
    referenceImageUrls: [],
  };
  const current = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const migrated = normalizeAliyunStoryboardPlannerCheckpoint({
    plannerCheckpoint: {
      ...current,
      referenceFactsRaw: { reusable: true },
      planningCoreRaw: { story: true },
      planningRaw: { assets: true },
      storyboardArtistPlan: { storyboard: true },
      shotDecomposerSegmentPlans: { "1": { shot: true } },
      promptDetailSegmentPlans: { "1": { segmentVideoPrompts: [] } },
      contractVersions: {
        ...current.contractVersions,
        prompt_compilation: "legacy-prompt-contract-v1",
      },
    },
  }, input);

  assert.deepEqual(migrated.referenceFactsRaw, { reusable: true });
  assert.deepEqual(migrated.planningCoreRaw, { story: true });
  assert.deepEqual(migrated.planningRaw, { assets: true });
  assert.deepEqual(migrated.storyboardArtistPlan, { storyboard: true });
  assert.deepEqual(migrated.shotDecomposerSegmentPlans?.["1"], { shot: true });
  assert.deepEqual(migrated.promptDetailSegmentPlans, {});
  assert.deepEqual(migrated.migrationAudit?.invalidatedStages, ["prompt_compilation"]);
});

test("version 12 split checkpoints migrate stage by stage without discarding reusable work", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 45,
    referenceImageUrls: [],
  };
  const current = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const migrated = normalizeAliyunStoryboardPlannerCheckpoint({
    plannerCheckpoint: {
      ...current,
      version: 12,
      planningDecompositionMode: "split",
      referenceFactsRaw: { reusable: true },
      planningCoreRaw: { core: true },
      planningRaw: { planning: true },
      shotDecomposerSegmentPlans: { "1": { segment: 1 } },
      approvedShotDecomposerSegmentPlans: { "1": { approved: true } },
      promptDetailSegmentPlans: { "1": { segmentVideoPrompts: [] } },
    },
  }, input);

  assert.equal(migrated.version, 14);
  assert.deepEqual(migrated.referenceFactsRaw, { reusable: true });
  assert.deepEqual(migrated.planningCoreRaw, { core: true });
  assert.deepEqual(migrated.planningRaw, { planning: true });
  assert.deepEqual(migrated.shotDecomposerSegmentPlans?.["1"], { segment: 1 });
  assert.deepEqual(migrated.promptDetailSegmentPlans?.["1"]?.segmentVideoPrompts, []);
});

test("explicit V12 to V13 to V14 migrators build the required checkpoint envelope", () => {
  const v12 = {
    version: 12,
    planningDecompositionMode: "split",
    inputFingerprint: "input",
    inputSnapshot: { userPrompt: "A product film" },
    referenceFactsRaw: { facts: true },
    referenceFactsFingerprint: "refs",
    planningCoreRaw: { story: true },
    updatedAt: new Date(0).toISOString(),
  };
  const v13 = migrateCheckpointV12ToV13(v12);
  const v14 = migrateCheckpointV13ToV14(v13);
  assert.equal(v13.checkpointVersion, 13);
  assert.equal(v14.checkpointVersion, 14);
  assert.equal(v14.plannerMode, "split");
  assert.deepEqual(v14.completedStages, ["reference_analysis", "story_architect"]);
  assert.deepEqual(
    (v14.stageOutputs as Record<string, unknown>).reference_analysis,
    { facts: true },
  );
  assert.equal(v14.referenceFingerprint, "refs");
  assert.equal(typeof (v14.contractVersions as Record<string, unknown>).story_architect, "string");
});

test("story input changes preserve reference analysis and invalidate story architect downstream", () => {
  const input = {
    userPrompt: "Original product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference.png"],
  };
  const initial = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint({
    ...initial,
    referenceFactsRaw: { reusable: true },
    planningCoreRaw: { oldStory: true },
    planningRaw: { oldAssets: true },
    storyboardArtistPlan: { oldStoryboard: true },
  }, { ...input, userPrompt: "Changed product story" });
  assert.deepEqual(resumed.referenceFactsRaw, { reusable: true });
  assert.equal(resumed.planningCoreRaw, undefined);
  assert.equal(resumed.planningRaw, undefined);
  assert.equal(resumed.storyboardArtistPlan, undefined);
  assert.equal(resumed.resumeFromStage, "planning_architect");
  assert.ok(resumed.migrationAudit?.preservedStages.includes("reference_analysis"));
});

test("reference changes invalidate reference analysis and all dependent stages", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference-a.png"],
  };
  const initial = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint({
    ...initial,
    referenceFactsRaw: { oldFacts: true },
    planningCoreRaw: { oldStory: true },
  }, {
    ...input,
    referenceImageUrls: ["https://example.com/reference-b.png"],
  });
  assert.equal(resumed.referenceFactsRaw, undefined);
  assert.equal(resumed.planningCoreRaw, undefined);
  assert.equal(resumed.resumeFromStage, "reference_fact_extractor");
  assert.equal(resumed.migrationAudit?.invalidatedStages[0], "reference_analysis");
});

test("reference syntax failure resumes at reference extraction rather than restarting planning", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference.png"],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.referenceFactsRaw = { invalid: true };
  checkpoint.referenceFactsFingerprint = "old";
  checkpoint.planningCoreRaw = { stale: true };
  checkpoint.planningRaw = { stale: true };

  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "reference_fact_extractor",
    new StructuredOutputSyntaxError(
      "reference_fact_extractor",
      "JSON remained invalid",
    ),
  );

  assert.equal(checkpoint.referenceFactsRaw, undefined);
  assert.equal(checkpoint.referenceFactsFingerprint, undefined);
  assert.equal(checkpoint.planningCoreRaw, undefined);
  assert.equal(checkpoint.planningRaw, undefined);
  assert.equal(checkpoint.resumeFromStage, "reference_fact_extractor");
  assert.equal(checkpoint.lastFailure?.code, "STRUCTURED_OUTPUT_SYNTAX_ERROR");
});

test("successful retry clears the matching checkpoint failure", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: ["https://example.com/reference.png"],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "reference_fact_extractor",
    new StructuredOutputSyntaxError(
      "reference_fact_extractor",
      "JSON remained invalid",
    ),
  );

  const cleared = clearPlannerCheckpointFailureAfterStageSuccess(
    checkpoint,
    "reference_fact_extractor",
  );

  assert.equal(cleared, true);
  assert.equal(checkpoint.lastFailure, undefined);
  assert.equal(checkpoint.resumeFromStage, undefined);
});

test("an unrelated earlier stage cannot clear a later checkpoint failure", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "shot_decomposer",
    new StoryboardStageError("shot failed", {
      code: "contract_validation_error",
      retryable: false,
      stage: "shot_decomposer",
    }),
  );

  const cleared = clearPlannerCheckpointFailureAfterStageSuccess(
    checkpoint,
    "reference_fact_extractor",
  );

  assert.equal(cleared, false);
  assert.equal(checkpoint.lastFailure?.stage, "shot_decomposer");
});

test("completing a stage family clears its segment-scoped failure", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.lastFailure = {
    fingerprint: "segment-failure",
    stage: "shot_decomposer_s4",
    code: "STRUCTURED_OUTPUT_SYNTAX_ERROR",
    count: 1,
    invalidatedAt: new Date().toISOString(),
  };
  checkpoint.resumeFromStage = "shot_decomposer";

  const cleared = clearPlannerCheckpointFailureAfterStageSuccess(
    checkpoint,
    "shot_decomposer",
  );

  assert.equal(cleared, true);
  assert.equal(checkpoint.lastFailure, undefined);
  assert.equal(checkpoint.resumeFromStage, undefined);
});

test("UI display and Worker version changes are excluded from planner input invalidation", () => {
  const input = {
    userPrompt: "Product story",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const initial = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const stored = {
    ...initial,
    planningCoreRaw: { preserved: true },
    planningRaw: { preserved: true },
    inputSnapshot: {
      ...initial.inputSnapshot,
      displayPromptZh: "旧中文展示",
      workerVersion: "worker-old",
    },
  };
  const resumed = normalizeAliyunStoryboardPlannerCheckpoint(stored, {
    ...input,
    displayPromptZh: "新中文展示",
    workerVersion: "worker-new",
  } as typeof input);
  assert.deepEqual(resumed.planningCoreRaw, { preserved: true });
  assert.deepEqual(resumed.planningRaw, { preserved: true });
  assert.deepEqual(resumed.migrationAudit?.invalidatedStages, []);
});

test("version 12 legacy planning output is explicitly migrated by preserving only upstream reference facts", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 45,
    referenceImageUrls: [],
  };
  const current = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const migrated = normalizeAliyunStoryboardPlannerCheckpoint({
    plannerCheckpoint: {
      ...current,
      version: 12,
      planningDecompositionMode: "legacy",
      referenceFactsRaw: { reusable: true },
      planningRaw: { legacy: true },
      storyboardArtistPlan: { legacy: true },
      shotDecomposerSegmentPlans: { "1": { legacy: true } },
    },
  }, input);

  assert.equal(migrated.version, 14);
  assert.equal(migrated.planningDecompositionMode, "split");
  assert.deepEqual(migrated.referenceFactsRaw, { reusable: true });
  assert.equal(migrated.planningRaw, undefined);
  assert.equal(migrated.storyboardArtistPlan, undefined);
  assert.deepEqual(migrated.shotDecomposerSegmentPlans, {});
});

test("asset contract failure preserves reusable planning input but invalidates failed repair and every downstream checkpoint", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.referenceFactsRaw = { facts: true };
  checkpoint.planningRaw = { planning: true };
  checkpoint.assetPromptRepairRaw = { invalid: true };
  checkpoint.assetVisualSpecsByAnchorId = { product: { invalid: true } };
  checkpoint.storyboardArtistPlan = { storyboard: true };
  checkpoint.shotDecomposerSegmentPlans = { "1": { segment: 1 } };
  checkpoint.approvedShotDecomposerSegmentPlans = { "1": { approved: true } };
  checkpoint.promptDetailSegmentPlans = { "1": { segmentVideoPrompts: [] } };

  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "asset_prompt_contract_repair",
    new StoryboardStageError("asset contract invalid", {
      code: "contract_validation_error",
      retryable: false,
      stage: "asset_prompt_contract_repair",
      validationErrors: ["product.imagePromptEn: required"],
    }),
  );

  assert.deepEqual(checkpoint.referenceFactsRaw, { facts: true });
  assert.deepEqual(checkpoint.planningRaw, { planning: true });
  assert.equal(checkpoint.assetPromptRepairRaw, undefined);
  assert.deepEqual(checkpoint.assetVisualSpecsByAnchorId, {});
  assert.equal(checkpoint.storyboardArtistPlan, undefined);
  assert.deepEqual(checkpoint.shotDecomposerSegmentPlans, {});
  assert.deepEqual(checkpoint.approvedShotDecomposerSegmentPlans, {});
  assert.deepEqual(checkpoint.promptDetailSegmentPlans, {});
  assert.equal(checkpoint.resumeFromStage, "asset_prompt_contract_repair");
  assert.equal(checkpoint.lastFailure?.count, 1);
});

test("planning contract failure resumes from the repair boundary without discarding planning or asset work", () => {
  const input = {
    userPrompt: "一个游戏广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  checkpoint.referenceFactsRaw = { facts: true };
  checkpoint.planningCoreRaw = { events: true };
  checkpoint.planningRaw = { planning: true };
  checkpoint.assetVisualSpecsByAnchorId = { character: { complete: true } };
  checkpoint.storyboardArtistPlan = { stale: true };
  checkpoint.shotDecomposerSegmentPlans = { "1": { stale: true } };

  invalidatePlannerCheckpointAfterFailure(
    checkpoint,
    "planning_contract_repair",
    new StoryboardStageError("event order remains invalid", {
      code: "contract_validation_error",
      retryable: false,
      stage: "planning_contract_repair",
      validationErrors: [
        "STRATEGY_FUNCTION_ORDER_INVALID@creative_strategy.conflict_event_ids",
      ],
    }),
  );

  assert.deepEqual(checkpoint.referenceFactsRaw, { facts: true });
  assert.deepEqual(checkpoint.planningCoreRaw, { events: true });
  assert.deepEqual(checkpoint.planningRaw, { planning: true });
  assert.deepEqual(checkpoint.assetVisualSpecsByAnchorId, { character: { complete: true } });
  assert.equal(checkpoint.storyboardArtistPlan, undefined);
  assert.deepEqual(checkpoint.shotDecomposerSegmentPlans, {});
  assert.equal(checkpoint.resumeFromStage, "planning_contract_repair");
});

test("identical deterministic checkpoint failures retain a stable fingerprint and increment the occurrence count", () => {
  const input = {
    userPrompt: "一个产品广告",
    aspectRatio: "9:16" as const,
    durationSeconds: 30,
    referenceImageUrls: [],
  };
  const checkpoint = normalizeAliyunStoryboardPlannerCheckpoint(undefined, input);
  const failure = new StoryboardStageError("asset contract invalid", {
    code: "contract_validation_error",
    retryable: false,
    stage: "asset_prompt_contract_repair",
    validationErrors: ["product.imagePromptEn: required"],
  });

  invalidatePlannerCheckpointAfterFailure(checkpoint, "asset_prompt_contract_repair", failure);
  const fingerprint = checkpoint.lastFailure?.fingerprint;
  invalidatePlannerCheckpointAfterFailure(checkpoint, "asset_prompt_contract_repair", failure);

  assert.equal(checkpoint.lastFailure?.fingerprint, fingerprint);
  assert.equal(checkpoint.lastFailure?.count, 2);
});

test("targeted split repair merges partial fields without deleting the approved segment contracts", () => {
  const original = {
    segments: [{
      segment_no: 5,
      purpose_zh: "CTA",
      duration_seconds: 6,
      subject_motion: "Logo fade in",
      motion: "Logo fade in over the table",
    }],
    keyframes: [{ keyframe_no: 5 }, { keyframe_no: 6 }],
    segment_render_descriptions: [{
      segment_no: 5,
      start_frame_contract: { state: "牌桌空镜" },
      end_frame_contract: { state: "品牌结尾" },
      motion_contract: { path: "镜头连续推进" },
      single_take_contract: { requires_cut: false, subject_path: "Logo fade in" },
      video_prompt_contract: { motion_steps: ["Logo fade in"] },
    }],
  };
  const repair = {
    title: "unauthorized rewrite",
    segments: [{
      segment_no: 5,
      subject_motion: "实体品牌牌从桌后连续滑入画面",
      motion: "镜头连续推进，实体品牌牌从桌后滑入并保持静止",
    }, {
      segment_no: 6,
      motion: "unauthorized neighboring segment rewrite",
    }],
    keyframes: [{ keyframe_no: 99, state: "unauthorized keyframe" }],
    segment_render_descriptions: [{
      segment_no: 5,
    }],
  };

  const merged = mergeTargetedShotDecomposerRepair(original, repair, [5]);
  const description = (merged.segment_render_descriptions as Array<Record<string, unknown>>)[0];
  assert.equal((merged.segments as unknown[]).length, 1);
  assert.equal((merged.keyframes as unknown[]).length, 2);
  assert.equal(merged.title, undefined);
  assert.deepEqual(description.start_frame_contract, { state: "牌桌空镜" });
  assert.deepEqual(description.motion_contract, { path: "镜头连续推进", subject_motion: "镜头连续推进，实体品牌牌从桌后滑入并保持静止" });
  assert.deepEqual(description.single_take_contract, { requires_cut: false, subject_path: "镜头连续推进，实体品牌牌从桌后滑入并保持静止" });
  assert.deepEqual(description.video_prompt_contract, { motion_steps: ["镜头连续推进，实体品牌牌从桌后滑入并保持静止"] });
});
