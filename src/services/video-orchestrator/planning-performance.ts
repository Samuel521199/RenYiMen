import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PlanningMetricStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface PlanningStageObservation {
  stage: string;
  modelName: string;
  status: "completed" | "failed";
  durationMs: number;
  httpStatus?: number;
  retryable?: boolean;
  startedAt: Date;
  completedAt: Date;
}

export interface PlanningProgressCounters {
  jsonRepairCount: number;
  jsonRepairDurationMs: number;
  singleTakeRepairCount: number;
  singleTakeRepairDurationMs: number;
  storyContractRepairCount: number;
  storyContractRepairDurationMs: number;
}

export interface PlanningPerformanceAttempt {
  taskId: string;
  rootTaskId: string;
  attemptNumber: number;
}

export function planningAttemptTaskId(rootTaskId: string, attemptNumber: number): string {
  return attemptNumber <= 1 ? rootTaskId : `${rootTaskId}:attempt:${attemptNumber}`;
}

function reportMetricsFailure(operation: string, error: unknown): void {
  // Metrics must never make the generation path fail.
  console.warn(`[planning-performance] ${operation} failed`, error);
}

export function normalizePlanningStage(rawStage: string): {
  stage: string;
  segmentNo?: number;
  attempt: number;
  kind: string;
} {
  const stage = rawStage.toLowerCase();
  const segmentMatch = stage.match(/_s(\d+)/);
  const attemptMatch = stage.match(/(?:_r|_repair_)(\d+)(?:_|$)/);
  let normalized = rawStage;
  let kind = "model_call";

  if (stage.startsWith("json_repair_")) {
    normalized = "json_repair";
    kind = "repair";
  } else if (stage.startsWith("asset_visual_spec_")) {
    normalized = "asset_visual_spec";
  } else if (stage.startsWith("asset_prompt_contract_repair")) {
    normalized = "asset_prompt_contract_repair";
    kind = "repair";
  } else if (stage.startsWith("story_contract_repair")) {
    normalized = "story_contract_repair";
    kind = "repair";
  } else if (stage.startsWith("planning_duration_repair")) {
    normalized = "planning_duration_repair";
    kind = "repair";
  } else if (stage.startsWith("timeline_replan")) {
    normalized = "timeline_replan";
    kind = "repair";
  } else if (stage.startsWith("split_repair")) {
    normalized = "split_repair";
    kind = "repair";
  } else if (stage.startsWith("shot_decomposer")) {
    normalized = "shot_decomposer";
  } else if (stage.startsWith("prompt_detailer")) {
    normalized = "prompt_detailer";
  }

  return {
    stage: normalized,
    segmentNo: segmentMatch ? Number(segmentMatch[1]) : undefined,
    attempt: attemptMatch ? Number(attemptMatch[1]) + 1 : 1,
    kind,
  };
}

export async function queuePlanningPerformanceRun(input: {
  taskId: string;
  projectId: string;
  userId: string;
  plannerArch: string;
  durationSeconds: number;
  referenceImageCount: number;
  checkpointResume: boolean;
  queuedAt?: Date;
}): Promise<void> {
  const queuedAt = input.queuedAt ?? new Date();
  try {
    await prisma.videoPlanningRunMetric.upsert({
      where: { taskId: input.taskId },
      create: {
        taskId: input.taskId,
        rootTaskId: input.taskId,
        attemptNumber: 1,
        projectId: input.projectId,
        userId: input.userId,
        plannerArch: input.plannerArch,
        durationSeconds: input.durationSeconds,
        referenceImageCount: input.referenceImageCount,
        checkpointResume: input.checkpointResume,
        queuedAt,
      },
      update: {
        // An idempotent enqueue must not reopen a terminal attempt.
        plannerArch: input.plannerArch,
        durationSeconds: input.durationSeconds,
        referenceImageCount: input.referenceImageCount,
        checkpointResume: input.checkpointResume,
      },
    });
  } catch (error) {
    reportMetricsFailure("queue run", error);
  }
}

export async function startPlanningPerformanceRun(
  rootTaskId: string,
  options: {
    attemptNumber?: number;
    queuedAt?: Date;
    startedAt?: Date;
    checkpointResume?: boolean;
  } = {},
): Promise<PlanningPerformanceAttempt> {
  const startedAt = options.startedAt ?? new Date();
  try {
    const root = await prisma.videoPlanningRunMetric.findFirst({
      where: { rootTaskId },
      orderBy: { attemptNumber: "asc" },
      select: {
        projectId: true,
        userId: true,
        plannerArch: true,
        modelName: true,
        durationSeconds: true,
        referenceImageCount: true,
      },
    });
    if (!root) {
      return { taskId: rootTaskId, rootTaskId, attemptNumber: options.attemptNumber ?? 1 };
    }
    const latest = await prisma.videoPlanningRunMetric.findFirst({
      where: { rootTaskId },
      orderBy: { attemptNumber: "desc" },
      select: { attemptNumber: true, status: true },
    });
    const attemptNumber = Math.max(
      1,
      options.attemptNumber
        ?? (latest?.status === "queued" || latest?.status === "running"
          ? latest.attemptNumber
          : (latest?.attemptNumber ?? 0) + 1),
    );
    const taskId = planningAttemptTaskId(rootTaskId, attemptNumber);
    const queuedAt = options.queuedAt ?? startedAt;
    const run = await prisma.videoPlanningRunMetric.upsert({
      where: { rootTaskId_attemptNumber: { rootTaskId, attemptNumber } },
      create: {
        taskId,
        rootTaskId,
        attemptNumber,
        projectId: root.projectId,
        userId: root.userId,
        status: "queued",
        plannerArch: root.plannerArch,
        modelName: root.modelName,
        durationSeconds: root.durationSeconds,
        referenceImageCount: root.referenceImageCount,
        checkpointResume: options.checkpointResume ?? attemptNumber > 1,
        queuedAt,
      },
      update: {},
      select: { taskId: true, queuedAt: true, startedAt: true, queueDurationMs: true },
    });
    await prisma.videoPlanningRunMetric.update({
      where: { taskId: run.taskId },
      data: {
        status: "running",
        startedAt: run.startedAt ?? startedAt,
        queueDurationMs: run.queueDurationMs ?? Math.max(0, startedAt.getTime() - run.queuedAt.getTime()),
        completedAt: null,
        totalDurationMs: null,
        failureStage: null,
        errorCategory: null,
      },
    });
    return { taskId: run.taskId, rootTaskId, attemptNumber };
  } catch (error) {
    reportMetricsFailure("start run", error);
    return { taskId: rootTaskId, rootTaskId, attemptNumber: options.attemptNumber ?? 1 };
  }
}

export async function recordPlanningStageObservation(
  taskId: string,
  observation: PlanningStageObservation,
): Promise<void> {
  try {
    const run = await prisma.videoPlanningRunMetric.findUnique({
      where: { taskId },
      select: { id: true, modelName: true },
    });
    if (!run) return;
    const normalized = normalizePlanningStage(observation.stage);
    await prisma.$transaction([
      prisma.videoPlanningStageMetric.create({
        data: {
          runId: run.id,
          stage: normalized.stage,
          segmentNo: normalized.segmentNo,
          attempt: normalized.attempt,
          kind: normalized.kind,
          modelName: observation.modelName,
          status: observation.status,
          durationMs: Math.max(0, Math.round(observation.durationMs)),
          httpStatus: observation.httpStatus,
          retryable: observation.retryable,
          startedAt: observation.startedAt,
          completedAt: observation.completedAt,
        },
      }),
      ...(run.modelName
        ? []
        : [prisma.videoPlanningRunMetric.update({
            where: { id: run.id },
            data: { modelName: observation.modelName },
          })]),
    ]);
  } catch (error) {
    reportMetricsFailure("record stage", error);
  }
}

export async function finishPlanningPerformanceRun(input: {
  taskId: string;
  status: Exclude<PlanningMetricStatus, "queued" | "running">;
  segmentCount?: number;
  failureStage?: string;
  errorCategory?: string;
  counters?: PlanningProgressCounters;
  completedAt?: Date;
}): Promise<void> {
  const completedAt = input.completedAt ?? new Date();
  try {
    const run = await prisma.videoPlanningRunMetric.findUnique({
      where: { taskId: input.taskId },
      select: { startedAt: true, queuedAt: true, completedAt: true },
    });
    if (!run) return;
    if (run.completedAt) return;
    await prisma.videoPlanningRunMetric.update({
      where: { taskId: input.taskId },
      data: {
        status: input.status,
        segmentCount: input.segmentCount,
        completedAt,
        totalDurationMs: Math.max(
          0,
          completedAt.getTime() - (run.startedAt ?? run.queuedAt).getTime(),
        ),
        failureStage: input.failureStage,
        errorCategory: input.errorCategory,
        jsonRepairCount: input.counters?.jsonRepairCount,
        jsonRepairDurationMs: input.counters?.jsonRepairDurationMs,
        singleTakeRepairCount: input.counters?.singleTakeRepairCount,
        singleTakeRepairDurationMs: input.counters?.singleTakeRepairDurationMs,
        storyContractRepairCount: input.counters?.storyContractRepairCount,
        storyContractRepairMs: input.counters?.storyContractRepairDurationMs,
      },
    });
  } catch (error) {
    reportMetricsFailure("finish run", error);
  }
}

type AggregateRow = {
  sample_count: number | bigint;
  completed_count: number | bigint;
  failed_count: number | bigint;
  p50_ms: number | null;
  p95_ms: number | null;
  avg_ms: number | null;
  queue_p50_ms: number | null;
  first_pass_count: number | bigint;
  json_repair_count: number | bigint;
  single_take_repair_count: number | bigint;
  checkpoint_resume_count: number | bigint;
};

type StageAggregateRow = {
  stage: string;
  sample_count: number | bigint;
  failed_count: number | bigint;
  p50_ms: number | null;
  p95_ms: number | null;
  avg_ms: number | null;
};

function count(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function ms(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

export async function getPlanningPerformanceBaseline(filters: {
  days: number;
  durationSeconds?: number;
  modelName?: string;
}) {
  const since = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
  const clauses = [
    Prisma.sql`r."queued_at" >= ${since}`,
    ...(filters.durationSeconds ? [Prisma.sql`r."duration_seconds" = ${filters.durationSeconds}`] : []),
    ...(filters.modelName ? [Prisma.sql`r."model_name" = ${filters.modelName}`] : []),
  ];
  const where = Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;

  try {
    const [summaryRows, stageRows, modelRows] = await Promise.all([
      prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH filtered_attempts AS (
          SELECT r.*
          FROM "video_planning_run_metrics" r
          ${where}
        ),
        logical_runs AS (
          SELECT
            r."root_task_id",
            MIN(r."queued_at") AS "queued_at",
            MAX(r."completed_at") AS "completed_at",
            MAX(r."attempt_number") AS "attempt_count",
            (ARRAY_AGG(r."status" ORDER BY r."attempt_number" DESC))[1] AS "status",
            (ARRAY_AGG(r."total_duration_ms" ORDER BY r."attempt_number" DESC))[1] AS "latest_attempt_duration_ms",
            BOOL_OR(r."json_repair_count" > 0) AS "had_json_repair",
            BOOL_OR(r."single_take_repair_count" > 0) AS "had_single_take_repair",
            BOOL_OR(r."story_contract_repair_count" > 0) AS "had_story_contract_repair",
            BOOL_OR(r."checkpoint_resume") OR MAX(r."attempt_number") > 1 AS "checkpoint_resume",
            MIN(r."queue_duration_ms") FILTER (WHERE r."attempt_number" = 1) AS "queue_duration_ms"
          FROM filtered_attempts r
          GROUP BY r."root_task_id"
        )
        SELECT
          COUNT(*)::int AS sample_count,
          COUNT(*) FILTER (WHERE r."status" = 'completed')::int AS completed_count,
          COUNT(*) FILTER (WHERE r."status" = 'failed')::int AS failed_count,
          percentile_cont(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (r."completed_at" - r."queued_at")) * 1000
          )
            FILTER (WHERE r."status" = 'completed') AS p50_ms,
          percentile_cont(0.95) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (r."completed_at" - r."queued_at")) * 1000
          )
            FILTER (WHERE r."status" = 'completed') AS p95_ms,
          (AVG(EXTRACT(EPOCH FROM (r."completed_at" - r."queued_at")) * 1000)
            FILTER (WHERE r."status" = 'completed'))::float8 AS avg_ms,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY r."queue_duration_ms")
            FILTER (WHERE r."queue_duration_ms" IS NOT NULL) AS queue_p50_ms,
          COUNT(*) FILTER (
            WHERE r."status" = 'completed'
              AND r."attempt_count" = 1
              AND NOT r."had_json_repair"
              AND NOT r."had_single_take_repair"
              AND NOT r."had_story_contract_repair"
          )::int AS first_pass_count,
          COUNT(*) FILTER (WHERE r."had_json_repair")::int AS json_repair_count,
          COUNT(*) FILTER (WHERE r."had_single_take_repair")::int AS single_take_repair_count,
          COUNT(*) FILTER (WHERE r."checkpoint_resume" = true)::int AS checkpoint_resume_count
        FROM logical_runs r
      `),
      prisma.$queryRaw<StageAggregateRow[]>(Prisma.sql`
        SELECT
          s."stage",
          COUNT(*)::int AS sample_count,
          COUNT(*) FILTER (WHERE s."status" = 'failed')::int AS failed_count,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY s."duration_ms") AS p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY s."duration_ms") AS p95_ms,
          AVG(s."duration_ms")::float8 AS avg_ms
        FROM "video_planning_stage_metrics" s
        INNER JOIN "video_planning_run_metrics" r ON r."id" = s."run_id"
        ${where}
        GROUP BY s."stage"
        ORDER BY p95_ms DESC NULLS LAST
      `),
      prisma.videoPlanningRunMetric.findMany({
        where: {
          queuedAt: { gte: since },
          ...(filters.durationSeconds ? { durationSeconds: filters.durationSeconds } : {}),
        },
        distinct: ["modelName"],
        select: { modelName: true },
        orderBy: { modelName: "asc" },
      }),
    ]);

    const row = summaryRows[0];
    const samples = row ? count(row.sample_count) : 0;
    const completed = row ? count(row.completed_count) : 0;
    const failed = row ? count(row.failed_count) : 0;
    return {
      storageReady: true,
      generatedAt: new Date().toISOString(),
      windowDays: filters.days,
      filters: {
        durationSeconds: filters.durationSeconds ?? null,
        modelName: filters.modelName ?? null,
      },
      sampleCount: samples,
      completedCount: completed,
      failedCount: failed,
      successRate: ratio(completed, completed + failed),
      firstPassRate: ratio(row ? count(row.first_pass_count) : 0, completed),
      jsonRepairRate: ratio(row ? count(row.json_repair_count) : 0, samples),
      singleTakeRepairRate: ratio(row ? count(row.single_take_repair_count) : 0, samples),
      checkpointResumeRate: ratio(row ? count(row.checkpoint_resume_count) : 0, samples),
      totalDurationMs: {
        p50: ms(row?.p50_ms ?? null),
        p95: ms(row?.p95_ms ?? null),
        average: ms(row?.avg_ms ?? null),
      },
      queueDurationMs: { p50: ms(row?.queue_p50_ms ?? null) },
      stages: stageRows.map((stage) => {
        const stageSamples = count(stage.sample_count);
        return {
          stage: stage.stage,
          sampleCount: stageSamples,
          failureRate: ratio(count(stage.failed_count), stageSamples),
          durationMs: {
            p50: ms(stage.p50_ms),
            p95: ms(stage.p95_ms),
            average: ms(stage.avg_ms),
          },
        };
      }),
      availableModels: modelRows.flatMap((item) => item.modelName ? [item.modelName] : []),
      baseline: {
        ready: completed >= 30,
        recommendedMinimum: 30,
        remainingSamples: Math.max(0, 30 - completed),
      },
    };
  } catch (error) {
    reportMetricsFailure("aggregate baseline", error);
    return {
      storageReady: false,
      generatedAt: new Date().toISOString(),
      windowDays: filters.days,
      filters: {
        durationSeconds: filters.durationSeconds ?? null,
        modelName: filters.modelName ?? null,
      },
      sampleCount: 0,
      completedCount: 0,
      failedCount: 0,
      successRate: 0,
      firstPassRate: 0,
      jsonRepairRate: 0,
      singleTakeRepairRate: 0,
      checkpointResumeRate: 0,
      totalDurationMs: { p50: null, p95: null, average: null },
      queueDurationMs: { p50: null },
      stages: [],
      availableModels: [],
      baseline: { ready: false, recommendedMinimum: 30, remainingSamples: 30 },
    };
  }
}
