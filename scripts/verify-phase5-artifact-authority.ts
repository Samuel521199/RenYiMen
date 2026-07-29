import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Prisma, VideoProjectStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  commitArtifactPlan,
  readArtifactPlan,
} from "../src/services/video-orchestrator/plan-artifact-store";
import { getVideoProject } from "../src/services/video-orchestrator/project-service";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd(), true);

if (
  process.env.NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN?.trim().toLowerCase()
  !== "true"
) {
  throw new Error("Phase 5 verification requires the migration freeze.");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const item = value as Record<string, unknown>;
    return `{${Object.keys(item).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(item[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function main(): Promise<void> {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("No user is available for the temporary acceptance project.");
  const token = `phase5-${randomUUID()}`;
  const project = await prisma.videoProject.create({
    data: {
      userId: user.id,
      status: VideoProjectStatus.DRAFT,
      title: "Phase 5 temporary acceptance",
      userPrompt: token,
      referenceImageUrls: [],
      aspectRatio: "9:16",
      durationSeconds: 5,
      stylePreset: "test",
    },
  });

  try {
    await prisma.videoKeyframe.create({
      data: {
        projectId: project.id,
        keyframeNo: -1,
        timeSeconds: 0,
        purpose: "temporary reference",
        imagePrompt: "temporary reference",
        negativePrompt: "",
      },
    });
    const plan = {
      schemaVersion: 2,
      testToken: token,
      consistencyReferences: [{
        keyframeNo: -1,
        anchorId: "test-anchor",
        assetView: "front",
        orientation: "front",
      }],
      referenceSelectionOutputs: [{
        targetArtifactId: "target:test",
        targetType: "keyframe",
        selectedArtifactIds: ["consistency_reference:-1:image"],
        selectedReferenceUrls: ["https://example.com/reference.png"],
      }],
      promptDebugArtifacts: {
        "target:test": {
          targetArtifactId: "target:test",
          targetType: "keyframe",
          finalPrompt: "Canonical English execution prompt.",
          finalNegativePrompt: "watermark",
        },
      },
      generationQualityReports: [{
        assetId: "target:test",
        candidateId: "candidate:test",
        passed: true,
        compositeScore: 95,
      }],
      audioBible: {
        bgmUrl: "https://example.com/audio.mp3",
        mix: { bgmGain: 0.5 },
      },
      transitionReferenceArtifacts: [{
        id: "transition:test",
        fromCameraId: "camera:a",
        toCameraId: "camera:b",
        toSegmentNo: 1,
        mode: "short",
        status: "planned",
      }],
      artifactMetadata: {
        "consistency_reference:-1:image": {
          artifactType: "reference",
          producedByStage: "test",
          revision: 1,
          status: "ready",
        },
        "target:test": {
          artifactType: "target",
          producedByStage: "test",
          revision: 1,
          status: "ready",
        },
        "transition:test": {
          artifactType: "transition",
          producedByStage: "test",
          revision: 1,
          status: "ready",
        },
        audio_bible: {
          artifactType: "audio",
          producedByStage: "test",
          revision: 1,
          status: "ready",
        },
      },
    };
    await commitArtifactPlan(project.id, plan);

    const counts = {
      consistencyAnchorImages:
        await prisma.videoConsistencyAnchorImage.count({ where: { projectId: project.id } }),
      anchorReferenceViews:
        await prisma.videoAnchorReferenceView.count({ where: { projectId: project.id } }),
      referenceSelections:
        await prisma.videoReferenceSelectionOutput.count({ where: { projectId: project.id } }),
      promptCompilations:
        await prisma.videoPromptCompilation.count({ where: { projectId: project.id } }),
      qualityReports:
        await prisma.videoGenerationQualityReport.count({ where: { projectId: project.id } }),
      audioAssets:
        await prisma.videoAudioAsset.count({ where: { projectId: project.id } }),
      transitionReferences:
        await prisma.videoTransitionReference.count({ where: { projectId: project.id } }),
      artifactMetadata:
        await prisma.videoArtifactMetadata.count({ where: { projectId: project.id } }),
    };
    if (Object.values(counts).some((count) => count < 1)) {
      throw new Error(`Not every artifact table received data: ${JSON.stringify(counts)}`);
    }

    await prisma.videoProject.update({
      where: { id: project.id },
      data: {
        planJson: {
          testToken: "tampered-planJson",
          promptDebugArtifacts: {},
        } as Prisma.InputJsonValue,
      },
    });
    const beforeGet = await prisma.videoProject.findUniqueOrThrow({
      where: { id: project.id },
      select: { updatedAt: true },
    });
    const authorityAfterTamper = await readArtifactPlan(project.id);
    if (
      !authorityAfterTamper
      || (authorityAfterTamper as Record<string, unknown>).testToken !== token
    ) {
      throw new Error("Tampered planJson overrode artifact-table authority.");
    }
    const fetched = await getVideoProject(user.id, project.id);
    const afterGet = await prisma.videoProject.findUniqueOrThrow({
      where: { id: project.id },
      select: { updatedAt: true },
    });
    if (beforeGet.updatedAt.getTime() !== afterGet.updatedAt.getTime()) {
      throw new Error("GET project changed updatedAt.");
    }
    if (stableJson(fetched?.planJson) !== stableJson(authorityAfterTamper)) {
      throw new Error("GET project did not return the artifact-table snapshot.");
    }

    const report = {
      runAt: new Date().toISOString(),
      passed: true,
      temporaryProjectId: project.id,
      allArtifactTablesPopulated: true,
      planJsonTamperIgnored: true,
      getProjectReadOnly: true,
      counts,
    };
    const outputDir = path.resolve("backups/one-prompt-phase5");
    mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(
      outputDir,
      `phase5-acceptance-${report.runAt.replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`REPORT_PATH=${outputPath}\n`);
  } finally {
    await prisma.videoProject.delete({ where: { id: project.id } }).catch(() => undefined);
  }
}

main().finally(() => prisma.$disconnect());
