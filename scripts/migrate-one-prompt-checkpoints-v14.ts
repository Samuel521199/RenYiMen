import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { normalizeAliyunStoryboardPlannerCheckpoint } from "../src/services/video-orchestrator/three-stage-planner";
import {
  commitArtifactPlan,
  readArtifactPlan,
} from "../src/services/video-orchestrator/plan-artifact-store";
import type {
  PlanVideoProjectInput,
  VideoAspectRatio,
} from "../src/services/video-orchestrator/types";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env") as typeof import("@next/env");
loadEnvConfig(process.cwd(), true);

const apply = process.argv.includes("--apply");
if (
  apply
  && process.env.NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN?.trim().toLowerCase()
    !== "true"
) {
  throw new Error(
    "Refusing to migrate checkpoints while NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN is not true.",
  );
}

const prisma = new PrismaClient();
const runAt = new Date().toISOString();
const outputDir = path.resolve("backups/one-prompt-phase4");

type MigrationRow = {
  projectId: string;
  fromVersion: number;
  toVersion: number;
  preservedStages: string[];
  invalidatedStages: string[];
  reasons: string[];
  changed: boolean;
  firstDifferencePath?: string;
  applied: boolean;
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const valueRecord = record(value);
  if (valueRecord) {
    return `{${Object.keys(valueRecord).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(valueRecord[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validAspectRatio(value: string): VideoAspectRatio {
  return value === "16:9" || value === "1:1" ? value : "9:16";
}

function firstDifferencePath(
  left: unknown,
  right: unknown,
  pathPrefix = "plannerCheckpoint",
): string | undefined {
  if (stableJson(left) === stableJson(right)) return undefined;
  const leftRecord = record(left);
  const rightRecord = record(right);
  if (leftRecord && rightRecord) {
    for (const key of new Set([
      ...Object.keys(leftRecord),
      ...Object.keys(rightRecord),
    ])) {
      const difference = firstDifferencePath(
        leftRecord[key],
        rightRecord[key],
        `${pathPrefix}.${key}`,
      );
      if (difference) return difference;
    }
  }
  return pathPrefix;
}

async function main(): Promise<void> {
  const projects = await prisma.videoProject.findMany({
    select: {
      id: true,
      userPrompt: true,
      aspectRatio: true,
      durationSeconds: true,
      stylePreset: true,
      referenceImageUrls: true,
    },
    orderBy: { id: "asc" },
  });

  const rows: MigrationRow[] = [];
  for (const project of projects) {
    const authority = await readArtifactPlan(project.id, {
      allowMissing: true,
    }).catch(() => null);
    const plan = record(authority);
    const checkpoint = record(plan?.plannerCheckpoint);
    if (!plan || !checkpoint) continue;

    const previousSnapshot = record(checkpoint.inputSnapshot);
    const input: PlanVideoProjectInput = {
      userPrompt: project.userPrompt,
      aspectRatio: validAspectRatio(project.aspectRatio),
      durationSeconds: project.durationSeconds,
      shotCount: typeof previousSnapshot?.shotCount === "number"
        ? previousSnapshot.shotCount
        : undefined,
      stylePreset: project.stylePreset,
      referenceImageUrls: stringArray(project.referenceImageUrls),
    };
    const normalized = normalizeAliyunStoryboardPlannerCheckpoint(
      checkpoint,
      input,
    );
    const audit = normalized.migrationAudit;
    const nextCheckpoint = jsonSafe(normalized);
    const changed = stableJson(checkpoint) !== stableJson(nextCheckpoint);
    const differencePath = firstDifferencePath(checkpoint, nextCheckpoint);

    if (apply && changed) {
      await commitArtifactPlan(project.id, {
        ...plan,
        plannerCheckpoint: nextCheckpoint,
      });
    }

    rows.push({
      projectId: project.id,
      fromVersion: audit?.fromVersion ?? Number(checkpoint.version || 0),
      toVersion: normalized.checkpointVersion,
      preservedStages: audit?.preservedStages ?? normalized.completedStages,
      invalidatedStages: audit?.invalidatedStages ?? [],
      reasons: audit?.reasons ?? [],
      changed,
      firstDifferencePath: differencePath,
      applied: apply && changed,
    });
  }

  const report = {
    runAt,
    mode: apply ? "apply" : "dry-run",
    scannedProjects: projects.length,
    checkpointProjects: rows.length,
    changedProjects: rows.filter((row) => row.changed).length,
    appliedProjects: rows.filter((row) => row.applied).length,
    preservedStageCount: rows.reduce(
      (total, row) => total + row.preservedStages.length,
      0,
    ),
    invalidatedStageCount: rows.reduce(
      (total, row) => total + row.invalidatedStages.length,
      0,
    ),
    rows,
  };
  mkdirSync(outputDir, { recursive: true });
  const suffix = apply ? "apply" : "dry-run";
  const outputPath = path.join(
    outputDir,
    `checkpoint-v14-${suffix}-${runAt.replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, rows }, null, 2)}\n`);
  process.stdout.write(`REPORT_PATH=${outputPath}\n`);
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
