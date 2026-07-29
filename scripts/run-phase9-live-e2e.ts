import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  approveAssetLibrary,
  approveMicroShotReferences,
  approveShotImages,
  approveVideoClips,
  approveVideoPlan,
  composeVideoProject,
  createVideoProject,
  finishVideoProject,
  getVideoProject,
  queueVideoProjectPlanning,
  selectGenerationCandidate,
  serializeVideoProject,
} from "../src/services/video-orchestrator/project-service";

if (process.env.PHASE9_LIVE_E2E !== "1" || !process.argv.includes("--confirm-billable")) {
  throw new Error(
    "Live provider calls are disabled. Set PHASE9_LIVE_E2E=1 and pass --confirm-billable.",
  );
}

const timeoutMs = 90 * 60_000;
const startedAt = new Date();
const outputDir = path.resolve("backups/one-prompt-phase9-live");
mkdirSync(outputDir, { recursive: true });

async function main() {
  const resumeProjectId = process.env.PHASE9_LIVE_E2E_PROJECT_ID?.trim();
  const resumeProject = resumeProjectId
    ? await prisma.videoProject.findUnique({
        where: { id: resumeProjectId },
        select: { id: true, userId: true },
      })
    : null;
  const user = await prisma.user.findFirst({
    where: {
      ...(resumeProject ? { id: resumeProject.userId } : { balance: { gt: 0 } }),
    },
    orderBy: { balance: "desc" },
    select: { id: true, email: true, balance: true },
  });
  if (!user) throw new Error("No funded user is available for the live E2E.");

  const project = resumeProject
    ? await getVideoProject(user.id, resumeProject.id)
    : await createVideoProject(user.id, {
        userPrompt:
          "制作一个15秒竖屏极简产品广告。全片为单一连续镜头：一个蓝色玻璃球在纯白摄影棚中缓慢滚动，镜头平稳跟随，最后停在玻璃球特写。不要人物、动物、文字、字幕、标志或界面。尽量使用最少资产、最少片段和最简单的连续运动。",
        referenceImageUrls: [],
        aspectRatio: "9:16",
        durationSeconds: 15,
        shotCount: 1,
        stylePreset: "极简产品广告",
      });
  if (!project) throw new Error(`Live E2E resume project ${resumeProjectId} was not found.`);
  const evidencePath = path.join(outputDir, `live-e2e-${project.id}.json`);
  writeFileSync(evidencePath, JSON.stringify({
    projectId: project.id,
    userId: user.id,
    userEmail: user.email,
    balanceBefore: user.balance,
    startedAt: startedAt.toISOString(),
    status: project.status,
  }, null, 2));
  process.stdout.write(`LIVE_E2E_PROJECT_ID=${project.id}\n`);
  process.stdout.write(`EVIDENCE_PATH=${evidencePath}\n`);

  // A resumed canary must continue from its durable task-graph frontier. Re-enqueuing
  // planning for a project that already has materialized artifacts invalidates the
  // very recovery behavior this test is intended to prove.
  if (project.status === "DRAFT") {
    await queueVideoProjectPlanning(user.id, project.id);
  }
  const completedActions = new Set<string>();
  let lastSignature = "";

  while (Date.now() - startedAt.getTime() < timeoutMs) {
    const current = await getVideoProject(user.id, project.id);
    if (!current) throw new Error("Live E2E project disappeared.");
    const serialized = serializeVideoProject(current);
    const graph = serialized.taskGraph;
    const signature = JSON.stringify({
      status: current.status,
      node: graph.currentNode,
      action: graph.allowedActions[0],
      progress: graph.progress.percent,
      error: current.errorMessage,
    });
    if (signature !== lastSignature) {
      process.stdout.write(`${new Date().toISOString()} ${signature}\n`);
      lastSignature = signature;
    }

    if (current.status === "DONE") {
      const finishedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { balance: true },
      });
      const chargeTransactions = await prisma.transaction.findMany({
        where: {
          userId: user.id,
          taskId: `one-prompt-video:${project.id}`,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amount: true,
          type: true,
          taskId: true,
          description: true,
          createdAt: true,
        },
      });
      const projectChargeTotal = -chargeTransactions.reduce(
        (total, transaction) => total + Math.min(0, transaction.amount),
        0,
      );
      const jobs = await prisma.videoProductionJob.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          stage: true,
          status: true,
          targetId: true,
          attempt: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          errorCode: true,
        },
      });
      const candidates = await prisma.videoGenerationCandidate.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          artifactId: true,
          targetId: true,
          taskId: true,
          mediaUrl: true,
          status: true,
          passed: true,
          selected: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const report = {
        passed: true,
        billable: true,
        projectId: project.id,
        userId: user.id,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationSeconds: current.durationSeconds,
        finalStatus: current.status,
        finalVideoUrl: current.finalVideoUrl,
        keyframeCount: current.keyframes.length,
        segmentCount: current.segments.length,
        allKeyframesReady: current.keyframes.every((item) => Boolean(item.imageUrl)),
        allSegmentsReady: current.segments.every((item) => Boolean(item.clipUrl)),
        balanceBefore: finishedUser.balance + projectChargeTotal,
        balanceAfter: finishedUser.balance,
        balanceDelta: projectChargeTotal,
        chargeTransactions,
        jobs,
        candidates,
      };
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    if (
      current.status === "FAILED"
      || current.status === "WAITING_RECOVERY"
      || graph.allowedActions.includes("EXECUTE_RECOVERY_ACTION")
    ) {
      throw new Error(
        `Live E2E requires recovery: ${JSON.stringify({
          projectId: project.id,
          status: current.status,
          node: graph.currentNode,
          error: current.errorMessage,
          recoveryAction: graph.recoveryAction,
        })}`,
      );
    }

    if (graph.allowedActions.includes("APPROVE_CURRENT_NODE") && graph.currentNode) {
      const node = graph.currentNode;
      if (!completedActions.has(node)) {
        if (node === "review:plan") await approveVideoPlan(user.id, project.id);
        else if (node === "review:assets") await approveAssetLibrary(user.id, project.id);
        else if (node === "review:boundaries") await approveShotImages(user.id, project.id);
        else if (node === "review:micro-shots") {
          await approveMicroShotReferences(user.id, project.id);
        } else if (node === "review:clips") {
          for (const candidate of current.generationCandidates.filter((item) =>
            item.kind === "segment_video"
            && Boolean(item.mediaUrl)
            && !item.selected
            && item.status === "review_ready"
          )) {
            await selectGenerationCandidate(user.id, project.id, candidate.id, false);
          }
          await approveVideoClips(user.id, project.id);
          await composeVideoProject(user.id, project.id);
        } else if (node === "review:final") {
          await finishVideoProject(user.id, project.id);
        } else {
          throw new Error(`Unsupported live E2E approval node: ${node}`);
        }
        completedActions.add(node);
        continue;
      }
    }
    if (
      graph.currentNode === "composition"
      && graph.allowedActions.includes("RESUME_CURRENT_NODE")
      && !completedActions.has("composition")
    ) {
      await composeVideoProject(user.id, project.id);
      completedActions.add("composition");
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Live E2E timed out after ${timeoutMs}ms.`);
}

main()
  .catch(async (error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
