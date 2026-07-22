import { prisma } from "../src/lib/prisma";
import { comparePlanJsonAndArtifactTables, mirrorPlanArtifactsToTables } from "../src/services/video-orchestrator/plan-artifact-store";

async function main(): Promise<void> {
  let cursor: string | undefined;
  let migrated = 0;
  let mismatched = 0;
  for (;;) {
    const projects = await prisma.videoProject.findMany({
      select: { id: true, planJson: true },
      orderBy: { id: "asc" },
      take: 50,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!projects.length) break;
    for (const project of projects) {
      if (!project.planJson) continue;
      await mirrorPlanArtifactsToTables(project.id, project.planJson, { force: true });
      const comparison = await comparePlanJsonAndArtifactTables(project.id, project.planJson);
      if (!comparison.matched) {
        mismatched += 1;
        process.stderr.write(`[mismatch] ${project.id}: ${comparison.differences.join("; ")}\n`);
      }
      migrated += 1;
    }
    cursor = projects.at(-1)?.id;
  }
  process.stdout.write(`artifact table backfill complete: migrated=${migrated}, mismatched=${mismatched}\n`);
  if (mismatched) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
