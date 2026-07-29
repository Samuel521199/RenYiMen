import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  jsonStageReasoningPolicy,
  shouldStreamJsonStage,
} from "./three-stage-planner";

const root = process.cwd();

test("keeps creative planning thoughtful while disabling deterministic segment compilers", () => {
  assert.deepEqual(jsonStageReasoningPolicy("planning_architect"), {
    enableThinking: true,
  });
  assert.deepEqual(jsonStageReasoningPolicy("storyboard_artist"), {
    enableThinking: true,
  });
  assert.deepEqual(jsonStageReasoningPolicy("shot_decomposer_s3"), {
    enableThinking: false,
  });
  assert.deepEqual(jsonStageReasoningPolicy("prompt_detailer_s3"), {
    enableThinking: false,
  });
  assert.deepEqual(jsonStageReasoningPolicy("prompt_detailer"), {
    enableThinking: false,
  });
  assert.deepEqual(jsonStageReasoningPolicy("json_repair_shot_decomposer_s3"), {
    enableThinking: false,
  });
});

test("bounds reasoning for complex repair stages", () => {
  assert.deepEqual(jsonStageReasoningPolicy("split_repair_s5_r1"), {
    enableThinking: true,
    thinkingBudget: 512,
  });
  assert.deepEqual(jsonStageReasoningPolicy("story_contract_repair_1"), {
    enableThinking: true,
    thinkingBudget: 512,
  });
  assert.deepEqual(jsonStageReasoningPolicy("timeline_replan_r1"), {
    enableThinking: true,
    thinkingBudget: 512,
  });
});

test("stream telemetry separates transport, reasoning, and answer latency", async () => {
  const planner = await readFile(
    `${root}/src/services/video-orchestrator/three-stage-planner.ts`,
    "utf8",
  );
  assert.match(planner, /firstNetworkChunkMs/);
  assert.match(planner, /firstSseEventMs/);
  assert.match(planner, /firstReasoningChunkMs/);
  assert.match(planner, /firstAnswerChunkMs/);
  assert.match(planner, /reasoning_content/);
  assert.match(planner, /firstChunkMs:\s*firstAnswerChunkMs/);
});

test("reference fact extraction and every JSON syntax repair use non-streaming responses", () => {
  assert.equal(shouldStreamJsonStage("reference_fact_extractor", true), false);
  assert.equal(shouldStreamJsonStage("json_repair_reference_fact_extractor", true), false);
  assert.equal(shouldStreamJsonStage("json_repair_shot_decomposer_s3", true), false);
  assert.equal(shouldStreamJsonStage("json_repair_planning_architect", true), false);
  assert.equal(shouldStreamJsonStage("planning_architect", true), true);
  assert.equal(shouldStreamJsonStage("planning_architect", false), false);
});
