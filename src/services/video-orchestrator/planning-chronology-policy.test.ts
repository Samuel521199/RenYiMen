import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNING_CHRONOLOGY_ERROR_CODES,
  PLANNING_CHRONOLOGY_HOOK_POLICY,
  resolveChronologyHookPolicy,
  selectChronologyMode,
  validateChronologyHookPolicy,
} from "./planning-chronology-policy";
import type { VideoChronologyMode } from "./types";

test("all chronology modes have deterministic Hook policy defaults", () => {
  const expectedModes: VideoChronologyMode[] = [
    "chronological",
    "flashforward_hook",
    "result_first",
    "problem_solution",
    "demonstration",
  ];
  assert.deepEqual(Object.keys(PLANNING_CHRONOLOGY_HOOK_POLICY), expectedModes);

  for (const chronologyMode of expectedModes) {
    const result = resolveChronologyHookPolicy({ chronologyMode });
    assert.equal(result.corrected, false);
    assert.deepEqual(result.issues, []);
  }
});

test("chronological is the default when no stronger signal exists", () => {
  assert.equal(selectChronologyMode({}), "chronological");
});

test("explicit result first outranks inferred structures", () => {
  assert.equal(selectChronologyMode({
    explicitlyRequestsFinalResultFirst: true,
    isDemonstration: true,
    hasProblemSolutionStructure: true,
  }), "result_first");
});

test("flashforward requires climax preview value and return to earlier time", () => {
  assert.equal(selectChronologyMode({
    explicitlyRequestsClimaxPreview: true,
    payoffPreviewImprovesHook: true,
    willReturnToEarlierTime: true,
  }), "flashforward_hook");
  assert.equal(selectChronologyMode({
    explicitlyRequestsClimaxPreview: true,
    payoffPreviewImprovesHook: true,
    willReturnToEarlierTime: false,
  }), "chronological");
});

test("demonstration outranks inferred problem-solution structure", () => {
  assert.equal(selectChronologyMode({
    isDemonstration: true,
    hasProblemSolutionStructure: true,
  }), "demonstration");
});

test("flashforward accepts only payoff preview with a return point", () => {
  assert.deepEqual(validateChronologyHookPolicy({
    chronologyMode: "flashforward_hook",
    hookMode: "payoff_preview",
    hookRevealLevel: "partial",
    requiresReturnPoint: true,
  }), []);

  const issues = validateChronologyHookPolicy({
    chronologyMode: "flashforward_hook",
    hookMode: "tease",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      PLANNING_CHRONOLOGY_ERROR_CODES.HOOK_MODE_MISMATCH,
      PLANNING_CHRONOLOGY_ERROR_CODES.RETURN_POINT_REQUIRED,
    ],
  );
});

test("chronological forbids full payoff reveal and return point", () => {
  const issues = validateChronologyHookPolicy({
    chronologyMode: "chronological",
    hookMode: "payoff_preview",
    hookRevealLevel: "full",
    requiresReturnPoint: true,
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      PLANNING_CHRONOLOGY_ERROR_CODES.PAYOFF_REVEAL_FORBIDDEN,
      PLANNING_CHRONOLOGY_ERROR_CODES.RETURN_POINT_FORBIDDEN,
    ],
  );
});

test("problem-solution and demonstration use distinct Hook policies", () => {
  assert.deepEqual(validateChronologyHookPolicy({
    chronologyMode: "problem_solution",
    hookMode: "pain_point",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
  }), []);
  assert.deepEqual(validateChronologyHookPolicy({
    chronologyMode: "demonstration",
    hookMode: "curiosity",
    hookRevealLevel: "partial",
    requiresReturnPoint: false,
  }), []);

  assert.equal(
    validateChronologyHookPolicy({
      chronologyMode: "problem_solution",
      hookMode: "curiosity",
      hookRevealLevel: "partial",
      requiresReturnPoint: false,
    })[0]?.code,
    PLANNING_CHRONOLOGY_ERROR_CODES.HOOK_MODE_MISMATCH,
  );
});

test("invalid combinations resolve to mode-specific deterministic defaults", () => {
  const result = resolveChronologyHookPolicy({
    chronologyMode: "result_first",
    hookMode: "pain_point",
    hookRevealLevel: "none",
    requiresReturnPoint: false,
  });
  assert.equal(result.corrected, true);
  assert.equal(result.hookMode, "payoff_preview");
  assert.equal(result.hookRevealLevel, "full");
  assert.equal(result.requiresReturnPoint, true);
});
