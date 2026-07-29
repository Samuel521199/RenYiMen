import { Prisma, VideoProjectStatus, VideoShotStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { storyboardStageErrorCode } from "./storyboard-stage-retry";
import { isStructuredOutputSyntaxError } from "./structured-output-error";
import { resolveVideoProductionRuntimeVersion } from "./production-worker-runtime";

export type VideoProductionJobKind =
  | "planning"
  | "image_prepare_submit"
  | "image_quality"
  | "micro_shot_prepare_submit"
  | "clip_prepare_submit"
  | "compose";

export const ALL_VIDEO_PRODUCTION_JOB_KINDS: readonly VideoProductionJobKind[] = [
  "planning",
  "image_prepare_submit",
  "image_quality",
  "micro_shot_prepare_submit",
  "clip_prepare_submit",
  "compose",
];

export type VideoProductionStage =
  | "planning"
  | "contract_validation"
  | "provider_submission"
  | "provider_polling"
  | "quality_evaluation"
  | "composition";

export type VideoProductionJobStatus =
  | "queued"
  | "claimed"
  | "running"
  | "waiting_upstream"
  | "waiting_review"
  | "completed"
  | "failed"
  | "cancelled";

export const ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES: readonly VideoProductionJobStatus[] = [
  "queued",
  "claimed",
  "running",
  "waiting_upstream",
  "waiting_review",
];

export type VideoProductionErrorDisposition =
  | "contract_repair_required"
  | "stage_repairable"
  | "retry"
  | "terminal";

export type VideoProductionErrorCategory =
  | "internal_capacity"
  | "provider_rate_limit"
  | "provider_quota"
  | "internal_scheduling"
  | "provider_auth"
  | "provider_network"
  | "contract_validation"
  | "structured_output_syntax"
  | "unknown";

export interface VideoProductionFailureClassification {
  disposition: VideoProductionErrorDisposition;
  category: VideoProductionErrorCategory;
  userMessageZh: string;
}

export type VideoProductionJobRecord = Awaited<ReturnType<typeof prisma.videoProductionJob.findFirst>>;

export const VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION = 2;
export const VIDEO_PRODUCTION_CONTRACT_VERSION = 2;
export const SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS = [
  VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION,
] as const;
const DEFAULT_LEASE_MS = 2 * 60_000;
const WORKER_HEARTBEAT_COMPATIBILITY_MS = 2 * 60_000;
const CAPACITY_WAIT_MAX_COUNT = 12;
const CAPACITY_WAIT_MAX_AGE_MS = 30 * 60_000;
export const DEFAULT_DEPLOYMENT_GRACE_MS = 10 * 60_000;
const INFRASTRUCTURE_RETRY_BASE_MS = 2_000;
const INFRASTRUCTURE_RETRY_MAX_MS = 60_000;

export async function enqueueVideoProductionJob(input: {
  projectId: string;
  userId: string;
  kind: VideoProductionJobKind;
  stage: VideoProductionStage;
  idempotencyKey: string;
  artifactId?: string;
  targetId: string;
  payload?: Prisma.InputJsonValue;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
  maxModelAttempts?: number;
  maxStageRepairAttempts?: number;
  maxInfrastructureAttempts?: number;
  reactivateFailed?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const targetId = normalizeTargetId(input.targetId);
  if (!targetId) {
    throw new ProductionSchedulingInvariantError(`${input.kind} requires a non-empty targetId`);
  }
  const requiredWorkerVersion = resolveVideoProductionRuntimeVersion();
  const payload = versionedPayload(
    input.payload,
    requiredWorkerVersion,
  );
  const versionedIdempotencyKey =
    `${input.idempotencyKey}:payload-${VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION}`
    + `:contract-${VIDEO_PRODUCTION_CONTRACT_VERSION}`
    + `:worker-${shortVersionKey(requiredWorkerVersion)}`;
  const activeForTarget = await prisma.videoProductionJob.findFirst({
    where: {
      kind: input.kind,
      targetId,
      artifactId: input.artifactId ?? null,
      status: { in: [...ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES] },
    },
    select: {
      id: true,
      payload: true,
      requiredWorkerVersion: true,
    },
  });
  if (activeForTarget) {
    if (
      activeForTarget.requiredWorkerVersion === requiredWorkerVersion
      && payloadHandshakeMatches(
        activeForTarget.payload,
        requiredWorkerVersion,
      )
    ) {
      return { id: activeForTarget.id, created: false };
    }
    await prisma.videoProductionJob.updateMany({
      where: {
        id: activeForTarget.id,
        status: { in: [...ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES] },
      },
      data: {
        status: "cancelled",
        completedAt: new Date(),
        leaseToken: null,
        workerId: null,
        claimedWorkerVersion: null,
        leaseExpiresAt: null,
        lastError:
          "Superseded by an explicitly enqueued job using the current payload and Worker contract.",
        errorCategory: "internal_scheduling",
        errorCode: "PAYLOAD_VERSION_SUPERSEDED",
        recoveryAction: "NONE",
      },
    });
  }
  const existing = await prisma.videoProductionJob.findUnique({
    where: { idempotencyKey: versionedIdempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) {
    if (input.reactivateFailed && existing.status === "failed") {
      const reactivated = await prisma.videoProductionJob.updateMany({
        where: {
          id: existing.id,
          status: "failed",
        },
        data: {
          status: "queued",
          stage: input.stage,
          targetId,
          artifactId: input.artifactId ?? null,
          payload,
          attempt: 0,
          maxAttempts: input.maxAttempts ?? 5,
          modelAttempt: 0,
          maxModelAttempts: input.maxModelAttempts ?? 3,
          stageRepairAttempt: 0,
          maxStageRepairAttempts: input.maxStageRepairAttempts ?? 3,
          infrastructureAttempt: 0,
          maxInfrastructureAttempts: input.maxInfrastructureAttempts ?? 50,
          leaseLossCount: 0,
          lastInterruptionReason: null,
          deploymentGraceUntil: null,
          availableAt: input.availableAt ?? new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          startedAt: null,
          completedAt: null,
          lastError: null,
          errorCategory: null,
          errorCode: null,
          recoveryAction: null,
          requiredWorkerVersion,
          claimedWorkerVersion: null,
          progressAt: new Date(),
        },
      });
      if (reactivated.count > 0) {
        return { id: existing.id, created: true };
      }
    }
    return { id: existing.id, created: false };
  }
  try {
    const created = await prisma.videoProductionJob.create({
      data: {
        projectId: input.projectId,
        userId: input.userId,
        kind: input.kind,
        stage: input.stage,
        status: "queued",
        idempotencyKey: versionedIdempotencyKey,
        artifactId: input.artifactId,
        targetId,
        requiredWorkerVersion,
        payload,
        priority: input.priority ?? 0,
        availableAt: input.availableAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
        maxModelAttempts: input.maxModelAttempts ?? 3,
        maxStageRepairAttempts: input.maxStageRepairAttempts ?? 3,
        maxInfrastructureAttempts: input.maxInfrastructureAttempts ?? 50,
      },
      select: { id: true },
    });
    await annotateNoCompatibleWorker({
      jobIds: [created.id],
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.videoProductionJob.findFirstOrThrow({
        where: {
          OR: [
            { idempotencyKey: versionedIdempotencyKey },
            {
              kind: input.kind,
              targetId,
              artifactId: input.artifactId ?? null,
              status: { in: [...ACTIVE_VIDEO_PRODUCTION_JOB_STATUSES] },
            },
          ],
        },
        select: { id: true },
      });
      return { id: raced.id, created: false };
    }
    throw error;
  }
}

export async function retryFailedVideoProductionJobById(input: {
  id: string;
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const current = await prisma.videoProductionJob.findFirst({
    where: {
      id: input.id,
      projectId: input.projectId,
      userId: input.userId,
      status: "failed",
    },
    select: {
      id: true,
      payload: true,
      recoveryAction: true,
      kind: true,
      targetId: true,
      artifactId: true,
    },
  });
  if (!current || current.recoveryAction === "REPAIR_CONTRACT") return false;
  const requiredWorkerVersion = resolveVideoProductionRuntimeVersion();
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.videoProductionJob.updateMany({
      where: {
        id: current.id,
        projectId: input.projectId,
        userId: input.userId,
        status: "failed",
      },
      data: {
        status: "queued",
        payload: versionedPayload(current.payload as Prisma.InputJsonValue, requiredWorkerVersion),
        requiredWorkerVersion,
        claimedWorkerVersion: null,
        attempt: 0,
        modelAttempt: 0,
        stageRepairAttempt: 0,
        userRetryCount: { increment: 1 },
        availableAt: new Date(),
        leaseToken: null,
        workerId: null,
        leaseExpiresAt: null,
        startedAt: null,
        completedAt: null,
        lastError: null,
        errorCategory: null,
        errorCode: null,
        recoveryAction: null,
        lastInterruptionReason: null,
        deploymentGraceUntil: null,
        progressAt: new Date(),
      },
    });
    if (result.count !== 1) return result;
    if (current.artifactId) {
      await tx.videoArtifactMetadata.updateMany({
        where: {
          projectId: input.projectId,
          artifactId: current.artifactId,
          userAccepted: false,
        },
        data: {
          status: "generating",
          retryFromStage: "generation",
        },
      });
    }
    if (current.kind === "image_prepare_submit" || current.kind === "image_quality") {
      await tx.videoKeyframe.updateMany({
        where: { id: current.targetId, projectId: input.projectId },
        data: {
          status: VideoShotStatus.IMAGE_PENDING,
          errorMessage: null,
        },
      });
    } else if (current.kind === "clip_prepare_submit") {
      await tx.videoSegment.updateMany({
        where: { id: current.targetId, projectId: input.projectId },
        data: {
          status: VideoShotStatus.CLIP_PENDING,
          errorMessage: null,
        },
      });
    }
    await tx.videoProject.update({
      where: { id: input.projectId },
      data: {
        status: current.kind === "planning"
          ? VideoProjectStatus.PLANNING
          : current.kind === "clip_prepare_submit"
            ? VideoProjectStatus.CLIP_GENERATING
            : current.kind === "compose"
              ? VideoProjectStatus.COMPOSING
              : VideoProjectStatus.IMAGE_GENERATING,
        errorMessage: null,
      },
    });
    return result;
  });
  if (updated.count === 1) {
    await annotateNoCompatibleWorker({ jobIds: [current.id] });
  }
  return updated.count === 1;
}

export async function claimNextVideoProductionJob(input: {
  workerId: string;
  runtimeVersion?: string;
  kinds?: VideoProductionJobKind[];
  supportedPayloadVersions?: readonly number[];
  leaseMs?: number;
}): Promise<NonNullable<VideoProductionJobRecord> | null> {
  const now = new Date();
  const runtimeVersion = input.runtimeVersion ?? resolveVideoProductionRuntimeVersion();
  const supportedPayloadVersions = input.supportedPayloadVersions?.length
    ? [...new Set(input.supportedPayloadVersions)]
    : [...SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS];
  await recoverLegacyLeaseExhaustedJobs(now);
  await recoverExpiredVideoProductionJobLeases(now);
  await adoptInfrastructureRecoveryJobs({
    runtimeVersion,
    kinds: input.kinds,
    supportedPayloadVersions,
  });
  const compatibilityWhere = workerCompatibilityWhere({
    runtimeVersion,
    supportedPayloadVersions,
  });

  for (let claimRace = 0; claimRace < 8; claimRace += 1) {
    const candidate = await prisma.videoProductionJob.findFirst({
      where: {
        status: { in: ["queued", "waiting_upstream"] },
        availableAt: { lte: now },
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
        ...compatibilityWhere,
      },
      orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) {
      await annotateNoCompatibleWorker({ kinds: input.kinds });
      return null;
    }
    const leaseToken = randomUUID();
    const claimed = await prisma.videoProductionJob.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        availableAt: { lte: now },
        ...compatibilityWhere,
      },
      data: {
        status: "claimed",
        leaseToken,
        workerId: input.workerId,
        claimedWorkerVersion: runtimeVersion,
        leaseExpiresAt: new Date(now.getTime() + Math.max(30_000, input.leaseMs ?? DEFAULT_LEASE_MS)),
        startedAt: candidate.startedAt ?? now,
        lastError: null,
        errorCategory: null,
        errorCode: null,
        recoveryAction: null,
        deploymentGraceUntil: null,
        ...(candidate.startedAt ? {} : { progressAt: now }),
      },
    });
    if (claimed.count !== 1) continue;
    return prisma.videoProductionJob.findUnique({ where: { id: candidate.id } }) as Promise<NonNullable<VideoProductionJobRecord>>;
  }
  return null;
}

export async function recoverExpiredVideoProductionJobLeases(
  now = new Date(),
): Promise<number> {
  const expired = await prisma.videoProductionJob.findMany({
    where: {
      status: { in: ["claimed", "running"] },
      leaseExpiresAt: { lte: now },
    },
    select: {
      id: true,
      projectId: true,
      stage: true,
      infrastructureAttempt: true,
      maxInfrastructureAttempts: true,
    },
  });
  let recovered = 0;
  for (const job of expired) {
    const nextInfrastructureAttempt = job.infrastructureAttempt + 1;
    const degraded = nextInfrastructureAttempt > job.maxInfrastructureAttempts;
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.videoProductionJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["claimed", "running"] },
          leaseExpiresAt: { lte: now },
        },
        data: {
          status: job.stage === "provider_polling" ? "waiting_upstream" : "queued",
          leaseToken: null,
          workerId: null,
          claimedWorkerVersion: null,
          leaseExpiresAt: null,
          deploymentGraceUntil: null,
          availableAt: new Date(
            now.getTime() + infrastructureRetryDelayMs(nextInfrastructureAttempt),
          ),
          infrastructureAttempt: { increment: 1 },
          leaseLossCount: { increment: 1 },
          lastInterruptionReason: "worker_lease_expired",
          lastError:
            "Worker lease expired. Durable state was preserved and automatic recovery was queued.",
          errorCategory: "internal_scheduling",
          errorCode: degraded
            ? "INFRASTRUCTURE_RECOVERY_DEGRADED"
            : "INFRASTRUCTURE_RECOVERY_QUEUED",
          recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
          completedAt: null,
        },
      });
      if (updated.count !== 1) return updated;
      await tx.videoProject.updateMany({
        where: { id: job.projectId },
        data: {
          status: VideoProjectStatus.WAITING_RECOVERY,
          errorMessage: null,
        },
      });
      return updated;
    });
    recovered += result.count;
  }
  return recovered;
}

export async function releaseVideoProductionJobForInfrastructure(input: {
  id: string;
  leaseToken: string;
  reason:
    | "worker_shutdown"
    | "deployment_restart"
    | "worker_abort"
    | "provider_network"
    | "provider_rate_limit";
  error?: unknown;
  category?: VideoProductionErrorCategory;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const current = await prisma.videoProductionJob.findFirst({
    where: {
      id: input.id,
      leaseToken: input.leaseToken,
      status: { in: ["claimed", "running"] },
    },
    select: {
      projectId: true,
      stage: true,
      infrastructureAttempt: true,
      maxInfrastructureAttempts: true,
    },
  });
  if (!current) return false;
  const degraded =
    current.infrastructureAttempt + 1 > current.maxInfrastructureAttempts;
  const interruptionMessage = input.error === undefined
    ? "Worker stopped before completion. Durable state was preserved and automatic recovery was queued."
    : input.error instanceof Error
      ? input.error.message
      : String(input.error);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.videoProductionJob.updateMany({
      where: {
        id: input.id,
        leaseToken: input.leaseToken,
        status: { in: ["claimed", "running"] },
      },
      data: {
        status: current.stage === "provider_polling" ? "waiting_upstream" : "queued",
        leaseToken: null,
        workerId: null,
        claimedWorkerVersion: null,
        leaseExpiresAt: null,
        deploymentGraceUntil: null,
        availableAt: new Date(
          now.getTime() + infrastructureRetryDelayMs(current.infrastructureAttempt + 1),
        ),
        infrastructureAttempt: { increment: 1 },
        lastInterruptionReason: input.reason,
        lastError: interruptionMessage,
        errorCategory: input.category ?? "internal_scheduling",
        errorCode: degraded
          ? "INFRASTRUCTURE_RECOVERY_DEGRADED"
          : "INFRASTRUCTURE_RECOVERY_QUEUED",
        recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
        completedAt: null,
      },
    });
    if (result.count !== 1) return result;
    await tx.videoProject.updateMany({
      where: { id: current.projectId },
      data: {
        status: VideoProjectStatus.WAITING_RECOVERY,
        errorMessage: null,
      },
    });
    return result;
  });
  return updated.count === 1;
}

export async function beginVideoProductionDeploymentDrain(input: {
  id: string;
  leaseToken: string;
  graceMs?: number;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const graceUntil = new Date(
    now.getTime() + Math.max(30_000, input.graceMs ?? DEFAULT_DEPLOYMENT_GRACE_MS),
  );
  const updated = await prisma.videoProductionJob.updateMany({
    where: {
      id: input.id,
      leaseToken: input.leaseToken,
      status: { in: ["claimed", "running"] },
    },
    data: {
      leaseExpiresAt: graceUntil,
      deploymentGraceUntil: graceUntil,
      lastInterruptionReason: "deployment_draining",
    },
  });
  return updated.count === 1;
}

async function recoverLegacyLeaseExhaustedJobs(now: Date): Promise<number> {
  const candidates = await prisma.videoProductionJob.findMany({
    where: {
      status: "failed",
      errorCode: "RETRY_EXHAUSTED",
      lastError: "Worker lease expired; job returned to the durable queue.",
    },
    select: {
      id: true,
      kind: true,
      projectId: true,
      attempt: true,
      project: { select: { planJson: true } },
    },
  });
  let recovered = 0;
  for (const candidate of candidates) {
    if (
      candidate.kind === "planning"
      && !hasPlannerCheckpoint(candidate.project.planJson)
    ) {
      continue;
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.videoProductionJob.updateMany({
        where: {
          id: candidate.id,
          status: "failed",
          errorCode: "RETRY_EXHAUSTED",
          lastError: "Worker lease expired; job returned to the durable queue.",
        },
        data: {
          status: "queued",
          attempt: 0,
          modelAttempt: 0,
          infrastructureAttempt: { increment: Math.max(1, candidate.attempt) },
          leaseLossCount: { increment: Math.max(1, candidate.attempt) },
          availableAt: now,
          completedAt: null,
          leaseToken: null,
          workerId: null,
          claimedWorkerVersion: null,
          leaseExpiresAt: null,
          lastInterruptionReason: "legacy_worker_lease_expired",
          lastError:
            "Legacy Worker lease failures were recognized as infrastructure interruptions; automatic recovery was queued.",
          errorCategory: "internal_scheduling",
          errorCode: "INFRASTRUCTURE_RECOVERY_QUEUED",
          recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
        },
      });
      if (result.count !== 1) return result;
      await tx.videoProject.updateMany({
        where: { id: candidate.projectId },
        data: {
          status: VideoProjectStatus.WAITING_RECOVERY,
          errorMessage: null,
        },
      });
      return result;
    });
    recovered += updated.count;
  }
  return recovered;
}

async function adoptInfrastructureRecoveryJobs(input: {
  runtimeVersion: string;
  kinds?: VideoProductionJobKind[];
  supportedPayloadVersions: number[];
}): Promise<number> {
  const candidates = await prisma.videoProductionJob.findMany({
    where: {
      status: { in: ["queued", "waiting_upstream"] },
      recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
      requiredWorkerVersion: { not: input.runtimeVersion },
      ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
    },
    select: { id: true, payload: true },
  });
  let adopted = 0;
  for (const candidate of candidates) {
    const payload = jsonObject(candidate.payload);
    if (!input.supportedPayloadVersions.includes(Number(payload.payloadSchemaVersion))) {
      continue;
    }
    const updated = await prisma.videoProductionJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: ["queued", "waiting_upstream"] },
        recoveryAction: "AUTO_RETRY_INFRASTRUCTURE",
      },
      data: {
        requiredWorkerVersion: input.runtimeVersion,
        payload: versionedPayload(
          candidate.payload as Prisma.InputJsonValue,
          input.runtimeVersion,
        ),
      },
    });
    adopted += updated.count;
  }
  return adopted;
}

export async function annotateNoCompatibleWorker(input: {
  jobIds?: string[];
  kinds?: VideoProductionJobKind[];
} = {}): Promise<number> {
  const now = new Date();
  const jobs = await prisma.videoProductionJob.findMany({
    where: {
      status: { in: ["queued", "waiting_upstream"] },
      ...(input.jobIds?.length ? { id: { in: input.jobIds } } : {}),
      ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
    },
    select: {
      id: true,
      kind: true,
      payload: true,
      requiredWorkerVersion: true,
    },
  });
  if (!jobs.length) return 0;
  const workers = await prisma.videoProductionWorkerRuntime.findMany({
    where: {
      heartbeatAt: {
        gt: new Date(now.getTime() - WORKER_HEARTBEAT_COMPATIBILITY_MS),
      },
    },
    select: {
      runtimeVersion: true,
      supportedKinds: true,
      supportedPayloadVersions: true,
    },
  });
  let annotated = 0;
  for (const job of jobs) {
    const payload = jsonObject(job.payload);
    const payloadVersion = Number(payload.payloadSchemaVersion);
    const contractVersion = Number(payload.contractVersion);
    const payloadWorkerVersion = text(payload.requiredWorkerVersion);
    const compatible = workers.some((worker) => {
      const kinds = stringArray(worker.supportedKinds);
      const versions = numberArray(worker.supportedPayloadVersions);
      return worker.runtimeVersion === job.requiredWorkerVersion
        && payloadWorkerVersion === job.requiredWorkerVersion
        && payloadVersion === VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION
        && contractVersion === VIDEO_PRODUCTION_CONTRACT_VERSION
        && (kinds.length === 0 || kinds.includes(job.kind))
        && versions.includes(payloadVersion);
    });
    if (compatible) continue;
    const updated = await prisma.videoProductionJob.updateMany({
      where: {
        id: job.id,
        status: { in: ["queued", "waiting_upstream"] },
      },
      data: {
        lastError:
          `No compatible Worker is registered for ${job.kind}; required runtime `
          + `${job.requiredWorkerVersion}, payload ${payloadVersion || "legacy"}, `
          + `contract ${contractVersion || "legacy"}.`,
        errorCategory: "internal_scheduling",
        errorCode: "NO_COMPATIBLE_WORKER",
        recoveryAction: "DEPLOY_COMPATIBLE_WORKER",
      },
    });
    annotated += updated.count;
  }
  return annotated;
}

export async function heartbeatVideoProductionJob(
  id: string,
  leaseToken: string,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const now = new Date();
  const heartbeatExpiry = new Date(
    now.getTime() + Math.max(30_000, leaseMs),
  );
  const updated = await prisma.$executeRaw`
    UPDATE "video_production_jobs"
    SET "lease_expires_at" = GREATEST(
      ${heartbeatExpiry},
      COALESCE("deployment_grace_until", ${heartbeatExpiry})
    )
    WHERE "id" = ${id}
      AND "lease_token" = ${leaseToken}
      AND "status" IN ('claimed', 'running')
      AND "lease_expires_at" > ${now}
  `;
  return updated === 1;
}

export async function assertVideoProductionJobLease(
  id: string,
  leaseToken: string,
): Promise<void> {
  const owned = await prisma.videoProductionJob.findFirst({
    where: {
      id,
      leaseToken,
      status: { in: ["claimed", "running"] },
      leaseExpiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (!owned) throw new LostProductionJobLeaseError(id);
}

export async function setVideoProductionJobStage(input: {
  id: string;
  leaseToken: string;
  stage: VideoProductionStage;
  payload?: Prisma.InputJsonValue;
  meaningfulProgress?: boolean;
}): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: {
      id: input.id,
      leaseToken: input.leaseToken,
      status: { in: ["claimed", "running"] },
      leaseExpiresAt: { gt: new Date() },
    },
    data: {
      status: "running",
      stage: input.stage,
      ...(input.meaningfulProgress === false ? {} : { progressAt: new Date() }),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    },
  });
  return updated.count === 1;
}

export async function completeVideoProductionJob(input: {
  id: string;
  leaseToken: string;
  stage?: VideoProductionStage;
  payload?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: {
      id: input.id,
      leaseToken: input.leaseToken,
      status: { in: ["claimed", "running"] },
      leaseExpiresAt: { gt: new Date() },
    },
    data: {
      status: "completed",
      ...(input.stage ? { stage: input.stage } : {}),
      completedAt: new Date(),
      leaseToken: null,
      workerId: null,
      claimedWorkerVersion: null,
      leaseExpiresAt: null,
      lastError: null,
      errorCategory: null,
      errorCode: null,
      recoveryAction: null,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    },
  });
  return updated.count === 1;
}

export async function retryVideoProductionJob(input: {
  id: string;
  leaseToken: string;
  error: unknown;
  retryDelayMs?: number;
  stage?: VideoProductionStage;
  category?: VideoProductionErrorCategory;
}): Promise<"queued" | "failed" | "lost"> {
  if (isInfrastructureRetryCategory(input.category)) {
    const released = await releaseVideoProductionJobForInfrastructure({
      id: input.id,
      leaseToken: input.leaseToken,
      reason: input.category === "provider_rate_limit"
        ? "provider_rate_limit"
        : "provider_network",
      error: input.error,
      category: input.category,
    });
    return released ? "queued" : "lost";
  }
  const current = await prisma.videoProductionJob.findFirst({
    where: { id: input.id, leaseToken: input.leaseToken, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: new Date() } },
    select: {
      attempt: true,
      maxAttempts: true,
      modelAttempt: true,
      maxModelAttempts: true,
      stage: true,
    },
  });
  if (!current) return "lost";
  const nextAttempt = current.attempt + 1;
  const nextModelAttempt = current.modelAttempt + 1;
  const failed = nextAttempt >= current.maxAttempts
    || nextModelAttempt >= current.maxModelAttempts;
  if (failed) {
    const settled = await failVideoProductionJob({
      id: input.id,
      leaseToken: input.leaseToken,
      error: input.error,
      stage: (input.stage ?? current.stage) as VideoProductionStage,
      category: input.category,
      errorCode: "RETRY_EXHAUSTED",
      recoveryAction: "RETRY_JOB",
      budget: "model",
    });
    return settled ? "failed" : "lost";
  }
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: new Date() } },
    data: {
      status: "queued",
      attempt: { increment: 1 },
      modelAttempt: { increment: 1 },
      ...(input.stage ? { stage: input.stage } : {}),
      availableAt: new Date(Date.now() + Math.max(0, input.retryDelayMs ?? retryDelayForAttempt(nextModelAttempt))),
      completedAt: null,
      leaseToken: null,
      workerId: null,
      claimedWorkerVersion: null,
      leaseExpiresAt: null,
      lastError: input.error instanceof Error ? input.error.message : String(input.error),
      errorCategory: input.category,
      errorCode: null,
      recoveryAction: null,
    },
  });
  if (updated.count !== 1) return "lost";
  return "queued";
}

export async function deferVideoProductionJobForCapacity(input: {
  id: string;
  leaseToken: string;
  error: unknown;
  now?: Date;
}): Promise<"queued" | "paused" | "lost"> {
  const now = input.now ?? new Date();
  const current = await prisma.videoProductionJob.findFirst({
    where: { id: input.id, leaseToken: input.leaseToken, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: now } },
    select: {
      attempt: true,
      payload: true,
      stage: true,
      projectId: true,
      targetId: true,
    },
  });
  if (!current) return "lost";
  const payload = isJsonObject(current.payload) ? current.payload : {};
  const previousWaitCount = finiteNonNegativeInteger(payload.capacityWaitCount);
  const capacityWaitCount = previousWaitCount + 1;
  const firstCapacityWaitAt = validDateString(payload.firstCapacityWaitAt)
    ?? now.toISOString();
  const firstWaitMs = Date.parse(firstCapacityWaitAt);
  const waitAgeMs = Number.isFinite(firstWaitMs) ? now.getTime() - firstWaitMs : 0;
  const paused = capacityWaitCount >= CAPACITY_WAIT_MAX_COUNT
    || waitAgeMs >= CAPACITY_WAIT_MAX_AGE_MS;
  const delayMs = capacityRetryDelayMs(capacityWaitCount);
  const nextCapacityRetryAt = new Date(now.getTime() + delayMs);
  const nextPayload: Prisma.InputJsonValue = {
    ...payload,
    capacityWaitCount,
    capacityErrorCode: providerCapacityErrorCode(input.error),
    firstCapacityWaitAt,
    lastCapacityWaitAt: now.toISOString(),
    nextCapacityRetryAt: nextCapacityRetryAt.toISOString(),
  };
  const capacityMessage = input.error instanceof Error ? input.error.message : String(input.error);
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.videoProductionJob.updateMany({
      where: { id: input.id, leaseToken: input.leaseToken, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: now } },
      data: {
        status: paused ? "failed" : "queued",
        stage: current.stage,
        availableAt: nextCapacityRetryAt,
        completedAt: paused ? now : null,
        leaseToken: null,
        workerId: null,
        claimedWorkerVersion: null,
        leaseExpiresAt: null,
        lastError: capacityMessage,
        errorCategory: "internal_capacity",
        errorCode: paused ? "CAPACITY_RETRY_EXHAUSTED" : providerCapacityErrorCode(input.error),
        recoveryAction: paused ? "RETRY_JOB" : null,
        payload: nextPayload,
      },
    });
    if (result.count === 1 && paused) {
      await tx.videoProviderTaskLease.updateMany({
        where: {
          projectId: current.projectId,
          targetId: current.targetId,
          status: { in: ["waiting", "reserved", "running"] },
        },
        data: {
          status: "failed",
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: capacityMessage,
        },
      });
      await tx.videoProject.update({
        where: { id: current.projectId },
        data: {
          status: VideoProjectStatus.WAITING_RECOVERY,
          errorMessage: `[CAPACITY_RETRY_EXHAUSTED] ${capacityMessage}`,
        },
      });
    }
    return result;
  });
  if (updated.count !== 1) return "lost";
  return paused ? "paused" : "queued";
}

export async function failVideoProductionJob(input: {
  id: string;
  leaseToken: string;
  error: unknown;
  stage: VideoProductionStage;
  category?: VideoProductionErrorCategory;
  errorCode?: string;
  recoveryAction?: string;
  budget?: "model" | "stage" | "business" | "none";
}): Promise<boolean> {
  const now = new Date();
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const errorCode = input.errorCode ?? "PRODUCTION_JOB_FAILED";
  const recoveryAction = input.recoveryAction ?? "RETRY_JOB";
  const budget = input.budget ?? failureBudgetForCategory(input.category);
  return prisma.$transaction(async (tx) => {
    const current = await tx.videoProductionJob.findFirst({
      where: {
        id: input.id,
        leaseToken: input.leaseToken,
        status: { in: ["claimed", "running"] },
        leaseExpiresAt: { gt: now },
      },
    });
    if (!current) return false;

    // Failure settlement owns every state transition. Provider capacity,
    // durable job state, target projection, and project projection therefore
    // cannot disagree after the transaction commits.
    await tx.videoProviderTaskLease.updateMany({
      where: {
        projectId: current.projectId,
        targetId: current.targetId,
        status: { in: ["waiting", "reserved", "running"] },
      },
      data: {
        status: "failed",
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
      },
    });
    const updated = await tx.videoProductionJob.updateMany({
      where: {
        id: current.id,
        leaseToken: input.leaseToken,
        status: { in: ["claimed", "running"] },
      },
      data: {
        status: "failed",
        stage: input.stage,
        completedAt: now,
        leaseToken: null,
        workerId: null,
        claimedWorkerVersion: null,
        leaseExpiresAt: null,
        lastError: message,
        errorCategory: input.category,
        errorCode,
        recoveryAction,
        ...(budget === "none" ? {} : { attempt: { increment: 1 } }),
        ...(budget === "model" ? { modelAttempt: { increment: 1 } } : {}),
        ...(budget === "stage" ? { stageRepairAttempt: { increment: 1 } } : {}),
      },
    });
    if (updated.count !== 1) return false;

    if (current.artifactId) {
      await tx.videoArtifactMetadata.updateMany({
        where: {
          projectId: current.projectId,
          artifactId: current.artifactId,
          userAccepted: false,
        },
        data: {
          status: "failed",
          retryFromStage: recoveryAction === "REPAIR_CONTRACT"
            ? "compiler"
            : "generation",
        },
      });
      await tx.videoGenerationCandidate.updateMany({
        where: {
          projectId: current.projectId,
          artifactId: current.artifactId,
          status: { in: ["pending", "running", "evaluating", "quality_retry"] },
        },
        data: {
          status: "failed",
          errorMessage: message,
        },
      });
    }
    if (current.kind === "image_prepare_submit" || current.kind === "image_quality") {
      await tx.videoKeyframe.updateMany({
        where: { id: current.targetId, projectId: current.projectId },
        data: {
          status: VideoShotStatus.FAILED,
          errorMessage: message,
        },
      });
    } else if (current.kind === "clip_prepare_submit") {
      await tx.videoSegment.updateMany({
        where: { id: current.targetId, projectId: current.projectId },
        data: {
          status: VideoShotStatus.FAILED,
          errorMessage: message,
        },
      });
    }
    await tx.videoProject.update({
      where: { id: current.projectId },
      data: {
        status: VideoProjectStatus.WAITING_RECOVERY,
        errorMessage: `[${errorCode}] ${message}`,
      },
    });
    return true;
  });
}

export function classifyVideoProductionError(error: unknown): VideoProductionErrorDisposition {
  return classifyVideoProductionFailure(error).disposition;
}

export function classifyVideoProductionFailure(error: unknown): VideoProductionFailureClassification {
  const name = error instanceof Error ? error.name : "";
  const code = error && typeof error === "object" && typeof Reflect.get(error, "code") === "string"
    ? String(Reflect.get(error, "code"))
    : "";
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && typeof Reflect.get(error, "message") === "string"
      ? String(Reflect.get(error, "message"))
      : String(error);
  if (
    name === "ProviderQuotaError"
    || code === "PROVIDER_QUOTA_EXHAUSTED"
    || /token[-_ ]?limit|quota exceeded|exceeded your current quota|insufficient[_ -]?balance|billing details/i.test(message)
  ) {
    return failure(
      "terminal",
      "provider_quota",
      "上游翻译或模型额度已用尽；请检查套餐和账单。任务检查点已保留，不会按未知错误盲目重试。",
    );
  }
  if (
    name === "ProviderCapacityError"
    || code === "CAPACITY_EXHAUSTED"
    || code === "LEASE_UNAVAILABLE"
  ) {
    return failure(
      "retry",
      "internal_capacity",
      "Provider capacity is temporarily unavailable; the same durable job will be retried.",
    );
  }
  if (
    name === "NonCanonicalPlanFieldError"
    || code === "EXECUTION_CONTRACT_TOO_LARGE"
    || /contract.*too large|prompt budget exceeded/i.test(message)
  ) {
    return failure(
      "contract_repair_required",
      "contract_validation",
      "The execution contract must be repaired before provider submission.",
    );
  }
  if (isStructuredOutputSyntaxError(error)) {
    return failure(
      "stage_repairable",
      "structured_output_syntax",
      "当前模型阶段返回的结构化内容语法不完整；只允许重试该阶段，不重新启动整个作业。",
    );
  }
  if (storyboardStageErrorCode(error) === "contract_validation_error") {
    return failure("contract_repair_required", "contract_validation", "生成契约需要修复，尚未进入正常模型生成。");
  }
  if (
    name === "PlanValidationError"
    || name === "PlanFieldConflictError"
    || name === "CanonicalExecutionContractError"
    || name === "ImagePromptContractBudgetError"
    || /计划硬校验未通过|contract.*(?:invalid|missing|required)|invalid.*contract|checkpoint.*(?:maximum|invalid|ordered)|schema|camera id.*(?:missing|not found)/i.test(message)
  ) {
    return failure("contract_repair_required", "contract_validation", "生成契约需要修复，尚未进入正常模型生成。");
  }
  if (
    error instanceof ProductionSchedulingInvariantError
    || /requires a non-empty targetid|missing targetid|internal schedul|durable .* missing/i.test(message)
  ) {
    return failure("terminal", "internal_scheduling", "内部调度数据不完整，任务未提交到模型。");
  }
  if (/http 429|rate limit|too many requests|throttl/i.test(message)) {
    return failure("retry", "provider_rate_limit", "已到达供应商接口，但被供应商限流，系统将自动重试。");
  }
  if (
    /abort|timed? out|timeout|fetch failed|network|socket|econn|http 408|http 409|http 425|http 5\d\d|temporarily unavailable/i.test(message)
  ) {
    return failure("retry", "provider_network", "供应商网络或服务暂时异常，系统将自动重试。");
  }
  if (/unauthorized|forbidden|invalid api key|authentication|http 401|http 403/i.test(message)) {
    return failure("terminal", "provider_auth", "供应商鉴权失败，需要检查模型凭据配置。");
  }
  return failure("retry", "unknown", "生成任务暂时失败，系统将按重试策略继续处理。");
}

export async function rescheduleVideoProductionJob(input: {
  id: string;
  leaseToken: string;
  stage: VideoProductionStage;
  availableAt: Date;
  payload?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: { in: ["claimed", "running"] }, leaseExpiresAt: { gt: new Date() } },
    data: {
      status: input.stage === "provider_polling" ? "waiting_upstream" : "queued",
      stage: input.stage,
      availableAt: input.availableAt,
      leaseToken: null,
      workerId: null,
      claimedWorkerVersion: null,
      leaseExpiresAt: null,
      lastError: null,
      errorCategory: null,
      errorCode: null,
      recoveryAction: null,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    },
  });
  return updated.count === 1;
}

export class ProductionSchedulingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionSchedulingInvariantError";
  }
}

export class LostProductionJobLeaseError extends Error {
  constructor(jobId: string) {
    super(`Video production job lease was lost: ${jobId}`);
    this.name = "LostProductionJobLeaseError";
  }
}

export function infrastructureRetryDelayMs(infrastructureAttempt: number): number {
  const normalizedAttempt = Math.max(1, Math.round(infrastructureAttempt));
  return Math.min(
    INFRASTRUCTURE_RETRY_MAX_MS,
    INFRASTRUCTURE_RETRY_BASE_MS * (2 ** Math.min(5, normalizedAttempt - 1)),
  );
}

export function failureBudgetForCategory(
  category: VideoProductionErrorCategory | undefined,
): "model" | "stage" | "business" | "none" {
  if (category === "structured_output_syntax" || category === "contract_validation") {
    return "stage";
  }
  if (
    category === "provider_auth"
    || category === "unknown"
  ) {
    return "model";
  }
  if (
    category === "internal_capacity"
    || category === "internal_scheduling"
    || category === "provider_quota"
  ) {
    return "none";
  }
  return "business";
}

function isInfrastructureRetryCategory(
  category: VideoProductionErrorCategory | undefined,
): category is "provider_network" | "provider_rate_limit" {
  return category === "provider_network" || category === "provider_rate_limit";
}

function hasPlannerCheckpoint(value: Prisma.JsonValue | null): boolean {
  if (!isJsonObject(value)) return false;
  return value.plannerCheckpoint !== undefined
    && isJsonObject(value.plannerCheckpoint);
}

function normalizeTargetId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function versionedPayload(
  value: Prisma.InputJsonValue | undefined,
  requiredWorkerVersion: string,
): Prisma.InputJsonObject {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.InputJsonObject
    : {};
  return {
    ...source,
    payloadSchemaVersion: VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION,
    requiredWorkerVersion,
    contractVersion: VIDEO_PRODUCTION_CONTRACT_VERSION,
  };
}

function workerCompatibilityWhere(input: {
  runtimeVersion: string;
  supportedPayloadVersions: number[];
}): Prisma.VideoProductionJobWhereInput {
  return {
    requiredWorkerVersion: input.runtimeVersion,
    AND: [
      {
        OR: input.supportedPayloadVersions.map((version) => ({
          payload: { path: ["payloadSchemaVersion"], equals: version },
        })),
      },
      {
        payload: {
          path: ["requiredWorkerVersion"],
          equals: input.runtimeVersion,
        },
      },
      {
        payload: {
          path: ["contractVersion"],
          equals: VIDEO_PRODUCTION_CONTRACT_VERSION,
        },
      },
    ],
  };
}

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function text(value: Prisma.JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function numberArray(value: Prisma.JsonValue): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter(Number.isInteger)
    : [];
}

function payloadHandshakeMatches(
  value: Prisma.JsonValue,
  requiredWorkerVersion: string,
): boolean {
  const payload = jsonObject(value);
  return Number(payload.payloadSchemaVersion) === VIDEO_PRODUCTION_PAYLOAD_SCHEMA_VERSION
    && Number(payload.contractVersion) === VIDEO_PRODUCTION_CONTRACT_VERSION
    && text(payload.requiredWorkerVersion) === requiredWorkerVersion;
}

function shortVersionKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(-48);
}

function failure(
  disposition: VideoProductionErrorDisposition,
  category: VideoProductionErrorCategory,
  userMessageZh: string,
): VideoProductionFailureClassification {
  return { disposition, category, userMessageZh };
}

export async function readProductionCircuit(key: string): Promise<{
  open: boolean;
  openUntil?: Date;
  consecutiveFailures: number;
}> {
  const row = await prisma.videoProductionCircuit.findUnique({ where: { key } });
  return {
    open: Boolean(row?.openUntil && row.openUntil.getTime() > Date.now()),
    openUntil: row?.openUntil ?? undefined,
    consecutiveFailures: row?.consecutiveFailures ?? 0,
  };
}

export async function recordProductionCircuitSuccess(key: string): Promise<void> {
  await prisma.videoProductionCircuit.upsert({
    where: { key },
    create: { key, consecutiveFailures: 0 },
    update: { consecutiveFailures: 0, openUntil: null, lastError: null },
  });
}

export async function recordProductionCircuitFailure(input: {
  key: string;
  error: unknown;
  threshold: number;
  cooldownMs: number;
}): Promise<{ consecutiveFailures: number; openUntil?: Date }> {
  const current = await prisma.videoProductionCircuit.findUnique({
    where: { key: input.key },
    select: { consecutiveFailures: true },
  });
  const consecutiveFailures = (current?.consecutiveFailures ?? 0) + 1;
  const openUntil = consecutiveFailures >= Math.max(1, input.threshold)
    ? new Date(Date.now() + Math.max(1_000, input.cooldownMs))
    : undefined;
  await prisma.videoProductionCircuit.upsert({
    where: { key: input.key },
    create: {
      key: input.key,
      consecutiveFailures,
      openUntil,
      lastError: input.error instanceof Error ? input.error.message : String(input.error),
    },
    update: {
      consecutiveFailures,
      openUntil: openUntil ?? null,
      lastError: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
  return { consecutiveFailures, openUntil };
}

function retryDelayForAttempt(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export function capacityRetryDelayMs(
  waitCount: number,
  random: () => number = Math.random,
): number {
  const normalizedCount = Math.max(1, Math.round(waitCount));
  const base = Math.min(120_000, 5_000 * 2 ** Math.max(0, normalizedCount - 1));
  const jitter = Math.max(0, Math.min(1, random())) * base * 0.3;
  return Math.round(base + jitter);
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNonNegativeInteger(value: Prisma.JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function validDateString(value: Prisma.JsonValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

function providerCapacityErrorCode(error: unknown): "CAPACITY_EXHAUSTED" | "LEASE_UNAVAILABLE" {
  return error && typeof error === "object" && Reflect.get(error, "code") === "LEASE_UNAVAILABLE"
    ? "LEASE_UNAVAILABLE"
    : "CAPACITY_EXHAUSTED";
}
