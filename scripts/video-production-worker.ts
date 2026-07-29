import { pumpVideoProductionJobs } from "../src/services/video-orchestrator/project-service";
import {
  beginVideoProductionDeploymentDrain,
  DEFAULT_DEPLOYMENT_GRACE_MS,
  releaseVideoProductionJobForInfrastructure,
  SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
  type VideoProductionJobKind,
} from "../src/services/video-orchestrator/production-job-queue";
import { prisma } from "../src/lib/prisma";
import {
  heartbeatVideoProductionWorker,
  resolveVideoProductionRuntimeVersion,
} from "../src/services/video-orchestrator/production-worker-runtime";

const workerId = process.env.VIDEO_PRODUCTION_WORKER_ID?.trim()
  || `video-production-${process.pid}`;
const idleDelayMs = boundedInt("VIDEO_PRODUCTION_WORKER_IDLE_MS", 1_000, 100, 30_000);
const errorDelayMs = boundedInt("VIDEO_PRODUCTION_WORKER_ERROR_MS", 3_000, 500, 60_000);
const batchSize = boundedInt("VIDEO_PRODUCTION_WORKER_BATCH_SIZE", 20, 1, 100);
const kinds = productionJobKinds(process.env.VIDEO_PRODUCTION_WORKER_KINDS);
const runOnce = process.env.VIDEO_PRODUCTION_WORKER_ONCE === "1";
const runtimeVersion = resolveVideoProductionRuntimeVersion();
const shutdownGraceMs = boundedInt(
  "VIDEO_PRODUCTION_WORKER_SHUTDOWN_GRACE_MS",
  DEFAULT_DEPLOYMENT_GRACE_MS,
  30_000,
  30 * 60_000,
);

async function main(): Promise<void> {
  let stopping = false;
  let activeLease: { id: string; projectId: string; leaseToken: string } | null = null;
  let shutdownTimer: NodeJS.Timeout | undefined;
  let shutdownSignalCount = 0;
  const releaseActiveLease = async (
    reason: "worker_shutdown" | "deployment_restart" | "worker_abort",
  ): Promise<void> => {
    const lease = activeLease;
    if (!lease) return;
    activeLease = null;
    await releaseVideoProductionJobForInfrastructure({
      id: lease.id,
      leaseToken: lease.leaseToken,
      reason,
    }).catch((error) =>
      console.error("[video-production-worker] failed to release active lease", {
        jobId: lease.id,
        error,
      }));
  };
  const requestStop = (signal: NodeJS.Signals) => {
    shutdownSignalCount += 1;
    stopping = true;
    const lease = activeLease;
    console.info("[video-production-worker] drain requested", {
      workerId,
      signal,
      currentJobId: lease?.id ?? null,
      shutdownGraceMs,
    });
    if (lease) {
      void beginVideoProductionDeploymentDrain({
        id: lease.id,
        leaseToken: lease.leaseToken,
        graceMs: shutdownGraceMs,
      });
    }
    if (shutdownSignalCount > 1) {
      void releaseActiveLease("worker_abort").finally(() => process.exit(0));
      return;
    }
    shutdownTimer ??= setTimeout(() => {
      void releaseActiveLease("deployment_restart").finally(() => process.exit(0));
    }, shutdownGraceMs);
    shutdownTimer.unref?.();
  };
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  console.info("[video-production-worker] started", {
    workerId,
    idleDelayMs,
    batchSize,
    kinds: kinds ?? "all",
    runtimeVersion,
  });
  await heartbeatVideoProductionWorker({
    workerId,
    runtimeVersion,
    supportedKinds: kinds,
    supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
    processId: process.pid,
  });

  while (!stopping) {
    try {
      const result = await pumpVideoProductionJobs({
        workerId,
        runtimeVersion,
        maxJobs: batchSize,
        kinds,
        shouldStop: () => stopping,
        onLeaseAcquired: async (lease) => {
          activeLease = lease;
          await heartbeatVideoProductionWorker({
            workerId,
            runtimeVersion,
            supportedKinds: kinds,
            supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
            processId: process.pid,
            currentJobId: lease.id,
            claimed: true,
          });
        },
        onLeaseReleased: async (lease) => {
          if (activeLease?.id === lease.id) activeLease = null;
          await heartbeatVideoProductionWorker({
            workerId,
            runtimeVersion,
            supportedKinds: kinds,
            supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
            processId: process.pid,
            currentJobId: null,
          });
        },
      });
      await heartbeatVideoProductionWorker({
        workerId,
        runtimeVersion,
        supportedKinds: kinds,
        supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
        processId: process.pid,
        claimed: result.claimedCount > 0,
        meaningfulProgress: result.meaningfulProgressCount > 0,
      });
      if (runOnce) break;
      if (result.claimedCount === 0) await delay(idleDelayMs);
    } catch (error) {
      console.error("[video-production-worker] pump failed", error);
      await heartbeatVideoProductionWorker({
        workerId,
        runtimeVersion,
        supportedKinds: kinds,
        supportedPayloadVersions: SUPPORTED_VIDEO_PRODUCTION_PAYLOAD_VERSIONS,
        processId: process.pid,
        error,
      }).catch(() => undefined);
      await delay(errorDelayMs);
    }
  }

  if (shutdownTimer) clearTimeout(shutdownTimer);
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
    "image_prepare_submit",
    "image_quality",
    "micro_shot_prepare_submit",
    "clip_prepare_submit",
    "compose",
  ]);
  const parsed = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is VideoProductionJobKind => valid.has(item as VideoProductionJobKind));
  return parsed.length ? [...new Set(parsed)] : undefined;
}
