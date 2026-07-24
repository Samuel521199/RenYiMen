import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { buildAssetConsistencyReference } from "../src/services/video-orchestrator/project-service";
import type {
  OnePromptVideoPlan,
  VideoAssetLibraryItem,
  VideoConsistencyAnchor,
  VideoConsistencyReference,
} from "../src/services/video-orchestrator/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlayingCardAnchor(anchor: VideoConsistencyAnchor): boolean {
  const text = [
    anchor.id,
    anchor.displayNameZh,
    anchor.displayNameEn,
    anchor.descriptionZh,
    anchor.descriptionEn,
  ].filter(Boolean).join(" ").toLowerCase();
  return /扑克牌|纸牌|playing[\s_-]*cards?|poker[\s_-]*cards?|game[\s_-]*cards?/.test(text);
}

async function main(): Promise<void> {
  const projects = await prisma.videoProject.findMany({
    where: { planJson: { not: Prisma.JsonNull } },
    select: { id: true, planJson: true },
  });
  let updatedProjects = 0;
  let updatedAssets = 0;

  for (const project of projects) {
    if (!isRecord(project.planJson)) continue;
    const plan = project.planJson as unknown as OnePromptVideoPlan;
    const anchors = plan.consistencyManifest?.anchors ?? [];
    const references = plan.consistencyReferences ?? [];
    const items = plan.assetLibrary?.items ?? [];
    const replacements = new Map<number, VideoConsistencyReference>();

    for (const item of items) {
      const anchor = anchors.find((candidate) => candidate.id === item.anchorId);
      if (!anchor || item.category !== "prop" || !isPlayingCardAnchor(anchor)) continue;
      const baseReference = references.find((reference) =>
        reference.anchorId === anchor.id || reference.keyframeNo === item.keyframeNo
      );
      replacements.set(item.keyframeNo, buildAssetConsistencyReference({
        item: item as VideoAssetLibraryItem,
        anchor,
        baseReference,
        userPrompt: "",
        negativePrompt: baseReference?.negativePrompt ?? "",
        negativePromptZh: baseReference?.negativePromptZh,
        negativePromptEn: baseReference?.negativePromptEn,
      }));
    }

    if (!replacements.size) continue;
    const nextReferences = references.map((reference) =>
      replacements.get(reference.keyframeNo) ?? reference
    );
    const nextPlan = {
      ...plan,
      consistencyReferences: nextReferences,
    };

    await prisma.$transaction([
      prisma.videoProject.update({
        where: { id: project.id },
        data: { planJson: nextPlan as unknown as Prisma.InputJsonValue },
      }),
      ...[...replacements.values()].map((reference) =>
        prisma.videoKeyframe.updateMany({
          where: { projectId: project.id, keyframeNo: reference.keyframeNo },
          data: {
            imagePrompt: reference.imagePromptZh ?? reference.imagePrompt,
            negativePrompt: reference.negativePromptZh ?? reference.negativePrompt,
          },
        })
      ),
    ]);
    updatedProjects += 1;
    updatedAssets += replacements.size;
  }

  console.log(JSON.stringify({ updatedProjects, updatedAssets }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
