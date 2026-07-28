import {
  pumpGlobalProviderQueue,
  pumpVideoProductionJobs,
} from "../src/services/video-orchestrator/project-service";
import type { VideoProductionJobKind } from "../src/services/video-orchestrator/production-job-queue";
import { prisma } from "../src/lib/prisma";

const workerId = process.env.VIDEO_PRODUCTION_WORKER_ID?.trim()
  || `video-production-${process.pid}`;
const idleDelayMs = boundedInt("VIDEO_PRODUCTION_WORKER_IDLE_MS", 1_000, 100, 30_000);
const errorDelayMs = boundedInt("VIDEO_PRODUCTION_WORKER_ERROR_MS", 3_000, 500, 60_000);
const batchSize = boundedInt("VIDEO_PRODUCTION_WORKER_BATCH_SIZE", 20, 1, 100);
const kinds = productionJobKinds(process.env.VIDEO_PRODUCTION_WORKER_KINDS);
const runOnce = process.env.VIDEO_PRODUCTION_WORKER_ONCE === "1";
const discoveryIntervalMs = boundedInt(
  "VIDEO_PRODUCTION_RECONCILE_DISCOVERY_MS",
  5_000,
  1_000,
  60_000,
);
const discoversOrphanedWork = !kinds || kinds.includes("project_reconcile");

async function main(): Promise<void> {
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });

  console.info("[video-production-worker] started", {
    workerId,
    idleDelayMs,
    batchSize,
    kinds: kinds ?? "all",
    discoversOrphanedWork,
    discoveryIntervalMs,
  });

  let lastDiscoveryAt = 0;
  while (!stopping) {
    try {
      if (
        discoversOrphanedWork
        && Date.now() - lastDiscoveryAt >= discoveryIntervalMs
      ) {
        const discovery = await pumpGlobalProviderQueue();
        lastDiscoveryAt = Date.now();
        if (discovery.syncedCount || discovery.failedCount) {
          console.info("[video-production-worker] reconcile discovery", discovery);
        }
      }
      const result = await pumpVideoProductionJobs({ workerId, maxJobs: batchSize, kinds });
      if (runOnce) break;
      if (result.claimedCount === 0) await delay(idleDelayMs);
    } catch (error) {
      console.error("[video-production-worker] pump failed", error);
      await delay(errorDelayMs);
    }
  }

  console.info("[video-production-worker] stopped", { workerId });
  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error("[video-production-worker] fatal error", error);
  process.exitCode = 1;
  void prisma.$disconnect();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function productionJobKinds(raw: string | undefined): VideoProductionJobKind[] | undefined {
  const valid = new Set<VideoProductionJobKind>([
    "planning",
    "project_reconcile",
    "image_prepare_submit",
    "image_quality",
    "micro_shot_prepare_submit",
    "clip_prepare_submit",
  ]);
  const parsed = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is VideoProductionJobKind => valid.has(item as VideoProductionJobKind));
  return parsed.length ? [...new Set(parsed)] : undefined;
}
