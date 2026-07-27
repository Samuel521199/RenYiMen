import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const DEFAULT_HAPPYHORSE_CAPACITY = 5;
const MAX_HAPPYHORSE_CAPACITY = 5;
const WAITING_DEMAND_FRESH_MS = 2 * 60_000;
// Long enough to protect an upstream task when DashScope accepted it but the
// process lost its DB connection before attaching the returned task ID.
const RESERVED_LEASE_MS = 10 * 60_000;
const RUNNING_LEASE_MS = 45 * 60_000;

export interface VideoProviderSchedulingContext {
  userId: string;
  projectId: string;
  targetId: string;
}

export interface VideoProviderLeaseGrant {
  leaseToken: string;
  resourceKey: string;
}

export interface FairVideoProviderWaiter {
  id: string;
  userId: string;
  projectId: string;
  queuedAt: Date;
  createdAt: Date;
}

export function selectFairVideoProviderWaiter(
  waiting: FairVideoProviderWaiter[],
  active: Array<{ userId: string; projectId: string }>,
): FairVideoProviderWaiter | undefined {
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

export class VideoProviderCapacityError extends Error {
  constructor(message = "HappyHorse rate limit capacity is currently full; the task remains queued") {
    super(message);
    this.name = "VideoProviderCapacityError";
  }
}

export function isVideoProviderCapacityError(error: unknown): error is VideoProviderCapacityError {
  return error instanceof Error && error.name === "VideoProviderCapacityError";
}

function configuredCapacity(): number {
  const value = Number(process.env.ONE_PROMPT_HAPPYHORSE_GLOBAL_CONCURRENCY);
  const requested = Number.isFinite(value) ? Math.round(value) : DEFAULT_HAPPYHORSE_CAPACITY;
  return Math.max(1, Math.min(MAX_HAPPYHORSE_CAPACITY, requested));
}

export function happyHorseResourceKey(modelId: string): string {
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
  return `aliyun-bailian:${endpoint}:${modelId.trim().toLowerCase()}:${credentialFingerprint}`;
}

export async function registerVideoProviderDemand(
  modelId: string,
  context: VideoProviderSchedulingContext,
): Promise<void> {
  const resourceKey = happyHorseResourceKey(modelId);
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

export async function requestVideoProviderLease(
  modelId: string,
  context: VideoProviderSchedulingContext,
): Promise<VideoProviderLeaseGrant | null> {
  const resourceKey = happyHorseResourceKey(modelId);
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
    if (active.length >= configuredCapacity()) return null;

    const waiting = await tx.videoProviderTaskLease.findMany({
      where: {
        resourceKey,
        status: "waiting",
        lastRequestedAt: { gte: freshAfter },
      },
      orderBy: [{ queuedAt: "asc" }, { createdAt: "asc" }],
    });
    if (selectFairVideoProviderWaiter(waiting, active)?.id !== waiter.id) return null;

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

export async function attachUpstreamTaskToVideoProviderLease(
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

export async function returnVideoProviderLeaseToQueue(
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

export async function heartbeatVideoProviderLease(upstreamTaskId: string): Promise<void> {
  await prisma.videoProviderTaskLease.updateMany({
    where: { upstreamTaskId, status: "running" },
    data: { leaseExpiresAt: new Date(Date.now() + RUNNING_LEASE_MS) },
  });
}

export async function releaseVideoProviderLeaseByTaskId(
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

export async function runningVideoProviderLeaseTaskIds(): Promise<string[]> {
  const rows = await prisma.videoProviderTaskLease.findMany({
    where: { status: "running", upstreamTaskId: { not: null } },
    select: { upstreamTaskId: true },
    orderBy: { updatedAt: "asc" },
    take: MAX_HAPPYHORSE_CAPACITY,
  });
  return rows.flatMap((row) => row.upstreamTaskId ? [row.upstreamTaskId] : []);
}
