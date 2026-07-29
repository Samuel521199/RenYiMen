import type {
  VideoProductionJobStatus,
  VideoProductionStage,
} from "./production-job-queue";
import { structuredProductionError } from "./structured-production-error";

export type ProjectProductionProjectionStatus =
  | "DRAFT"
  | "PLANNING"
  | "PLAN_REVIEW"
  | "IMAGE_GENERATING"
  | "IMAGE_REVIEW"
  | "MICRO_SHOT_REVIEW"
  | "CLIP_GENERATING"
  | "CLIP_REVIEW"
  | "COMPOSING"
  | "FINAL_REVIEW"
  | "DONE"
  | "WAITING_RECOVERY"
  | "STATE_INVARIANT_VIOLATION";

export interface ProductionProjectionJob {
  id: string;
  kind: string;
  targetId?: string | null;
  artifactId?: string | null;
  stage: string;
  status: string;
  lastError?: string | null;
  errorCategory?: string | null;
  errorCode?: string | null;
  recoveryAction?: string | null;
  updatedAt?: Date | string;
}

export interface ProductionProjectionTaskNode {
  id: string;
  type: string;
  status: string;
  active?: boolean;
}

export interface ProjectProductionProjection {
  status: ProjectProductionProjectionStatus;
  source: "production_job" | "review_gate" | "task_graph" | "invariant";
  activeJobIds: string[];
  failedJobId?: string;
  frontierNodeId?: string;
  errorCode?: string;
  category?: string;
  retryable?: boolean;
  targetId?: string | null;
  artifactId?: string | null;
  recoveryAction?: string;
  errorMessage?: string;
  displayMessage?: {
    zh: string;
    en: string;
  };
  completedArtifactCount: number;
  totalArtifactCount: number;
}

const ACTIVE_JOB_STATUSES = new Set<VideoProductionJobStatus>([
  "queued",
  "claimed",
  "running",
  "waiting_upstream",
  "waiting_review",
]);

const TERMINAL_NODE_STATUSES = new Set(["completed", "cancelled"]);

export function projectProductionProjection(input: {
  jobs: ProductionProjectionJob[];
  taskGraphNodes: ProductionProjectionTaskNode[];
  completedArtifactCount: number;
  totalArtifactCount: number;
  finalVideoReady: boolean;
}): ProjectProductionProjection {
  const nodes = input.taskGraphNodes.filter((node) => node.active !== false);
  const activeJobs = input.jobs.filter((job) =>
    ACTIVE_JOB_STATUSES.has(job.status as VideoProductionJobStatus)
  );
  const base = {
    activeJobIds: activeJobs.map((job) => job.id),
    completedArtifactCount: input.completedArtifactCount,
    totalArtifactCount: input.totalArtifactCount,
  };

  // Executing durable work is authoritative over graph-derived review gates.
  // Downstream gates may exist in the graph before they are reachable and
  // must not project a project out of an active planning/generation phase.
  const executingJobs = activeJobs.filter((job) => job.status !== "waiting_review");
  if (executingJobs.length) {
    const authoritative = [...executingJobs].sort(compareActiveJobs)[0];
    const operationalError = authoritative.errorCode === "NO_COMPATIBLE_WORKER";
    const structuredError = operationalError
      ? structuredProductionError({
          errorCode: authoritative.errorCode || "NO_COMPATIBLE_WORKER",
          category: "scheduling",
          targetId: authoritative.targetId,
          artifactId: authoritative.artifactId,
          recoveryAction:
            authoritative.recoveryAction || "DEPLOY_COMPATIBLE_WORKER",
          message:
            authoritative.lastError || "No compatible Worker is available.",
        })
      : null;
    return {
      ...base,
      status: generatingStatusForJob(authoritative),
      source: "production_job",
      frontierNodeId: frontierNode(nodes)?.id,
      ...(operationalError
        ? {
            ...(structuredError ?? {}),
            errorMessage:
              authoritative.lastError || "No compatible Worker is available.",
          }
        : {}),
    };
  }

  const waitingReviewNode = nodes.find((node) =>
    node.status === "awaiting_review"
  );
  const waitingReviewJob = activeJobs.find((job) => job.status === "waiting_review");
  if (waitingReviewNode || waitingReviewJob) {
    const nodeId = waitingReviewNode?.id;
    return {
      ...base,
      status: reviewStatusForNode(nodeId, waitingReviewJob?.kind),
      source: "review_gate",
      frontierNodeId: nodeId,
    };
  }

  const failedJob = [...input.jobs]
    .filter((job) =>
      job.status === "failed"
      && !input.jobs.some((other) =>
        other.status === "completed"
        && sameTargetJob(other, job)
        && timestamp(other.updatedAt) > timestamp(job.updatedAt)
      )
    )
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0];
  if (failedJob) {
    const error = structuredProductionError({
      errorCode: failedJob.errorCode || "PRODUCTION_JOB_FAILED",
      category: failedJob.errorCategory,
      targetId: failedJob.targetId,
      artifactId: failedJob.artifactId,
      recoveryAction: failedJob.recoveryAction || "RETRY_JOB",
      message: failedJob.lastError,
    });
    return {
      ...base,
      status: "WAITING_RECOVERY",
      source: "production_job",
      failedJobId: failedJob.id,
      ...error,
      errorMessage: failedJob.lastError || "Production job failed",
      frontierNodeId: frontierNode(nodes)?.id,
    };
  }

  const finalReview = nodes.find((node) => node.id === "review:final");
  if (finalReview?.status === "completed") {
    return { ...base, status: "DONE", source: "task_graph" };
  }
  if (input.finalVideoReady) {
    return {
      ...base,
      status: "FINAL_REVIEW",
      source: "review_gate",
      frontierNodeId: "review:final",
    };
  }

  const frontier = frontierNode(nodes);
  if (!frontier) {
    return {
      ...base,
      status: input.totalArtifactCount === 0 ? "DRAFT" : "DONE",
      source: "task_graph",
    };
  }

  if (frontier.type === "review_gate") {
    return {
      ...base,
      status: reviewStatusForNode(frontier.id),
      source: "review_gate",
      frontierNodeId: frontier.id,
    };
  }

  return {
    ...base,
    status: "STATE_INVARIANT_VIOLATION",
    source: "invariant",
    frontierNodeId: frontier.id,
    errorCode: "STATE_INVARIANT_VIOLATION",
    recoveryAction: "REBUILD_TASK_GRAPH",
    errorMessage:
      `Task graph frontier ${frontier.id} requires work, but no active production job owns it.`,
  };
}

function generatingStatusForJob(job: ProductionProjectionJob): ProjectProductionProjectionStatus {
  if (job.kind === "planning" || job.stage === "planning") return "PLANNING";
  if (job.kind === "compose" || job.stage === "composition") return "COMPOSING";
  if (job.kind === "clip_prepare_submit") return "CLIP_GENERATING";
  return "IMAGE_GENERATING";
}

function reviewStatusForNode(
  nodeId?: string,
  jobKind?: string,
): ProjectProductionProjectionStatus {
  if (nodeId === "review:plan") return "PLAN_REVIEW";
  if (nodeId === "review:micro-shots") return "MICRO_SHOT_REVIEW";
  if (nodeId === "review:clips" || jobKind === "clip_prepare_submit") return "CLIP_REVIEW";
  if (nodeId === "review:final" || jobKind === "compose") return "FINAL_REVIEW";
  return "IMAGE_REVIEW";
}

function frontierNode(nodes: ProductionProjectionTaskNode[]): ProductionProjectionTaskNode | undefined {
  return nodes.find((node) => !TERMINAL_NODE_STATUSES.has(node.status));
}

function compareActiveJobs(left: ProductionProjectionJob, right: ProductionProjectionJob): number {
  return jobPriority(left) - jobPriority(right)
    || timestamp(left.updatedAt) - timestamp(right.updatedAt);
}

function jobPriority(job: ProductionProjectionJob): number {
  const stage = job.stage as VideoProductionStage;
  if (stage === "planning") return 0;
  if (stage === "contract_validation") return 1;
  if (stage === "provider_submission") return 2;
  if (stage === "provider_polling") return 3;
  if (stage === "quality_evaluation") return 4;
  return 5;
}

function timestamp(value: Date | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sameTargetJob(left: ProductionProjectionJob, right: ProductionProjectionJob): boolean {
  return left.kind === right.kind
    && (left.targetId || "") === (right.targetId || "")
    && (left.artifactId || "") === (right.artifactId || "");
}
