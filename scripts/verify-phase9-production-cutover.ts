import { readFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const activeStatuses = [
  "queued",
  "claimed",
  "running",
  "waiting_upstream",
  "waiting_review",
];

interface CountRow {
  count: number | bigint;
}

async function main() {
  const cutover = await prisma.$queryRaw<Array<{ cutover_at: Date }>>`
    SELECT COALESCE(
      MAX(finished_at),
      CURRENT_TIMESTAMP
    ) AS cutover_at
    FROM _prisma_migrations
    WHERE migration_name = '20260728235900_remove_legacy_video_execution_structure'
      AND rolled_back_at IS NULL
  `;
  const cutoverAt = cutover[0]?.cutover_at ?? new Date();
  const discoveryKind = ["project", "reconcile"].join("_");
  const activeSql = activeStatuses.map((value) => `'${value}'`).join(",");
  const generatingSql = [
    "PLANNING",
    "IMAGE_GENERATING",
    "CLIP_GENERATING",
    "COMPOSING",
  ].map((value) => `'${value}'`).join(",");

  const [
    discoveryRows,
    nullTargets,
    orphanGenerating,
    duplicateTargets,
    terminalActive,
    incompatibleConsumption,
    deploymentReplans,
  ] = await Promise.all([
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_production_jobs
      WHERE kind = $1 AND created_at >= $2
    `, discoveryKind, cutoverAt),
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_production_jobs
      WHERE target_id IS NULL OR LENGTH(BTRIM(target_id)) = 0
    `),
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_projects p
      WHERE p.status::text IN (${generatingSql})
        AND NOT EXISTS (
          SELECT 1
          FROM video_production_jobs j
          WHERE j.project_id = p.id
            AND j.status IN (${activeSql})
        )
    `),
    count(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT
          project_id,
          kind,
          target_id,
          COALESCE(
            payload ->> 'revision',
            payload ->> 'generationRevision',
            payload ->> 'artifactRevision',
            '1'
          ) AS revision
        FROM video_production_jobs
        WHERE status IN (${activeSql})
        GROUP BY
          project_id,
          kind,
          target_id,
          COALESCE(
            payload ->> 'revision',
            payload ->> 'generationRevision',
            payload ->> 'artifactRevision',
            '1'
          )
        HAVING COUNT(*) > 1
      ) duplicates
    `),
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_production_jobs j
      JOIN video_projects p ON p.id = j.project_id
      WHERE p.status::text IN ('FINAL_REVIEW', 'DONE')
        AND j.status IN (${activeSql})
    `),
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_production_jobs
      WHERE created_at >= $1
        AND claimed_worker_version IS NOT NULL
        AND claimed_worker_version <> required_worker_version
    `, cutoverAt),
    count(`
      SELECT COUNT(*)::int AS count
      FROM video_planning_run_metrics
      WHERE created_at >= $1
        AND attempt_number > 1
        AND checkpoint_resume = false
    `, cutoverAt),
  ]);

  const projectRoute = readFileSync(
    path.join(process.cwd(), "src/app/api/video-projects/[projectId]/route.ts"),
    "utf8",
  );
  const getStart = projectRoute.indexOf("export async function GET");
  const getEnd = projectRoute.indexOf("export async function PATCH", getStart);
  const getBody = projectRoute.slice(getStart, getEnd);
  const getWrites = /(?:update|create|delete|upsert|executeRaw)\s*\(/.test(getBody)
    ? 1
    : 0;

  const metrics = {
    discoveryJobsCreated: discoveryRows,
    nullOrEmptyTargets: nullTargets,
    generatingProjectsWithoutActiveJobs: orphanGenerating,
    duplicateActiveTargetRevisions: duplicateTargets,
    terminalProjectsWithActiveJobs: terminalActive,
    incompatibleWorkerConsumptions: incompatibleConsumption,
    getRequestsWithProjectWrites: getWrites,
    deploymentTriggeredFullReplans: deploymentReplans,
  };
  const violations = Object.entries(metrics)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => `${key}=${value}`);

  console.log(JSON.stringify({
    passed: violations.length === 0,
    cutoverAt: cutoverAt.toISOString(),
    metrics,
    violations,
  }, null, 2));
  if (violations.length) process.exitCode = 1;
}

async function count(sql: string, ...values: unknown[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql, ...values);
  return Number(rows[0]?.count ?? 0);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
