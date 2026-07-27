import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

const QUALITY_CACHE_LEASE_MS = 5 * 60 * 1000;

export type QualityCacheClaim =
  | { state: "hit"; report: Prisma.JsonValue; sourceCandidateId?: string }
  | { state: "claimed"; leaseToken: string }
  | { state: "busy"; retryAt: Date };

export interface QualityCacheIdentity {
  projectId: string;
  cacheKey: string;
  candidateContentHash: string;
  referenceSetHash: string;
  policyVersion: string;
  promptVersion: string;
  modelId: string;
  candidateId: string;
}

export async function claimQualityEvaluationCache(
  identity: QualityCacheIdentity,
): Promise<QualityCacheClaim> {
  const now = new Date();
  const existing = await prisma.videoQualityEvaluationCache.findUnique({
    where: {
      projectId_cacheKey: {
        projectId: identity.projectId,
        cacheKey: identity.cacheKey,
      },
    },
  });
  if (existing?.status === "completed" && existing.reportJson) {
    return {
      state: "hit",
      report: existing.reportJson,
      sourceCandidateId: existing.sourceCandidateId ?? undefined,
    };
  }
  if (
    existing?.status === "evaluating"
    && existing.leaseExpiresAt
    && existing.leaseExpiresAt.getTime() > now.getTime()
  ) {
    return { state: "busy", retryAt: existing.leaseExpiresAt };
  }

  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + QUALITY_CACHE_LEASE_MS);
  if (!existing) {
    try {
      await prisma.videoQualityEvaluationCache.create({
        data: {
          projectId: identity.projectId,
          cacheKey: identity.cacheKey,
          status: "evaluating",
          candidateContentHash: identity.candidateContentHash,
          referenceSetHash: identity.referenceSetHash,
          policyVersion: identity.policyVersion,
          promptVersion: identity.promptVersion,
          modelId: identity.modelId,
          sourceCandidateId: identity.candidateId,
          leaseToken,
          leaseExpiresAt,
        },
      });
      return { state: "claimed", leaseToken };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      return claimQualityEvaluationCache(identity);
    }
  }

  const claimed = await prisma.videoQualityEvaluationCache.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: { in: ["technical_failed", "unavailable"] } },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "evaluating",
      candidateContentHash: identity.candidateContentHash,
      referenceSetHash: identity.referenceSetHash,
      policyVersion: identity.policyVersion,
      promptVersion: identity.promptVersion,
      modelId: identity.modelId,
      sourceCandidateId: identity.candidateId,
      reportJson: Prisma.DbNull,
      lastError: null,
      leaseToken,
      leaseExpiresAt,
    },
  });
  if (claimed.count === 1) return { state: "claimed", leaseToken };
  return { state: "busy", retryAt: existing.leaseExpiresAt ?? leaseExpiresAt };
}

export async function completeQualityEvaluationCache(params: {
  projectId: string;
  cacheKey: string;
  leaseToken: string;
  report: Prisma.InputJsonValue;
  candidateId: string;
}): Promise<void> {
  await prisma.videoQualityEvaluationCache.updateMany({
    where: {
      projectId: params.projectId,
      cacheKey: params.cacheKey,
      leaseToken: params.leaseToken,
      status: "evaluating",
    },
    data: {
      status: "completed",
      reportJson: params.report,
      sourceCandidateId: params.candidateId,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
}

export async function failQualityEvaluationCache(params: {
  projectId: string;
  cacheKey: string;
  leaseToken: string;
  report?: Prisma.InputJsonValue;
  errorMessage: string;
}): Promise<void> {
  await prisma.videoQualityEvaluationCache.updateMany({
    where: {
      projectId: params.projectId,
      cacheKey: params.cacheKey,
      leaseToken: params.leaseToken,
    },
    data: {
      status: "technical_failed",
      reportJson: params.report ?? Prisma.DbNull,
      leaseToken: null,
      leaseExpiresAt: null,
      lastError: params.errorMessage,
    },
  });
}
