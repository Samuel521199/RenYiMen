import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const port = boundedPort(process.env.ONE_PROMPT_METRICS_PORT, 3011);
const refreshMs = 5_000;
const activeStatuses = ["queued", "claimed", "running", "waiting_upstream", "waiting_review"];
const history: Array<{ capturedAt: string; metrics: Record<string, number> }> = [];

async function snapshot() {
  const [
    jobs,
    projects,
    workers,
    activeLeases,
    cutoverRows,
    unresolvedMigrationAudits,
  ] = await Promise.all([
    prisma.videoProductionJob.findMany({
      select: {
        id: true,
        projectId: true,
        kind: true,
        targetId: true,
        artifactId: true,
        status: true,
        payload: true,
        requiredWorkerVersion: true,
        claimedWorkerVersion: true,
        createdAt: true,
      },
    }),
    prisma.videoProject.findMany({ select: { id: true, status: true } }),
    prisma.videoProductionWorkerRuntime.findMany({
      orderBy: { workerId: "asc" },
      select: {
        workerId: true,
        runtimeVersion: true,
        supportedKinds: true,
        processId: true,
        startedAt: true,
        heartbeatAt: true,
        currentJobId: true,
        lastError: true,
      },
    }),
    prisma.videoProviderTaskLease.count({
      where: { status: { in: ["waiting", "reserved", "running"] } },
    }),
    prisma.$queryRawUnsafe<Array<{ finished_at: Date | null }>>(
      `SELECT finished_at
       FROM "_prisma_migrations"
       WHERE migration_name = '20260728235900_remove_legacy_video_execution_structure'
         AND rolled_back_at IS NULL
       ORDER BY finished_at DESC
       LIMIT 1`,
    ),
    prisma.videoArchitectureMigrationAudit.count({
      where: { status: { notIn: ["completed", "compensated"] } },
    }),
  ]);
  const cutoverAt = cutoverRows[0]?.finished_at ?? new Date(0);
  const projectStatus = new Map(projects.map((project) => [project.id, project.status]));
  const activeJobs = jobs.filter((job) => activeStatuses.includes(job.status));
  const duplicateKeys = new Map<string, number>();
  for (const job of activeJobs) {
    const payload = jsonRecord(job.payload);
    const revision = String(
      payload.revision ?? payload.generationRevision ?? payload.artifactRevision ?? "1",
    );
    const key = [job.projectId, job.kind, job.targetId, revision].join("|");
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }
  const metrics = {
    projectReconcileSinceCutover: jobs.filter((job) =>
      job.kind === "project_reconcile" && job.createdAt >= cutoverAt
    ).length,
    nullOrEmptyTargetId: jobs.filter((job) => !job.targetId.trim()).length,
    generatingWithoutActiveJob: projects.filter((project) =>
      ["PLANNING", "IMAGE_GENERATING", "CLIP_GENERATING", "COMPOSING"].includes(project.status)
      && !activeJobs.some((job) => job.projectId === project.id)
    ).length,
    duplicateActiveTargetRevision: [...duplicateKeys.values()].filter((count) => count > 1).length,
    terminalProjectActiveJobs: activeJobs.filter((job) =>
      ["FINAL_REVIEW", "DONE"].includes(projectStatus.get(job.projectId) ?? "")
    ).length,
    incompatibleWorkerConsumptions: jobs.filter((job) =>
      job.claimedWorkerVersion
      && job.claimedWorkerVersion !== job.requiredWorkerVersion
    ).length,
    unresolvedMigrationAudits,
    activeJobs: activeJobs.length,
    activeProviderLeases: activeLeases,
    healthyWorkers: workers.filter((worker) =>
      Date.now() - worker.heartbeatAt.getTime() < 30_000
    ).length,
  };
  const capturedAt = new Date().toISOString();
  history.push({ capturedAt, metrics });
  if (history.length > 720) history.splice(0, history.length - 720);
  return {
    capturedAt,
    cutoverAt,
    refreshMs,
    metrics,
    workers: workers.map((worker) => ({
      ...worker,
      healthy: Date.now() - worker.heartbeatAt.getTime() < 30_000,
    })),
    activeJobs: activeJobs.map((job) => ({
      id: job.id,
      projectId: job.projectId,
      kind: job.kind,
      targetId: job.targetId,
      artifactId: job.artifactId,
      status: job.status,
      requiredWorkerVersion: job.requiredWorkerVersion,
      claimedWorkerVersion: job.claimedWorkerVersion,
      createdAt: job.createdAt,
    })),
    history,
  };
}

const server = createServer(async (request, response) => {
  try {
    const data = await snapshot();
    if (request.url === "/metrics") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(data, null, 2));
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderDashboard(data));
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[one-prompt-production-dashboard] http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

function renderDashboard(data: Awaited<ReturnType<typeof snapshot>>) {
  const invariantMetrics = new Set([
    "projectReconcileSinceCutover",
    "nullOrEmptyTargetId",
    "generatingWithoutActiveJob",
    "duplicateActiveTargetRevision",
    "terminalProjectActiveJobs",
    "incompatibleWorkerConsumptions",
    "unresolvedMigrationAudits",
  ]);
  const cards = Object.entries(data.metrics).map(([name, value]) =>
    `<article class="${!invariantMetrics.has(name) || value === 0 ? "ok" : "warn"}"><strong>${value}</strong><span>${name}</span></article>`
  ).join("");
  const workers = data.workers.map((worker) =>
    `<tr><td>${worker.workerId}</td><td>${worker.healthy ? "healthy" : "stale"}</td>`
    + `<td>${worker.runtimeVersion}</td><td>${worker.processId ?? ""}</td>`
    + `<td>${worker.currentJobId ?? ""}</td><td>${worker.heartbeatAt.toISOString()}</td></tr>`
  ).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="5"><title>一句话成片生产指标</title>
<style>body{font:14px system-ui;background:#07111f;color:#dcecff;margin:24px}h1{margin-bottom:4px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px;margin:24px 0}
article{border:1px solid #24415f;border-radius:10px;padding:16px;background:#0e2033}
article strong{font-size:30px;display:block}.ok strong{color:#42d392}.warn strong{color:#ffb454}
article span{color:#9eb7ce}table{width:100%;border-collapse:collapse;background:#0e2033}
th,td{text-align:left;padding:10px;border-bottom:1px solid #24415f}code{color:#83d4ff}</style></head>
<body><h1>一句话成片生产指标</h1><div>采集时间 <code>${data.capturedAt}</code> · 切换基线 <code>${data.cutoverAt.toISOString()}</code> · 每 5 秒刷新</div>
<section class="grid">${cards}</section><h2>Worker 心跳</h2>
<table><thead><tr><th>Worker</th><th>健康</th><th>版本</th><th>PID</th><th>当前 Job</th><th>心跳</th></tr></thead>
<tbody>${workers}</tbody></table></body></html>`;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedPort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : fallback;
}
