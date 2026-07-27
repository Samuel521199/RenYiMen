import { createHash } from "node:crypto";
import type {
  GenerationQualityReport,
  ImageRepairMode,
} from "./types";

export const REPAIR_CONVERGENCE_VERSION = "repair-convergence-v1";

export type RepairConvergenceStage =
  | "planning"
  | "story_semantic"
  | "stage2b"
  | "stage3"
  | "reference_selector"
  | "compiler"
  | "generation"
  | "composition"
  | "manual";

export type RepairObjectiveVector = [
  hardContractConflicts: number,
  missingRequiredReferences: number,
  structuralFailures: number,
  openHardIssues: number,
  regressedIssues: number,
  criticalScorePenalty: number,
];

export type RepairConvergenceTerminalState =
  | "passed"
  | "manual_review"
  | "budget_exhausted"
  | "stalled"
  | "oscillating";

export interface RepairConvergenceObservation {
  candidateId?: string;
  candidateNo?: number;
  stage: RepairConvergenceStage;
  repairMode: ImageRepairMode;
  contractRevision: string;
  objective: RepairObjectiveVector;
  stateSignature: string;
  acceptedAsBaseline: boolean;
  strictlyImproved: boolean;
  observedAt: string;
}

export interface RepairConvergenceEpisode {
  version: typeof REPAIR_CONVERGENCE_VERSION;
  episodeId: string;
  contractRevision: string;
  bestCandidateId?: string;
  bestObjective?: RepairObjectiveVector;
  stageVisits: Partial<Record<RepairConvergenceStage, number>>;
  noProgressCount: number;
  oscillationCount: number;
  observations: RepairConvergenceObservation[];
  nextRepairMode: ImageRepairMode;
  terminalState?: RepairConvergenceTerminalState;
  terminalReason?: string;
}

export interface RepairConvergencePolicy {
  maxRepairAttempts: number;
  maxStageVisits: number;
  identicalSignatureLimit: number;
  oscillationLimit: number;
}

export interface RepairConvergenceDecision {
  episode: RepairConvergenceEpisode;
  acceptedAsBaseline: boolean;
  strictlyImproved: boolean;
  mayContinueAutomatically: boolean;
  nextRepairMode: ImageRepairMode;
  terminalState?: RepairConvergenceTerminalState;
  reason: string;
}

export const DEFAULT_IMAGE_REPAIR_CONVERGENCE_POLICY: RepairConvergencePolicy = {
  maxRepairAttempts: 4,
  maxStageVisits: 2,
  identicalSignatureLimit: 2,
  oscillationLimit: 1,
};

const AUTOMATIC_REPAIR_MODES: ImageRepairMode[] = [
  "local_edit",
  "guided_regenerate",
  "full_regenerate",
];

function finiteCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function buildRepairContractRevision(input: {
  artifactId: string;
  targetContract?: unknown;
  visualContract?: unknown;
  referenceSet?: unknown;
  explicitRevision?: string;
}): string {
  return stableHash({
    artifactId: input.artifactId,
    explicitRevision: input.explicitRevision?.trim() ?? "",
    targetContract: input.targetContract ?? {},
    visualContract: input.visualContract ?? {},
    referenceSet: input.referenceSet ?? [],
  });
}

export function compareRepairObjectives(
  left: RepairObjectiveVector,
  right: RepairObjectiveVector,
): -1 | 0 | 1 {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function repairObjectiveFromQualityReport(
  report: GenerationQualityReport,
): RepairObjectiveVector {
  const activeIssues = (report.issueLedger ?? []).filter((issue) =>
    issue.status === "open" || issue.status === "regressed"
  );
  const hardContractConflicts = report.contractConflictsVerified === true
    ? report.contractConflicts?.length ?? 0
    : 0;
  const missingRequiredReferences = unique([
    ...(report.missingReferenceAnchorIds ?? []),
    ...(report.evaluationStatus === "reference_missing" ? ["reference_missing"] : []),
  ]).length;
  const structuralFailures = unique([
    ...(report.hardFailureReasons ?? []),
    ...(report.metadataIssues ?? []),
  ]).length;
  const openHardIssues = activeIssues.filter((issue) =>
    issue.severity === "hard" && issue.status === "open"
  ).length;
  const regressedIssues = activeIssues.filter((issue) => issue.status === "regressed").length;
  const scores = [
    report.identityScore,
    report.layoutScore,
    report.promptAlignmentScore,
    report.continuityScore,
    report.singleTakeScore,
    report.endFrameSimilarityScore,
    report.firstFrameConsistencyScore,
    report.checkpointOrderScore,
  ].filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const criticalScorePenalty = scores.length
    ? Math.max(0, Math.min(100, Math.round(100 - Math.min(...scores))))
    : report.passed ? 0 : 100;
  return [
    finiteCount(hardContractConflicts),
    finiteCount(missingRequiredReferences),
    finiteCount(structuralFailures),
    finiteCount(openHardIssues),
    finiteCount(regressedIssues),
    criticalScorePenalty,
  ];
}

export function repairStateSignature(input: {
  stage: RepairConvergenceStage;
  contractRevision: string;
  objective: RepairObjectiveVector;
  report: GenerationQualityReport;
}): string {
  const issueFingerprints = unique((input.report.issueLedger ?? [])
    .filter((issue) => issue.status === "open" || issue.status === "regressed")
    .map((issue) => `${issue.fingerprint}:${issue.status}:${issue.severity}`));
  // Evaluator scores fluctuate slightly. Quantization prevents random one-point
  // changes from masquerading as a new repair state.
  const signatureObjective = input.objective.map((value, index) =>
    index === input.objective.length - 1 ? Math.round(value / 5) * 5 : value
  );
  return stableHash({
    version: REPAIR_CONVERGENCE_VERSION,
    stage: input.stage,
    contractRevision: input.contractRevision,
    objective: signatureObjective,
    issueFingerprints,
    retryFromStage: input.report.retryFromStage ?? "",
  });
}

function normalizedMode(mode: ImageRepairMode): ImageRepairMode {
  return AUTOMATIC_REPAIR_MODES.includes(mode) ? mode : "local_edit";
}

function escalateRepairMode(mode: ImageRepairMode): ImageRepairMode {
  const normalized = normalizedMode(mode);
  const index = AUTOMATIC_REPAIR_MODES.indexOf(normalized);
  return AUTOMATIC_REPAIR_MODES[Math.min(index + 1, AUTOMATIC_REPAIR_MODES.length - 1)];
}

function newEpisode(contractRevision: string): RepairConvergenceEpisode {
  return {
    version: REPAIR_CONVERGENCE_VERSION,
    episodeId: stableHash(`${contractRevision}:${Date.now()}`).slice(0, 24),
    contractRevision,
    stageVisits: {},
    noProgressCount: 0,
    oscillationCount: 0,
    observations: [],
    nextRepairMode: "local_edit",
  };
}

export function repairConvergenceEpisodeFromUnknown(
  value: unknown,
): RepairConvergenceEpisode | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (
    source.version !== REPAIR_CONVERGENCE_VERSION
    || typeof source.episodeId !== "string"
    || typeof source.contractRevision !== "string"
    || !Array.isArray(source.observations)
  ) return undefined;
  return value as RepairConvergenceEpisode;
}

export function advanceRepairConvergence(input: {
  previous?: RepairConvergenceEpisode;
  stage: RepairConvergenceStage;
  repairMode: ImageRepairMode;
  contractRevision: string;
  report: GenerationQualityReport;
  candidateId?: string;
  candidateNo?: number;
  policy?: Partial<RepairConvergencePolicy>;
  observedAt?: string;
}): RepairConvergenceDecision {
  const policy = {
    ...DEFAULT_IMAGE_REPAIR_CONVERGENCE_POLICY,
    ...(input.policy ?? {}),
  };
  // A changed authoritative contract starts a fresh episode. Comparing scores
  // across different contracts would reject valid replans.
  const previous = input.previous?.contractRevision === input.contractRevision
    ? input.previous
    : undefined;
  const episode = previous
    ? {
        ...previous,
        stageVisits: { ...previous.stageVisits },
        observations: [...previous.observations],
      }
    : newEpisode(input.contractRevision);
  const objective = repairObjectiveFromQualityReport(input.report);
  const strictlyImproved = !episode.bestObjective
    || compareRepairObjectives(objective, episode.bestObjective) < 0;
  const acceptedAsBaseline = input.report.passed || strictlyImproved;
  const stateSignature = repairStateSignature({
    stage: input.stage,
    contractRevision: input.contractRevision,
    objective,
    report: input.report,
  });
  const observation: RepairConvergenceObservation = {
    candidateId: input.candidateId,
    candidateNo: input.candidateNo,
    stage: input.stage,
    repairMode: input.repairMode,
    contractRevision: input.contractRevision,
    objective,
    stateSignature,
    acceptedAsBaseline,
    strictlyImproved,
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  const previousObservation = episode.observations[episode.observations.length - 1];
  episode.observations.push(observation);
  // Bound persisted metadata while keeping enough history for A-B-A detection.
  episode.observations = episode.observations.slice(-12);
  // A visit is an entry into a stage, not every candidate produced while the
  // controller remains in that stage. This caps cross-stage bouncing without
  // accidentally reducing a four-attempt image budget to two candidates.
  if (!previousObservation || previousObservation.stage !== input.stage) {
    episode.stageVisits[input.stage] = (episode.stageVisits[input.stage] ?? 0) + 1;
  }
  episode.noProgressCount = strictlyImproved ? 0 : episode.noProgressCount + 1;
  if (acceptedAsBaseline) {
    episode.bestObjective = objective;
    episode.bestCandidateId = input.candidateId ?? episode.bestCandidateId;
  }

  const signatures = episode.observations.map((item) => item.stateSignature);
  const identicalCount = signatures.filter((signature) => signature === stateSignature).length;
  const oscillating = signatures.length >= 3
    && signatures[signatures.length - 1] === signatures[signatures.length - 3]
    && signatures[signatures.length - 1] !== signatures[signatures.length - 2];
  if (oscillating) episode.oscillationCount += 1;

  let terminalState: RepairConvergenceTerminalState | undefined;
  let reason = strictlyImproved ? "objective_strictly_improved" : "objective_not_improved";
  if (input.report.passed) {
    terminalState = "passed";
    reason = "quality_contract_passed";
  } else if ((episode.stageVisits[input.stage] ?? 0) > policy.maxStageVisits) {
    terminalState = "manual_review";
    reason = "stage_visit_budget_exhausted";
  } else if (oscillating && episode.oscillationCount >= policy.oscillationLimit) {
    terminalState = "oscillating";
    reason = "repair_state_a_b_a_detected";
  } else if (identicalCount >= policy.identicalSignatureLimit) {
    terminalState = "stalled";
    reason = "identical_repair_state_repeated";
  } else if (episode.observations.length > policy.maxRepairAttempts + 1) {
    terminalState = "budget_exhausted";
    reason = "repair_attempt_budget_exhausted";
  } else if (!strictlyImproved && normalizedMode(input.repairMode) === "full_regenerate") {
    terminalState = "manual_review";
    reason = "full_regeneration_did_not_improve";
  }

  const nextRepairMode = terminalState
    ? "manual_review"
    : strictlyImproved
      ? normalizedMode(input.report.repairDecision?.mode ?? input.repairMode)
      : escalateRepairMode(input.repairMode);
  episode.nextRepairMode = nextRepairMode;
  episode.terminalState = terminalState;
  episode.terminalReason = terminalState ? reason : undefined;
  return {
    episode,
    acceptedAsBaseline,
    strictlyImproved,
    mayContinueAutomatically: !terminalState,
    nextRepairMode,
    terminalState,
    reason,
  };
}
