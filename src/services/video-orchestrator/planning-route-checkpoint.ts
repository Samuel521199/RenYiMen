import { createHash } from "node:crypto";
import type {
  PlanningRouteGateIssue,
  PlanningRouteGateRepair,
  PlanningRouteGateStatus,
} from "./planning-route-gate";
import type { PlanningRouteSafeFallbackInfo } from "./planning-route-safe-fallback";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";

export const ROUTE_CLASSIFICATION_CHECKPOINT_VERSION = 1 as const;
export const ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION = "route-classification-v1";

export interface RouteClassificationCheckpoint {
  stage: "route_classification";
  checkpointVersion: typeof ROUTE_CLASSIFICATION_CHECKPOINT_VERSION;
  stageContractVersion: typeof ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION;
  status: "approved" | "manual_locked";
  source: "model" | "manual";
  authority: "model" | "user";
  locked: boolean;
  routeContract: ApprovedPlanningRouteContract;
  routeContractVersion: "planning-route-v1";
  userInputFingerprint: string;
  referenceFactFingerprint: string;
  modelName: string;
  modelDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  gateResult: {
    status: Exclude<PlanningRouteGateStatus, "model_repair">;
    issues: PlanningRouteGateIssue[];
    repairs: PlanningRouteGateRepair[];
  };
  repairCount: number;
  fallbackInfo: PlanningRouteSafeFallbackInfo | null;
  createdAt: string;
  updatedAt: string;
}

export type RouteClassificationChangeKind =
  | "user_creative"
  | "reference_category_facts"
  | "sound"
  | "asset_appearance"
  | "subtitle"
  | "duration"
  | "aspect_ratio"
  | "manual_classification";

export type RouteCheckpointInvalidationReason =
  | "CHECKPOINT_MISSING"
  | "CONTRACT_VERSION_CHANGED"
  | "USER_CREATIVE_CHANGED"
  | "REFERENCE_CATEGORY_FACTS_CHANGED";

export interface RouteCheckpointReuseDecision {
  reuse: boolean;
  reason: "UNCHANGED" | "MANUAL_LOCKED" | "NON_ROUTE_CHANGE_ONLY" | RouteCheckpointInvalidationReason;
}

function fingerprint(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function routeUserInputFingerprint(params: {
  userCreative: string;
  explicitRouteConstraints?: string[];
}): string {
  return fingerprint({
    userCreative: params.userCreative.trim(),
    explicitRouteConstraints: [...new Set(params.explicitRouteConstraints ?? [])].sort(),
  });
}

export function routeReferenceFactFingerprint(referenceFacts: unknown): string {
  return fingerprint(referenceFacts);
}

export function decideRouteCheckpointReuse(params: {
  checkpoint?: RouteClassificationCheckpoint;
  userInputFingerprint: string;
  referenceFactFingerprint: string;
  changeKinds?: RouteClassificationChangeKind[];
}): RouteCheckpointReuseDecision {
  const checkpoint = params.checkpoint;
  if (!checkpoint) return { reuse: false, reason: "CHECKPOINT_MISSING" };
  if (checkpoint.status === "manual_locked" && checkpoint.locked) {
    return { reuse: true, reason: "MANUAL_LOCKED" };
  }
  if (
    checkpoint.checkpointVersion !== ROUTE_CLASSIFICATION_CHECKPOINT_VERSION
    || checkpoint.stageContractVersion !== ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION
    || checkpoint.routeContractVersion !== "planning-route-v1"
  ) {
    return { reuse: false, reason: "CONTRACT_VERSION_CHANGED" };
  }
  const changes = new Set(params.changeKinds ?? []);
  const onlyNonRouteChanges = changes.size > 0
    && [...changes].every((change) =>
      change === "sound"
      || change === "asset_appearance"
      || change === "subtitle"
      || change === "duration"
      || change === "aspect_ratio");
  if (onlyNonRouteChanges) return { reuse: true, reason: "NON_ROUTE_CHANGE_ONLY" };
  if (checkpoint.userInputFingerprint !== params.userInputFingerprint) {
    return { reuse: false, reason: "USER_CREATIVE_CHANGED" };
  }
  if (checkpoint.referenceFactFingerprint !== params.referenceFactFingerprint) {
    return { reuse: false, reason: "REFERENCE_CATEGORY_FACTS_CHANGED" };
  }
  return { reuse: true, reason: "UNCHANGED" };
}

export function createModelRouteClassificationCheckpoint(params: {
  routeContract: ApprovedPlanningRouteContract;
  userInputFingerprint: string;
  referenceFactFingerprint: string;
  modelName: string;
  modelDurationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  gateStatus: Exclude<PlanningRouteGateStatus, "model_repair">;
  gateIssues: PlanningRouteGateIssue[];
  gateRepairs: PlanningRouteGateRepair[];
  repairCount: number;
  fallbackInfo?: PlanningRouteSafeFallbackInfo;
  now?: string;
}): RouteClassificationCheckpoint {
  const now = params.now ?? new Date().toISOString();
  return {
    stage: "route_classification",
    checkpointVersion: ROUTE_CLASSIFICATION_CHECKPOINT_VERSION,
    stageContractVersion: ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION,
    status: "approved",
    source: "model",
    authority: "model",
    locked: false,
    routeContract: structuredClone(params.routeContract),
    routeContractVersion: "planning-route-v1",
    userInputFingerprint: params.userInputFingerprint,
    referenceFactFingerprint: params.referenceFactFingerprint,
    modelName: params.modelName,
    modelDurationMs: params.modelDurationMs,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    gateResult: {
      status: params.gateStatus,
      issues: structuredClone(params.gateIssues),
      repairs: structuredClone(params.gateRepairs),
    },
    repairCount: params.repairCount,
    fallbackInfo: params.fallbackInfo ? structuredClone(params.fallbackInfo) : null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createManualLockedRouteClassificationCheckpoint(params: {
  routeContract: ApprovedPlanningRouteContract;
  userInputFingerprint: string;
  referenceFactFingerprint: string;
  editorModelName?: string;
  previous?: RouteClassificationCheckpoint;
  now?: string;
}): RouteClassificationCheckpoint {
  const now = params.now ?? new Date().toISOString();
  return {
    stage: "route_classification",
    checkpointVersion: ROUTE_CLASSIFICATION_CHECKPOINT_VERSION,
    stageContractVersion: ROUTE_CLASSIFICATION_STAGE_CONTRACT_VERSION,
    status: "manual_locked",
    source: "manual",
    authority: "user",
    locked: true,
    routeContract: structuredClone(params.routeContract),
    routeContractVersion: "planning-route-v1",
    userInputFingerprint: params.userInputFingerprint,
    referenceFactFingerprint: params.referenceFactFingerprint,
    modelName: params.editorModelName ?? "manual",
    modelDurationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    gateResult: {
      status: "allow",
      issues: [],
      repairs: [],
    },
    repairCount: 0,
    fallbackInfo: null,
    createdAt: params.previous?.createdAt ?? now,
    updatedAt: now,
  };
}
