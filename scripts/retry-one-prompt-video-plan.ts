import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const [userId, projectId] = process.argv.slice(2);
  if (!userId || !projectId) {
    throw new Error("Usage: tsx scripts/retry-one-prompt-video-plan.ts <userId> <projectId>");
  }

  const [{ planVideoProject }, { prisma }] = await Promise.all([
    import("../src/services/video-orchestrator/project-service"),
    import("../src/lib/prisma"),
  ]);

  try {
    const project = await planVideoProject(userId, projectId);
    console.log(JSON.stringify({
      projectId: project.id,
      status: project.status,
      errorMessage: project.errorMessage,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
