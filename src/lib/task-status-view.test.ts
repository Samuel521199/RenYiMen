import test from "node:test";
import assert from "node:assert/strict";
import {
  DANCE_MOVE_LOADING_HINTS,
  S2V_LOADING_HINTS,
  buildTaskViewerModel,
  computePseudoProgressPercent,
  resolveExpectedDurationMsForSku,
} from "./task-status-view.ts";

test("dance motion transfer exposes its 377 second estimate and tailored progress hints", () => {
  assert.equal(
    resolveExpectedDurationMsForSku({ skuId: "BAILIAN_WAN22_ANIMATE_MOVE" }),
    377_000,
  );
  const model = buildTaskViewerModel(
    { status: "running" },
    {
      isPolling: true,
      transportError: null,
      consecutiveErrors: 0,
      elapsedMs: 60_000,
      expectedDurationMs: 377_000,
      skuId: "BAILIAN_WAN22_ANIMATE_MOVE",
    },
  );
  assert.equal(model.phase, "loading");
  assert.equal(model.expectedDurationMs, 377_000);
  assert.deepEqual(model.hints, DANCE_MOVE_LOADING_HINTS);
});

test("talking character video exposes the official 5-10 minute range through a midpoint estimate", () => {
  assert.equal(resolveExpectedDurationMsForSku({ skuId: "BAILIAN_WAN22_S2V" }), 450_000);
  const model = buildTaskViewerModel(
    { status: "running" },
    {
      isPolling: true,
      transportError: null,
      consecutiveErrors: 0,
      elapsedMs: 120_000,
      expectedDurationMs: 450_000,
      skuId: "BAILIAN_WAN22_S2V",
    },
  );
  assert.deepEqual(model.hints, S2V_LOADING_HINTS);
});

test("pseudo progress follows elapsed time instead of jumping ahead with ease-out", () => {
  const expectedMs = 377_000;
  assert.equal(Math.round(computePseudoProgressPercent(245_000, expectedMs)), 65);
  assert.equal(computePseudoProgressPercent(expectedMs, expectedMs), 95);

  const overtime = computePseudoProgressPercent(expectedMs * 2, expectedMs);
  assert.ok(overtime > 95);
  assert.ok(overtime < 99);
  assert.equal(computePseudoProgressPercent(-1, expectedMs), 0);
});
