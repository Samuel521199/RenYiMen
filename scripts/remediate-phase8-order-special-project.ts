import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Prisma } from "@prisma/client";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), false);

const PROJECT_ID = "cms45bepz0001tv8okj4l1o9w";
const AUDIT_ID = "phase8-order-deviation-20260728";
const SOURCE_EVIDENCE_PATH =
  "docs/baselines/phase8-order-special-project-source-evidence-2026-07-29.json";
const PHASE9_EVIDENCE_PATH =
  "docs/baselines/phase9-real-recovery-rollback-dashboard-2026-07-29.json";
const verifyOnly = process.argv.includes("--verify-only");

type Evidence = {
  phase8: {
    migration: string;
    startedAt: string;
    finishedAt: string;
    executionOrderDeviation: boolean;
  };
  compensatingReleaseCycle: {
    evidence: string;
    evidenceSha256: string;
    previousRuntimeVersion: string;
    candidateRuntimeVersion: string;
    finalRuntimeVersion: string;
    rollbackCompleted: boolean;
    providerPollingRecoveryCompleted: boolean;
    ffmpegRecoveryCompleted: boolean;
    finalInvariantViolations: number;
  };
  specialProject: {
    projectId: string;
    sourceBackup: string;
    sourceBackupSha256: string;
    baselineEvidence: string;
    baselineEvidenceSha256: string;
    originalStatus: string;
    completedJobs: number;
    failedJobs: number;
    activeJobs: number;
    planningJobCountBefore: number;
    targetMinus1000: Record<string, unknown>;
    targetMinus1005: Record<string, unknown>;
    orphanLease: Record<string, unknown>;
    currentProductionProjectExists: boolean;
    deletionAuditExists: boolean;
  };
};

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const evidence = readJson<Evidence>(SOURCE_EVIDENCE_PATH);
  const phase9 = readJson<Record<string, unknown>>(PHASE9_EVIDENCE_PATH);

  assertEqual(evidence.specialProject.projectId, PROJECT_ID, "special project id");
  assertHash(evidence.specialProject.sourceBackup, evidence.specialProject.sourceBackupSha256);
  assertHash(evidence.specialProject.baselineEvidence, evidence.specialProject.baselineEvidenceSha256);
  assertHash(evidence.compensatingReleaseCycle.evidence, evidence.compensatingReleaseCycle.evidenceSha256);
  assertCompensatingReleaseCycle(evidence, phase9);

  const migrationRows = await prisma.$queryRawUnsafe<Array<{
    started_at: Date;
    finished_at: Date | null;
    applied_steps_count: number;
  }>>(
    `SELECT started_at, finished_at, applied_steps_count
     FROM "_prisma_migrations"
     WHERE migration_name = $1 AND rolled_back_at IS NULL
     ORDER BY finished_at DESC
     LIMIT 1`,
    evidence.phase8.migration,
  );
  const migration = migrationRows[0];
  if (!migration?.finished_at || migration.applied_steps_count !== 1) {
    throw new Error(`Phase 8 migration ${evidence.phase8.migration} is not applied exactly once`);
  }
  assertEqual(
    migration.finished_at.toISOString(),
    evidence.phase8.finishedAt,
    "Phase 8 finishedAt",
  );

  const [project, planningJobsAfter, activeJobsAfter, activeLeaseAfter] = await Promise.all([
    prisma.videoProject.findUnique({ where: { id: PROJECT_ID }, select: { id: true, status: true } }),
    prisma.videoProductionJob.count({ where: { projectId: PROJECT_ID, kind: "planning" } }),
    prisma.videoProductionJob.count({
      where: {
        projectId: PROJECT_ID,
        status: { in: ["queued", "claimed", "running", "waiting_upstream", "waiting_review"] },
      },
    }),
    prisma.videoProviderTaskLease.count({
      where: { projectId: PROJECT_ID, status: { in: ["waiting", "reserved", "running"] } },
    }),
  ]);
  if (project) {
    throw new Error(
      `Project ${PROJECT_ID} exists in production with status ${project.status}; `
      + "this remediation is for the verified post-delete case and will not overwrite a live project.",
    );
  }
  if (planningJobsAfter !== 0 || activeJobsAfter !== 0 || activeLeaseAfter !== 0) {
    throw new Error("Deleted special project unexpectedly retains production jobs or provider leases");
  }

  const recoveryActions = [
    {
      targetId: String(evidence.specialProject.targetMinus1000.keyframeId),
      artifactId: "consistency_reference:-1000:image",
      errorCode: "EXECUTION_CONTRACT_TOO_LARGE",
      recoveryAction: "REPAIR_CONTRACT",
      executable: false,
      reason: "Source project was deleted before the special migration; restore must be explicit.",
    },
    {
      targetId: String(evidence.specialProject.targetMinus1005.keyframeId),
      artifactId: "consistency_reference:-1005:image",
      errorCode: "QUALITY_EVALUATION_FAILED",
      recoveryAction: "RETRY_QUALITY",
      executable: false,
      reason: "Source project was deleted before the special migration; restore must be explicit.",
    },
  ];
  const remediationEvidence = {
    source: evidence,
    currentVerification: {
      checkedAt: new Date().toISOString(),
      projectExists: false,
      planningJobsAfter,
      activeJobsAfter,
      activeLeaseAfter,
    },
    invariant: "No planning job was created while recording this remediation.",
  };

  if (!verifyOnly) {
    const now = new Date();
    await prisma.$transaction([
      prisma.videoArchitectureMigrationAudit.upsert({
        where: { id: AUDIT_ID },
        create: {
          id: AUDIT_ID,
          phase: "Phase 8",
          auditType: "EXECUTION_ORDER_DEVIATION",
          status: "compensated",
          observedFrom: migration.finished_at,
          observedTo: now,
          releaseCycleId: "phase9-real-recovery-rollback-20260729",
          evidence: remediationEvidence as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: "compensated",
          observedFrom: migration.finished_at,
          observedTo: now,
          releaseCycleId: "phase9-real-recovery-rollback-20260729",
          evidence: remediationEvidence as unknown as Prisma.InputJsonValue,
        },
      }),
      prisma.videoSpecialProjectRecoveryRecord.upsert({
        where: { projectId: PROJECT_ID },
        create: {
          projectId: PROJECT_ID,
          sourceBackup: evidence.specialProject.sourceBackup,
          sourceBackupSha256: evidence.specialProject.sourceBackupSha256,
          originalStatus: evidence.specialProject.originalStatus,
          resultingState: "WAITING_RECOVERY_ARCHIVED",
          disposition: "PROJECT_DELETED_BEFORE_SPECIAL_MIGRATION",
          recoveryActions: recoveryActions as Prisma.InputJsonValue,
          orphanLeaseDisposition: "RELEASED_BY_PROJECT_DELETE_CASCADE",
          planningRestarted: false,
          planningJobCountBefore: evidence.specialProject.planningJobCountBefore,
          planningJobCountAfter: planningJobsAfter,
          evidence: remediationEvidence as unknown as Prisma.InputJsonValue,
        },
        update: {
          sourceBackup: evidence.specialProject.sourceBackup,
          sourceBackupSha256: evidence.specialProject.sourceBackupSha256,
          originalStatus: evidence.specialProject.originalStatus,
          resultingState: "WAITING_RECOVERY_ARCHIVED",
          disposition: "PROJECT_DELETED_BEFORE_SPECIAL_MIGRATION",
          recoveryActions: recoveryActions as Prisma.InputJsonValue,
          orphanLeaseDisposition: "RELEASED_BY_PROJECT_DELETE_CASCADE",
          planningRestarted: false,
          planningJobCountBefore: evidence.specialProject.planningJobCountBefore,
          planningJobCountAfter: planningJobsAfter,
          evidence: remediationEvidence as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "video_legacy_execution_archive"
         ("project_id", "source_table", "source_id", "legacy_payload")
       SELECT $1, 'phase8_special_project_recovery', $1, $2::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM "video_legacy_execution_archive"
         WHERE "project_id" = $1
           AND "source_table" = 'phase8_special_project_recovery'
           AND "source_id" = $1
       )`,
      PROJECT_ID,
      JSON.stringify(remediationEvidence),
    );
  }

  const [audit, recovery] = await Promise.all([
    prisma.videoArchitectureMigrationAudit.findUnique({ where: { id: AUDIT_ID } }),
    prisma.videoSpecialProjectRecoveryRecord.findUnique({ where: { projectId: PROJECT_ID } }),
  ]);
  if (!audit || audit.status !== "compensated") {
    throw new Error("Phase 8 deviation has no completed compensating audit");
  }
  if (
    !recovery
    || recovery.resultingState !== "WAITING_RECOVERY_ARCHIVED"
    || recovery.planningRestarted
    || recovery.planningJobCountAfter !== 0
  ) {
    throw new Error("Special project recovery record does not satisfy the no-replanning invariant");
  }

  console.log(JSON.stringify({
    ok: true,
    verifyOnly,
    phase8Audit: {
      id: audit.id,
      status: audit.status,
      observedFrom: audit.observedFrom,
      observedTo: audit.observedTo,
      releaseCycleId: audit.releaseCycleId,
    },
    specialProject: {
      projectId: recovery.projectId,
      originalStatus: recovery.originalStatus,
      resultingState: recovery.resultingState,
      disposition: recovery.disposition,
      orphanLeaseDisposition: recovery.orphanLeaseDisposition,
      planningRestarted: recovery.planningRestarted,
      planningJobCountBefore: recovery.planningJobCountBefore,
      planningJobCountAfter: recovery.planningJobCountAfter,
      recoveryActions: recovery.recoveryActions,
    },
  }, null, 2));
  await prisma.$disconnect();
}

function assertCompensatingReleaseCycle(evidence: Evidence, phase9: Record<string, unknown>) {
  const cycle = evidence.compensatingReleaseCycle;
  if (
    !cycle.rollbackCompleted
    || !cycle.providerPollingRecoveryCompleted
    || !cycle.ffmpegRecoveryCompleted
    || cycle.finalInvariantViolations !== 0
  ) {
    throw new Error("Compensating Phase 9 release cycle is incomplete");
  }
  const versions = new Set([
    cycle.previousRuntimeVersion,
    cycle.candidateRuntimeVersion,
    cycle.finalRuntimeVersion,
  ]);
  if (versions.size !== 3) throw new Error("Release/rollback cycle does not contain three distinct builds");
  const dashboard = asRecord(phase9.dashboard);
  const metrics = asRecord(dashboard.metrics);
  const invariantNames = [
    "projectReconcileSinceCutover",
    "nullOrEmptyTargetId",
    "generatingWithoutActiveJob",
    "duplicateActiveTargetRevision",
    "terminalProjectActiveJobs",
    "incompatibleWorkerConsumptions",
  ];
  for (const name of invariantNames) {
    if (Number(metrics[name]) !== 0) throw new Error(`Phase 9 invariant ${name} is not zero`);
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as T;
}

function assertHash(path: string, expected: string) {
  const actual = createHash("sha256")
    .update(readFileSync(resolve(process.cwd(), path)))
    .digest("hex")
    .toUpperCase();
  assertEqual(actual, expected.toUpperCase(), `SHA256 ${path}`);
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected=${String(expected)} actual=${String(actual)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
