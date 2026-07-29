import { prisma } from "../src/lib/prisma";
import { buildAssetConsistencyReference } from "../src/services/video-orchestrator/project-service";
import {
  commitArtifactPlan,
  readArtifactPlan,
} from "../src/services/video-orchestrator/plan-artifact-store";
import type {
  OnePromptVideoPlan,
  VideoAssetLibraryItem,
  VideoConsistencyAnchor,
  VideoConsistencyReference,
} from "../src/services/video-orchestrator/types";
import {
  isPlayingCardAnchor as isPlayingCardAnchorCanonical,
  resolvePlayingCardAssetContract,
} from "../src/services/video-orchestrator/playing-card-contract";

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
    select: { id: true },
  });
  let updatedProjects = 0;
  let updatedAssets = 0;

  for (const project of projects) {
    const authority = await readArtifactPlan(project.id, {
      allowMissing: true,
    }).catch(() => null);
    if (!isRecord(authority)) continue;
    const plan = authority as unknown as OnePromptVideoPlan;
    const anchors = plan.consistencyManifest?.anchors ?? [];
    const references = plan.consistencyReferences ?? [];
    const items = plan.assetLibrary?.items ?? [];
    const replacements = new Map<number, VideoConsistencyReference>();
    const resolvedAnchors = new Map<string, VideoConsistencyAnchor>();

    for (const item of items) {
      const anchor = anchors.find((candidate) => candidate.id === item.anchorId);
      if (!anchor || item.category !== "prop" || !isPlayingCardAnchorCanonical(anchor)) continue;
      const resolvedAnchor = resolvePlayingCardAssetContract({ anchor }).anchor;
      resolvedAnchors.set(anchor.id, resolvedAnchor);
      const baseReference = references.find((reference) =>
        reference.anchorId === anchor.id || reference.keyframeNo === item.keyframeNo
      );
      replacements.set(item.keyframeNo, buildAssetConsistencyReference({
        item: item as VideoAssetLibraryItem,
        anchor: resolvedAnchor,
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
      consistencyManifest: plan.consistencyManifest
        ? {
            ...plan.consistencyManifest,
            anchors: anchors.map((anchor) => resolvedAnchors.get(anchor.id) ?? anchor),
          }
        : plan.consistencyManifest,
      planningManifest: plan.planningManifest
        ? {
            ...plan.planningManifest,
            consistencyManifest: {
              ...plan.planningManifest.consistencyManifest,
              anchors: plan.planningManifest.consistencyManifest.anchors.map(
                (anchor) => resolvedAnchors.get(anchor.id) ?? anchor,
              ),
            },
          }
        : plan.planningManifest,
      consistencyReferences: nextReferences,
    };

    await prisma.$transaction([
      ...[...replacements.values()].map((reference) =>
        prisma.videoKeyframe.updateMany({
          where: { projectId: project.id, keyframeNo: reference.keyframeNo },
          data: {
            imagePrompt: reference.imagePromptEn ?? reference.imagePrompt,
            negativePrompt: reference.negativePromptEn ?? reference.negativePrompt,
          },
        })
      ),
    ]);
    await commitArtifactPlan(project.id, nextPlan);
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
