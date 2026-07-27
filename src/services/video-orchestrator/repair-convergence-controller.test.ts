import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceRepairConvergence,
  compareRepairObjectives,
  repairObjectiveFromQualityReport,
} from "./repair-convergence-controller.ts";
import type { GenerationQualityReport } from "./types.ts";

function report(input: Partial<GenerationQualityReport> = {}): GenerationQualityReport {
  return {
    assetId: "asset-1",
    identityScore: 70,
    layoutScore: 70,
    promptAlignmentScore: 70,
    continuityScore: 70,
    artifactIssues: ["hand defect"],
    passed: false,
    issueLedger: [{
      issueId: "hand",
      fingerprint: "anatomy:hand",
      category: "anatomy",
      summary: "hand defect",
      severity: "soft",
      applicableStage: "static_image",
      status: "open",
      occurrenceCount: 1,
    }],
    ...input,
  };
}

test("repair objective uses contract and reference failures before visual scores", () => {
  const objective = repairObjectiveFromQualityReport(report({
    contractConflicts: ["required logo is also forbidden"],
    contractConflictsVerified: true,
    missingReferenceAnchorIds: ["hero"],
    hardFailureReasons: ["wrong subject count"],
    issueLedger: [{
      issueId: "identity",
      fingerprint: "identity:face",
      category: "identity",
      summary: "wrong face",
      severity: "hard",
      applicableStage: "static_image",
      status: "regressed",
      occurrenceCount: 2,
    }],
  }));
  assert.deepEqual(objective, [1, 1, 1, 0, 1, 30]);
  assert.equal(compareRepairObjectives([0, 9, 9, 9, 9, 99], objective), -1);
});

test("only a strict lexicographic improvement is accepted as the next baseline", () => {
  const first = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report(),
    candidateId: "c1",
    candidateNo: 1,
  });
  const worse = advanceRepairConvergence({
    previous: first.episode,
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({
      identityScore: 60,
      layoutScore: 60,
      promptAlignmentScore: 60,
      continuityScore: 60,
    }),
    candidateId: "c2",
    candidateNo: 2,
    policy: { maxStageVisits: 10 },
  });
  assert.equal(worse.acceptedAsBaseline, false);
  assert.equal(worse.episode.bestCandidateId, "c1");
  assert.equal(worse.nextRepairMode, "guided_regenerate");
});

test("two equivalent repair states stop as stalled", () => {
  const first = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report(),
  });
  const second = advanceRepairConvergence({
    previous: first.episode,
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({ identityScore: 69 }),
    policy: { maxStageVisits: 10 },
  });
  assert.equal(second.terminalState, "stalled");
  assert.equal(second.mayContinueAutomatically, false);
});

test("A-B-A repair oscillation is detected", () => {
  const a1 = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({ identityScore: 70 }),
    policy: { identicalSignatureLimit: 9, maxStageVisits: 10 },
  });
  const b = advanceRepairConvergence({
    previous: a1.episode,
    stage: "generation",
    repairMode: "guided_regenerate",
    contractRevision: "contract-a",
    report: report({
      identityScore: 65,
      issueLedger: [{
        issueId: "layout",
        fingerprint: "layout:center",
        category: "layout",
        summary: "layout defect",
        severity: "soft",
        applicableStage: "static_image",
        status: "open",
        occurrenceCount: 1,
      }],
    }),
    policy: { identicalSignatureLimit: 9, maxStageVisits: 10 },
  });
  const a2 = advanceRepairConvergence({
    previous: b.episode,
    stage: "generation",
    repairMode: "full_regenerate",
    contractRevision: "contract-a",
    report: report({ identityScore: 71 }),
    policy: { identicalSignatureLimit: 9, maxStageVisits: 10 },
  });
  assert.equal(a2.terminalState, "oscillating");
});

test("a contract revision starts a fresh convergence episode", () => {
  const oldContract = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report(),
  });
  const newContract = advanceRepairConvergence({
    previous: oldContract.episode,
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-b",
    report: report(),
  });
  assert.equal(newContract.episode.observations.length, 1);
  assert.notEqual(newContract.episode.episodeId, oldContract.episode.episodeId);
});

test("repair attempt budget counts the initial candidate plus bounded repairs", () => {
  let decision = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({ identityScore: 50 }),
    policy: { maxRepairAttempts: 2, maxStageVisits: 10, identicalSignatureLimit: 9 },
  });
  for (const [index, score] of [55, 60, 65].entries()) {
    decision = advanceRepairConvergence({
      previous: decision.episode,
      stage: "generation",
      repairMode: "local_edit",
      contractRevision: "contract-a",
      report: report({
        identityScore: score,
        layoutScore: score,
        promptAlignmentScore: score,
        continuityScore: score,
      }),
      candidateNo: index + 2,
      policy: { maxRepairAttempts: 2, maxStageVisits: 10, identicalSignatureLimit: 9 },
    });
  }
  assert.equal(decision.episode.observations.length, 4);
  assert.equal(decision.terminalState, "budget_exhausted");
});

test("stage visit budget counts returning to a stage, not candidates within it", () => {
  const first = advanceRepairConvergence({
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({ identityScore: 50 }),
    policy: { maxStageVisits: 1, identicalSignatureLimit: 9 },
  });
  const compiler = advanceRepairConvergence({
    previous: first.episode,
    stage: "compiler",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({
      identityScore: 60,
      layoutScore: 60,
      promptAlignmentScore: 60,
      continuityScore: 60,
    }),
    policy: { maxStageVisits: 1, identicalSignatureLimit: 9 },
  });
  const returned = advanceRepairConvergence({
    previous: compiler.episode,
    stage: "generation",
    repairMode: "local_edit",
    contractRevision: "contract-a",
    report: report({
      identityScore: 70,
      layoutScore: 70,
      promptAlignmentScore: 70,
      continuityScore: 70,
    }),
    policy: { maxStageVisits: 1, identicalSignatureLimit: 9 },
  });
  assert.equal(returned.episode.stageVisits.generation, 2);
  assert.equal(returned.terminalState, "manual_review");
});
