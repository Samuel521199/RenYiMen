import assert from "node:assert/strict";
import test from "node:test";
import {
  computeProjectTaskGraphSnapshot,
  type ProjectTaskGraphNode,
} from "./task-graph-progress.ts";

function node(
  id: string,
  status: ProjectTaskGraphNode["status"],
  weight: number,
  dependencyIds: string[] = [],
  patch: Partial<ProjectTaskGraphNode> = {},
): ProjectTaskGraphNode {
  return {
    id,
    type: "segment_video",
    targetId: id,
    labelZh: id,
    labelEn: id,
    required: true,
    active: true,
    weight,
    status,
    dependencyIds,
    upstreamAccepted: false,
    attempt: 1,
    estimatedDurationMs: weight,
    ...patch,
  };
}

test("progress is completed DAG weight divided by the active required denominator", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("small", "completed", 10),
    node("large", "blocked", 90, ["small"]),
  ], { nowMs: 1_000 });
  assert.equal(graph.completedWeight, 10);
  assert.equal(graph.totalWeight, 100);
  assert.equal(graph.percent, 10);
});

test("running-time estimates never inflate the completed-work numerator", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("done", "completed", 20),
    node("running", "running", 80, ["done"], {
      startedAt: new Date(0).toISOString(),
    }),
  ], { nowMs: 60_000 });
  assert.equal(graph.completedWeight, 20);
  assert.equal(graph.percent, 20);
});

test("cancelled and inactive work remains auditable without inflating the denominator", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("done", "completed", 50),
    node("pending", "blocked", 50),
    node("cancelled", "cancelled", 500, [], {
      required: false,
      active: false,
    }),
  ], { nowMs: 1_000 });
  assert.equal(graph.percent, 50);
  assert.equal(graph.totalWeight, 100);
  assert.equal(graph.cancelledTaskCount, 1);
  assert.ok(graph.nodes.some((item) => item.id === "cancelled"));
});

test("current blocker exposes upstream acceptance, elapsed time, attempts and correction", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("clip-1", "upstream_accepted", 100_000, [], {
      upstreamAccepted: true,
      upstreamTaskId: "task-123",
      startedAt: new Date(1_000).toISOString(),
      attempt: 2,
      retryReason: "continuity mismatch",
      correctionStrategy: "guided regenerate",
    }),
  ], { nowMs: 31_000 });
  assert.equal(graph.currentBlockers[0]?.upstreamAccepted, true);
  assert.equal(graph.currentBlockers[0]?.elapsedMs, 30_000);
  assert.equal(graph.currentBlockers[0]?.attempt, 2);
  assert.equal(graph.currentBlockers[0]?.retryReason, "continuity mismatch");
  assert.equal(graph.currentBlockers[0]?.correctionStrategy, "guided regenerate");
});

test("ETA follows the longest remaining dependency path instead of summing parallel branches", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("root", "completed", 10),
    node("short", "blocked", 100, ["root"]),
    node("long", "blocked", 300, ["root"]),
    node("final", "blocked", 50, ["short", "long"]),
  ], { nowMs: 1_000, durationSampleCount: 8 });
  assert.deepEqual(graph.criticalPathNodeIds, ["long", "final"]);
  assert.ok(graph.estimatedRemainingMs);
  assert.equal(graph.estimatedRemainingMs?.confidence, "high");
});

test("manual review blocks ETA instead of showing false precision", () => {
  const graph = computeProjectTaskGraphSnapshot([
    node("review", "awaiting_review", 10, [], { type: "review_gate" }),
    node("next", "blocked", 100, ["review"]),
  ], { nowMs: 1_000 });
  assert.equal(graph.estimatedRemainingMs, undefined);
  assert.match(graph.etaUnavailableReasonZh ?? "", /等待人工操作/);
});
