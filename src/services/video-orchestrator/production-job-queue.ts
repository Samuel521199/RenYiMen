import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { StoryboardStageError } from "./storyboard-stage-retry";

export type VideoProductionJobKind =
  | "planning"
  | "project_reconcile"
  | "image_prepare_submit"
  | "image_quality"
  | "micro_shot_prepare_submit"
  | "clip_prepare_submit";

export type VideoProductionStage =
  | "waiting_dependency"
  | "preparing_prompt"
  | "submitted"
  | "generating"
  | "waiting_quality"
  | "quality_checking"
  | "waiting_candidate_selection"
  | "waiting_asset_confirmation"
  | "contract_repair_required"
  | "retryable_failed"
  | "terminal_failed"
  | "completed";

export type VideoProductionErrorDisposition =
  | "contract_repair_required"
  | "retry"
  | "terminal";

export type VideoProductionJobRecord = Awaited<ReturnType<typeof prisma.videoProductionJob.findFirst>>;

const DEFAULT_LEASE_MS = 2 * 60_000;

export async function enqueueVideoProductionJob(input: {
  projectId: string;
  userId: string;
  kind: VideoProductionJobKind;
  stage: VideoProductionStage;
  idempotencyKey: string;
  artifactId?: string;
  targetId?: string;
  payload?: Prisma.InputJsonValue;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.videoProductionJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  try {
    const created = await prisma.videoProductionJob.create({
      data: {
        projectId: input.projectId,
        userId: input.userId,
        kind: input.kind,
        stage: input.stage,
        status: "queued",
        idempotencyKey: input.idempotencyKey,
        artifactId: input.artifactId,
        targetId: input.targetId,
        payload: input.payload ?? {},
        priority: input.priority ?? 0,
        availableAt: input.availableAt ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.videoProductionJob.findUniqueOrThrow({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      return { id: raced.id, created: false };
    }
    throw error;
  }
}

export async function claimNextVideoProductionJob(input: {
  workerId: string;
  kinds?: VideoProductionJobKind[];
  leaseMs?: number;
}): Promise<NonNullable<VideoProductionJobRecord> | null> {
  const now = new Date();
  await prisma.videoProductionJob.updateMany({
    where: {
      status: "running",
      leaseExpiresAt: { lte: now },
    },
    data: {
      status: "queued",
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
      availableAt: now,
      lastError: "Worker lease expired; job returned to the durable queue.",
    },
  });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = await prisma.videoProductionJob.findFirst({
      where: {
        status: "queued",
        availableAt: { lte: now },
        ...(input.kinds?.length ? { kind: { in: input.kinds } } : {}),
      },
      orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    });
    if (!candidate) return null;
    if (candidate.attempt >= candidate.maxAttempts) {
      await prisma.videoProductionJob.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: {
          status: "failed",
          completedAt: now,
          lastError: candidate.lastError || "Maximum durable job attempts exhausted.",
        },
      });
      continue;
    }
    const leaseToken = randomUUID();
    const claimed = await prisma.videoProductionJob.updateMany({
      where: {
        id: candidate.id,
        status: "queued",
        availableAt: { lte: now },
      },
      data: {
        status: "running",
        leaseToken,
        workerId: input.workerId,
        leaseExpiresAt: new Date(now.getTime() + Math.max(30_000, input.leaseMs ?? DEFAULT_LEASE_MS)),
        startedAt: candidate.startedAt ?? now,
        attempt: { increment: 1 },
        lastError: null,
      },
    });
    if (claimed.count !== 1) continue;
    return prisma.videoProductionJob.findUnique({ where: { id: candidate.id } }) as Promise<NonNullable<VideoProductionJobRecord>>;
  }
  return null;
}

export async function heartbeatVideoProductionJob(
  id: string,
  leaseToken: string,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id, leaseToken, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + Math.max(30_000, leaseMs)) },
  });
  return updated.count === 1;
}

export async function setVideoProductionJobStage(input: {
  id: string;
  leaseToken: string;
  stage: VideoProductionStage;
  payload?: Prisma.InputJsonValue;
}): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "running" },
    data: {
      stage: input.stage,
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
    where: { id: input.id, leaseToken: input.leaseToken, status: "running" },
    data: {
      status: "completed",
      stage: input.stage ?? "completed",
      completedAt: new Date(),
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
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
}): Promise<"queued" | "failed" | "lost"> {
  const current = await prisma.videoProductionJob.findFirst({
    where: { id: input.id, leaseToken: input.leaseToken, status: "running" },
    select: { attempt: true, maxAttempts: true },
  });
  if (!current) return "lost";
  const failed = current.attempt >= current.maxAttempts;
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "running" },
    data: {
      status: failed ? "failed" : "queued",
      ...(input.stage ? { stage: input.stage } : {}),
      availableAt: new Date(Date.now() + Math.max(0, input.retryDelayMs ?? retryDelayForAttempt(current.attempt))),
      completedAt: failed ? new Date() : null,
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
      lastError: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
  if (updated.count !== 1) return "lost";
  return failed ? "failed" : "queued";
}

export async function failVideoProductionJob(input: {
  id: string;
  leaseToken: string;
  error: unknown;
  stage: "contract_repair_required" | "terminal_failed";
}): Promise<boolean> {
  const updated = await prisma.videoProductionJob.updateMany({
    where: { id: input.id, leaseToken: input.leaseToken, status: "running" },
    data: {
      status: "failed",
      stage: input.stage,
      completedAt: new Date(),
      leaseToken: null,
      workerId: null,
      leaseExpiresAt: null,
      lastError: input.error instanceof Error ? input.error.message : String(input.error),
    },
  });
  return updated.count === 1;
}

export function classifyVideoProductionError(error: unknown): VideoProductionErrorDisposition {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof StoryboardStageError && error.code === "contract_validation_error") {
    return "contract_repair_required";
  }
  if (
    name === "PlanValidationError"
    || name === "ImagePromptContractBudgetError"
    || /计划硬校验未通过|contract.*(?:invalid|missing|required)|invalid.*contract|checkpoint.*(?:maximum|invalid|ordered)|schema|camera id.*(?:missing|not found)/i.test(message)
  ) {
    return "contract_repair_required";
  }
  if (
    /abort|timed? out|timeout|fetch failed|network|socket|econn|http 408|http 409|http 425|http 429|http 5\d\d|rate limit|too many requests|capacity is full|temporarily unavailable/i.test(message)
  ) {
    return "retry";
  }
  if (/unauthorized|forbidden|invalid api key|authentication|http 401|http 403/i.test(message)) {
    return "terminal";
  }
  return "retry";
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
