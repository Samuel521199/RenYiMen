import { prisma } from "@/lib/prisma";
import {
  createVideoProject,
  deleteVideoProject,
  getVideoProject,
} from "@/services/video-orchestrator/project-service";

async function main() {
  const recent = await prisma.videoProject.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { userId: true, referenceImageUrls: true },
  });
  if (!recent) throw new Error("No existing user/project is available for the Phase 9 canary.");
  const references = Array.isArray(recent.referenceImageUrls)
    ? recent.referenceImageUrls.filter((value): value is string => typeof value === "string")
    : [];
  const createdIds: string[] = [];
  try {
    const fifteen = await createVideoProject(recent.userId, {
      userPrompt: "[P9 CANARY] 15-second no-reference architecture smoke test",
      aspectRatio: "9:16",
      durationSeconds: 15,
      stylePreset: "custom",
      referenceImageUrls: [],
    });
    createdIds.push(fifteen.id);
    const thirty = await createVideoProject(recent.userId, {
      userPrompt: "[P9 CANARY] 30-second referenced architecture smoke test",
      aspectRatio: "9:16",
      durationSeconds: 30,
      stylePreset: "custom",
      referenceImageUrls: references.slice(0, 1),
    });
    createdIds.push(thirty.id);

    const [readFifteen, readThirty] = await Promise.all([
      getVideoProject(recent.userId, fifteen.id),
      getVideoProject(recent.userId, thirty.id),
    ]);
    if (readFifteen?.durationSeconds !== 15 || readThirty?.durationSeconds !== 30) {
      throw new Error("Canary project duration did not survive the write/read projection.");
    }
    console.log(JSON.stringify({
      passed: true,
      billableProviderCalls: 0,
      projects: [
        {
          id: fifteen.id,
          durationSeconds: readFifteen.durationSeconds,
          referenceCount: 0,
        },
        {
          id: thirty.id,
          durationSeconds: readThirty.durationSeconds,
          referenceCount: references.slice(0, 1).length,
        },
      ],
    }, null, 2));
  } finally {
    await Promise.all(createdIds.map((id) =>
      deleteVideoProject(recent.userId, id).catch(() => undefined)
    ));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
