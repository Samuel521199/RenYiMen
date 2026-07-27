import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_HAPPYHORSE_CAPACITY = 5;
const MAX_HAPPYHORSE_CAPACITY = 5;
const DEFAULT_IMAGE_CAPACITY = 5;
const MAX_IMAGE_CAPACITY = 5;
const DEFAULT_TEXT_CAPACITY = 10;
const MAX_TEXT_CAPACITY = 10;
const DEFAULT_VISION_CAPACITY = 2;
const MAX_VISION_CAPACITY = 4;
const WAITING_DEMAND_FRESH_MS = 2 * 60_000;
// Long enough to protect an upstream task when DashScope accepted it but the
// process lost its DB connection before attaching the returned task ID.
const RESERVED_LEASE_MS = 10 * 60_000;
const RUNNING_LEASE_MS = 45 * 60_000;

export interface ProviderSchedulingContext {
  userId: string;
  projectId: string;
  targetId: string;
}

export interface ProviderLeaseGrant {
  leaseToken: string;
  resourceKey: string;
}

export interface FairProviderWaiter {
  id: string;
  userId: string;
  projectId: string;
  queuedAt: Date;
  createdAt: Date;
}

export function selectFairProviderWaiter(
  waiting: FairProviderWaiter[],
  active: Array<{ userId: string; projectId: string }>,
): FairProviderWaiter | undefined {
  const activeByUser = new Map<string, number>();
  const activeByProject = new Map<string, number>();
  for (const item of active) {
    activeByUser.set(item.userId, (activeByUser.get(item.userId) ?? 0) + 1);
    activeByProject.set(item.projectId, (activeByProject.get(item.projectId) ?? 0) + 1);
  }
  return [...waiting].sort((left, right) =>
    (activeByUser.get(left.userId) ?? 0) - (activeByUser.get(right.userId) ?? 0)
    || (activeByProject.get(left.projectId) ?? 0) - (activeByProject.get(right.projectId) ?? 0)
    || left.queuedAt.getTime() - right.queuedAt.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
  )[0];
}

export class ProviderCapacityError extends Error {
  constructor(message = "Provider capacity is currently full; the task remains queued") {
    super(message);
    this.name = "ProviderCapacityError";
  }
}

export function isProviderCapacityError(error: unknown): error is ProviderCapacityError {
  return error instanceof Error && error.name === "ProviderCapacityError";
}

export type ProviderCapacityLane = "video_generation" | "image_generation" | "text_planning" | "visual_quality";

function configuredCapacity(lane: ProviderCapacityLane): number {
  const policy = lane === "video_generation"
    ? ["ONE_PROMPT_HAPPYHORSE_GLOBAL_CONCURRENCY", DEFAULT_HAPPYHORSE_CAPACITY, MAX_HAPPYHORSE_CAPACITY] as const
    : lane === "image_generation"
      ? ["ONE_PROMPT_IMAGE_GLOBAL_CONCURRENCY", DEFAULT_IMAGE_CAPACITY, MAX_IMAGE_CAPACITY] as const
      : lane === "text_planning"
        ? ["ONE_PROMPT_TEXT_GLOBAL_CONCURRENCY", DEFAULT_TEXT_CAPACITY, MAX_TEXT_CAPACITY] as const
        : ["ONE_PROMPT_VISUAL_QUALITY_GLOBAL_CONCURRENCY", DEFAULT_VISION_CAPACITY, MAX_VISION_CAPACITY] as const;
  const value = Number(process.env[policy[0]]);
  const requested = Number.isFinite(value) ? Math.round(value) : policy[1];
  return Math.max(1, Math.min(policy[2], requested));
}

export function dashScopeResourceKey(lane: ProviderCapacityLane, modelId: string): string {
  const endpoint = (
    process.env.ALIYUN_DASHSCOPE_BASE_URL
    ?? process.env.DASHSCOPE_BASE_URL
    ?? process.env.BAILIAN_BASE_URL
    ?? "https://dashscope.aliyuncs.com"
  ).trim().replace(/\/+$/, "").toLowerCase();
  const credential = (
    process.env.DASHSCOPE_API_KEY
    ?? process.env.BAILIAN_API_KEY
    ?? "missing-credential"
  ).trim();
  const credentialFingerprint = createHash("sha256").update(credential).digest("hex").slice(0, 16);
  return `aliyun-bailian:${lane}:${endpoint}:${modelId.trim().toLowerCase()}:${credentialFingerprint}`;
}

export async function registerProviderDemand(
  lane: ProviderCapacityLane,
  modelId: string,
  context: ProviderSchedulingContext,
): Promise<void> {
  const resourceKey = dashScopeResourceKey(lane, modelId);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${resourceKey}))`;
    const existing = await tx.videoProviderTaskLease.findUnique({
      where: { resourceKey_targetId: { resourceKey, targetId: context.targetId } },
    });
    if (existing?.status === "running" || existing?.status === "reserved") return;
    if (existing) {
      await tx.videoProviderTaskLease.update({
        where: { id: existing.id },
        data: {
          userId: context.userId,
          projectId: context.projectId,
          status: "waiting",
          lastRequestedAt: now,
          ...(existing.status === "completed" || existing.status === "failed" || existing.status === "released"
            ? {
                queuedAt: now,
                upstreamTaskId: null,
                leaseToken: null,
                leaseExpiresAt: null,
                lastError: null,
              }
            : {}),
        },
      });
      return;
    }
    await tx.videoProviderTaskLease.create({
      data: {
        resourceKey,
        userId: context.userId,
        projectId: context.projectId,
        targetId: context.targetId,
        status: "waiting",
        queuedAt: now,
        lastRequestedAt: now,
      },
    });
  }, { timeout: 10_000 });
}

export async function requestProviderLease(
  lane: ProviderCapacityLane,
  modelId: string,
  context: ProviderSchedulingContext,
): Promise<ProviderLeaseGrant | null> {
  const resourceKey = dashScopeResourceKey(lane, modelId);
  const now = new Date();
  const freshAfter = new Date(now.getTime() - WAITING_DEMAND_FRESH_MS);
  const reservedUntil = new Date(now.getTime() + RESERVED_LEASE_MS);
  const leaseToken = randomUUID();

  return prisma.$transaction(async (tx) => {
    // A transaction-scoped advisory lock makes capacity inspection and slot
    // reservation atomic across every Next.js process sharing this database.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${resourceKey}))`;

    await tx.videoProviderTaskLease.updateMany({
      where: {
        resourceKey,
        status: "reserved",
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: "waiting",
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: "Submission reservation expired before an upstream task ID was attached.",
      },
    });
    await tx.videoProviderTaskLease.updateMany({
      where: {
        resourceKey,
        status: "running",
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: "released",
        leaseToken: null,
        upstreamTaskId: null,
        leaseExpiresAt: null,
        lastError: "Provider request lease expired without a terminal release.",
      },
    });

    const existing = await tx.videoProviderTaskLease.findUnique({
      where: { resourceKey_targetId: { resourceKey, targetId: context.targetId } },
    });
    if (existing?.status === "running" || existing?.status === "reserved") return null;

    const waiter = existing
      ? await tx.videoProviderTaskLease.update({
          where: { id: existing.id },
          data: {
            userId: context.userId,
            projectId: context.projectId,
            status: "waiting",
            lastRequestedAt: now,
            ...(existing.status === "completed" || existing.status === "failed" || existing.status === "released"
              ? {
                  queuedAt: now,
                  upstreamTaskId: null,
                  leaseToken: null,
                  leaseExpiresAt: null,
                  lastError: null,
                }
              : {}),
          },
        })
      : await tx.videoProviderTaskLease.create({
          data: {
            resourceKey,
            userId: context.userId,
            projectId: context.projectId,
            targetId: context.targetId,
            status: "waiting",
            queuedAt: now,
            lastRequestedAt: now,
          },
        });

    const active = await tx.videoProviderTaskLease.findMany({
      where: {
        resourceKey,
        OR: [
          { status: "running" },
          { status: "reserved", leaseExpiresAt: { gte: now } },
        ],
      },
      select: { userId: true, projectId: true },
    });
    if (active.length >= configuredCapacity(lane)) return null;

    const waiting = await tx.videoProviderTaskLease.findMany({
      where: {
        resourceKey,
        status: "waiting",
        lastRequestedAt: { gte: freshAfter },
      },
      orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
    });
    if (selectFairProviderWaiter(waiting, active)?.id !== waiter.id) return null;

    await tx.videoProviderTaskLease.update({
      where: { id: waiter.id },
      data: {
        status: "reserved",
        leaseToken,
        leaseExpiresAt: reservedUntil,
        attempt: { increment: 1 },
        lastError: null,
      },
    });
    return { leaseToken, resourceKey };
  }, { timeout: 10_000 });
}

export async function attachUpstreamTaskToProviderLease(
  leaseToken: string,
  upstreamTaskId: string,
): Promise<void> {
  await prisma.videoProviderTaskLease.update({
    where: { leaseToken },
    data: {
      status: "running",
      upstreamTaskId,
      leaseExpiresAt: new Date(Date.now() + RUNNING_LEASE_MS),
      lastError: null,
    },
  });
}

export async function returnProviderLeaseToQueue(
  leaseToken: string,
  error: unknown,
): Promise<void> {
  await prisma.videoProviderTaskLease.updateMany({
    where: { leaseToken },
    data: {
      status: "waiting",
      leaseToken: null,
      upstreamTaskId: null,
      leaseExpiresAt: null,
      lastRequestedAt: new Date(),
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}

export async function heartbeatProviderLease(upstreamTaskId: string): Promise<void> {
  await prisma.videoProviderTaskLease.updateMany({
    where: { upstreamTaskId, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + RUNNING_LEASE_MS) },
  });
}

export async function releaseProviderLeaseByTaskId(
  upstreamTaskId: string,
  status: "completed" | "failed",
  errorMessage?: string,
): Promise<void> {
  await prisma.videoProviderTaskLease.updateMany({
    where: { upstreamTaskId },
    data: {
      status,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: errorMessage ?? null,
    },
  });
}

export async function runningProviderLeaseTaskIds(lane?: ProviderCapacityLane): Promise<string[]> {
  const rows = await prisma.videoProviderTaskLease.findMany({
    where: {
      status: "running",
      upstreamTaskId: { not: null },
      ...(lane ? { resourceKey: { startsWith: `aliyun-bailian:${lane}:` } } : {}),
    },
    select: { upstreamTaskId: true },
    orderBy: { updatedAt: "asc" },
    take: lane ? configuredCapacity(lane) : MAX_IMAGE_CAPACITY + MAX_HAPPYHORSE_CAPACITY,
  });
  return rows.flatMap((row) => row.upstreamTaskId ? [row.upstreamTaskId] : []);
}

export async function releaseProviderLeaseByToken(
  leaseToken: string,
  status: "completed" | "failed" = "completed",
  errorMessage?: string,
): Promise<void> {
  await prisma.videoProviderTaskLease.updateMany({
    where: { leaseToken },
    data: {
      status,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: errorMessage ?? null,
    },
  });
}

/**
 * Capacity guard for synchronous provider requests. It shares the same
 * cross-process fairness ledger as long-running image/video jobs, but releases
 * its slot as soon as the HTTP operation finishes.
 */
export async function withProviderCapacity<T>(params: {
  lane: "text_planning" | "visual_quality";
  modelId: string;
  context: ProviderSchedulingContext;
  operation: () => Promise<T>;
  waitTimeoutMs?: number;
}): Promise<T> {
  const grant = await acquireProviderCapacity(params);
  try {
    const result = await params.operation();
    await releaseProviderLeaseByToken(grant.leaseToken, "completed");
    return result;
  } catch (error) {
    await releaseProviderLeaseByToken(
      grant.leaseToken,
      "failed",
      error instanceof Error ? error.message : String(error),
    ).catch(() => undefined);
    throw error;
  }
}

export async function acquireProviderCapacity(params: {
  lane: "text_planning" | "visual_quality";
  modelId: string;
  context: ProviderSchedulingContext;
  waitTimeoutMs?: number;
}): Promise<ProviderLeaseGrant> {
  const deadline = Date.now() + (params.waitTimeoutMs ?? 5 * 60_000);
  await registerProviderDemand(params.lane, params.modelId, params.context);
  let grant: ProviderLeaseGrant | null = null;
  while (!grant && Date.now() < deadline) {
    grant = await requestProviderLease(params.lane, params.modelId, params.context);
    if (!grant) {
      await new Promise((resolve) => setTimeout(resolve, 125));
      await registerProviderDemand(params.lane, params.modelId, params.context);
    }
  }
  if (!grant) throw new ProviderCapacityError(`${params.lane} capacity wait timed out`);
  await prisma.videoProviderTaskLease.update({
    where: { leaseToken: grant.leaseToken },
    data: {
      status: "running",
      leaseExpiresAt: new Date(
        Date.now() + Math.max(60_000, (params.waitTimeoutMs ?? 5 * 60_000) + 60_000),
      ),
    },
  });
  return grant;
}
