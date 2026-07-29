import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { VideoProductionJobKind } from "./production-job-queue";

const RUNTIME_PROTOCOL_VERSION = "video-production-v2";
const VERSIONED_SOURCES = [
  "scripts/video-production-worker.ts",
  "scripts/start-video-production-stack.mjs",
  "src/services/video-orchestrator/production-job-queue.ts",
  "src/services/video-orchestrator/project-service.ts",
  "src/services/video-orchestrator/provider-capacity.ts",
  "src/services/video-orchestrator/media-conditioned-planner.ts",
  "src/services/video-orchestrator/canonical-execution-contract.ts",
  "src/services/video-orchestrator/canonical-plan-contract.ts",
  "scripts/one-prompt-production-dashboard.ts",
] as const;

export function resolveVideoProductionRuntimeVersion(): string {
  const explicit = firstNonEmpty([
    process.env.VIDEO_PRODUCTION_RUNTIME_VERSION,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.RENDER_GIT_COMMIT,
    process.env.SOURCE_VERSION,
  ]);
  if (explicit) return `${RUNTIME_PROTOCOL_VERSION}:${explicit.slice(0, 24)}`;
  const hash = createHash("sha256").update(RUNTIME_PROTOCOL_VERSION);
  let sourceCount = 0;
  for (const relativePath of VERSIONED_SOURCES) {
    try {
      hash.update(relativePath);
      hash.update(readFileSync(resolve(process.cwd(), relativePath)));
      sourceCount += 1;
    } catch {
      // Production bundles may not contain source files. The protocol version
      // remains a deterministic fallback and can be overridden by deployment SHA.
    }
  }
  return `${RUNTIME_PROTOCOL_VERSION}:${sourceCount ? hash.digest("hex").slice(0, 16) : "bundle"}`;
}

export async function heartbeatVideoProductionWorker(input: {
  workerId: string;
  runtimeVersion: string;
  supportedKinds?: VideoProductionJobKind[];
  supportedPayloadVersions: readonly number[];
  processId?: number;
  currentJobId?: string | null;
  claimed?: boolean;
  meaningfulProgress?: boolean;
  error?: unknown;
}): Promise<void> {
  const now = new Date();
  const errorMessage = input.error === undefined
    ? null
    : input.error instanceof Error ? input.error.message : String(input.error);
  const supportedKinds = (input.supportedKinds ?? []) as Prisma.InputJsonValue;
  const supportedPayloadVersions = [...input.supportedPayloadVersions] as Prisma.InputJsonValue;
  await prisma.videoProductionWorkerRuntime.upsert({
    where: { workerId: input.workerId },
    create: {
      workerId: input.workerId,
      runtimeVersion: input.runtimeVersion,
      supportedKinds,
      supportedPayloadVersions,
      processId: input.processId,
      startedAt: now,
      heartbeatAt: now,
      currentJobId: input.currentJobId ?? null,
      lastClaimedAt: input.claimed ? now : null,
      lastMeaningfulProgressAt: input.meaningfulProgress ? now : null,
      lastError: errorMessage,
    },
    update: {
      runtimeVersion: input.runtimeVersion,
      supportedKinds,
      supportedPayloadVersions,
      processId: input.processId,
      heartbeatAt: now,
      currentJobId: input.currentJobId ?? null,
      ...(input.claimed ? { lastClaimedAt: now } : {}),
      ...(input.meaningfulProgress ? { lastMeaningfulProgressAt: now } : {}),
      lastError: errorMessage,
    },
  });
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}
