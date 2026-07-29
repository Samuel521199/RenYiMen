import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCanonicalPlanContract } from "./canonical-plan-contract";

type JsonRecord = Record<string, unknown>;
export const ARTIFACT_MIGRATION_MARKER = "__migration__:artifact_tables_v2";
export const ARTIFACT_EXECUTION_SNAPSHOT = "__snapshot__:execution_plan_v1";

async function writeArtifactPlanTables(projectId: string, planValue: unknown): Promise<void> {
  const plan = assertCanonicalPlanContract(planValue);
  const keyframes = await prisma.videoKeyframe.findMany({ where: { projectId }, select: { keyframeNo: true, imageUrl: true, status: true, locked: true } });
  const keyframeByNo = new Map(keyframes.map((item) => [item.keyframeNo, item]));
  const metadata = record(plan.artifactMetadata ?? plan.artifact_metadata);
  const references = records(plan.consistencyReferences ?? plan.consistency_references);
  const selections = records(plan.referenceSelectionOutputs ?? plan.reference_selection_outputs);
  const prompts = record(plan.promptDebugArtifacts ?? plan.prompt_debug_artifacts);
  const qualityReports = records(plan.generationQualityReports ?? plan.generation_quality_reports);
  const transitions = records(plan.transitionReferenceArtifacts ?? plan.transition_reference_artifacts);
  const audioBible = record(plan.audioBible ?? plan.audio_bible);

  await prisma.$transaction(async (tx) => {
    for (const reference of references) {
      const keyframeNo = integer(reference.keyframeNo ?? reference.keyframe_no);
      if (keyframeNo == null) continue;
      const artifactId = `consistency_reference:${keyframeNo}:image`;
      const meta = record(metadata[artifactId]);
      const revision = positiveInteger(meta.revision) ?? 1;
      const anchorId = text(reference.anchorId ?? reference.anchor_id ?? reference.assetId ?? reference.asset_id) || artifactId;
      const view = text(reference.assetView ?? reference.asset_view ?? reference.orientation) || "single";
      const frame = keyframeByNo.get(keyframeNo);
      const approved = Boolean(frame?.locked || frame?.status === "IMAGE_APPROVED" || meta.status === "approved");
      const payload = json(reference);
      await tx.videoConsistencyAnchorImage.upsert({
        where: { projectId_artifactId_revision: { projectId, artifactId, revision } },
        create: { projectId, artifactId, anchorId, revision, imageUrl: frame?.imageUrl, status: text(meta.status) || text(frame?.status) || "draft", approved, userAccepted: meta.userAccepted === true, payload },
        update: { anchorId, imageUrl: frame?.imageUrl, status: text(meta.status) || text(frame?.status) || "draft", approved, userAccepted: meta.userAccepted === true, payload },
      });
      await tx.videoAnchorReferenceView.upsert({
        where: { projectId_artifactId_revision: { projectId, artifactId, revision } },
        create: { projectId, artifactId, anchorId, view, orientation: text(reference.orientation) || view, revision, sourceArtifactId: optionalText(reference.sourceArtifactId ?? reference.source_artifact_id), sourceRevisionId: parentRevision(meta), imageUrl: frame?.imageUrl, status: text(meta.status) || "draft", approved, payload },
        update: { anchorId, view, orientation: text(reference.orientation) || view, sourceArtifactId: optionalText(reference.sourceArtifactId ?? reference.source_artifact_id), sourceRevisionId: parentRevision(meta), imageUrl: frame?.imageUrl, status: text(meta.status) || "draft", approved, payload },
      });
    }

    for (const output of selections) {
      const targetArtifactId = text(output.targetArtifactId ?? output.target_artifact_id);
      if (!targetArtifactId) continue;
      const revision = artifactRevision(metadata, `${targetArtifactId}:reference_selection`);
      await tx.videoReferenceSelectionOutput.upsert({
        where: { projectId_targetArtifactId_revision: { projectId, targetArtifactId, revision } },
        create: { projectId, targetArtifactId, targetType: text(output.targetType ?? output.target_type), revision, selectedArtifactIds: jsonArray(output.selectedArtifactIds ?? output.selected_artifact_ids), selectedReferenceUrls: jsonArray(output.selectedReferenceUrls ?? output.selected_reference_urls), payload: json(output) },
        update: { targetType: text(output.targetType ?? output.target_type), selectedArtifactIds: jsonArray(output.selectedArtifactIds ?? output.selected_artifact_ids), selectedReferenceUrls: jsonArray(output.selectedReferenceUrls ?? output.selected_reference_urls), payload: json(output) },
      });
    }

    for (const [targetArtifactId, value] of Object.entries(prompts)) {
      const prompt = record(value);
      const revision = artifactRevision(metadata, `${targetArtifactId}:prompt`);
      await tx.videoPromptCompilation.upsert({
        where: { projectId_targetArtifactId_revision: { projectId, targetArtifactId, revision } },
        create: { projectId, targetArtifactId, targetType: text(prompt.targetType ?? prompt.target_type), revision, finalPrompt: text(prompt.finalPrompt ?? prompt.final_prompt), negativePrompt: text(prompt.finalNegativePrompt ?? prompt.final_negative_prompt), payload: json(prompt) },
        update: { targetType: text(prompt.targetType ?? prompt.target_type), finalPrompt: text(prompt.finalPrompt ?? prompt.final_prompt), negativePrompt: text(prompt.finalNegativePrompt ?? prompt.final_negative_prompt), payload: json(prompt) },
      });
    }

    for (const report of qualityReports) {
      const assetId = text(report.assetId ?? report.asset_id);
      if (!assetId) continue;
      const reportKey = optionalText(report.candidateId ?? report.candidate_id) ?? "active";
      const revision = artifactRevision(metadata, assetId);
      await tx.videoGenerationQualityReport.upsert({
        where: { projectId_assetId_reportKey_revision: { projectId, assetId, reportKey, revision } },
        create: { projectId, assetId, reportKey, candidateId: optionalText(report.candidateId ?? report.candidate_id), revision, passed: report.passed === true, userAccepted: report.userAccepted === true, compositeScore: optionalNumber(report.compositeScore ?? report.composite_score), retryInstruction: optionalText(report.retryInstruction ?? report.retry_instruction), payload: json(report) },
        update: { candidateId: optionalText(report.candidateId ?? report.candidate_id), passed: report.passed === true, userAccepted: report.userAccepted === true, compositeScore: optionalNumber(report.compositeScore ?? report.composite_score), retryInstruction: optionalText(report.retryInstruction ?? report.retry_instruction), payload: json(report) },
      });
    }

    if (Object.keys(audioBible).length) {
      const audioKinds = [
        ["bgm", audioBible.bgmUrl ?? audioBible.bgm_url],
        ["tts", audioBible.ttsUrl ?? audioBible.tts_url],
        ["sfx", audioBible.sfxUrl ?? audioBible.sfx_url],
        ["mix_config", undefined],
      ] as const;
      for (const [kind, urlValue] of audioKinds) {
        if (kind !== "mix_config" && !optionalText(urlValue)) continue;
        const artifactId = kind === "mix_config" ? "audio_bible" : `audio:${kind}`;
        const revision = artifactRevision(metadata, artifactId);
        await tx.videoAudioAsset.upsert({
          where: { projectId_artifactId_revision: { projectId, artifactId, revision } },
          create: { projectId, artifactId, kind, revision, url: optionalText(urlValue), status: text(record(metadata[artifactId]).status) || "ready", approved: record(metadata[artifactId]).status === "approved", active: true, payload: json(audioBible) },
          update: { url: optionalText(urlValue), status: text(record(metadata[artifactId]).status) || "ready", approved: record(metadata[artifactId]).status === "approved", active: true, payload: json(audioBible) },
        });
      }
    }

    for (const transition of transitions) {
      const artifactId = text(transition.id ?? transition.artifactId ?? transition.artifact_id);
      if (!artifactId) continue;
      const revision = artifactRevision(metadata, artifactId);
      await tx.videoTransitionReference.upsert({
        where: { projectId_artifactId_revision: { projectId, artifactId, revision } },
        create: { projectId, artifactId, revision, fromCameraId: optionalText(transition.fromCameraId ?? transition.from_camera_id), toCameraId: text(transition.toCameraId ?? transition.to_camera_id), toSegmentNo: integer(transition.toSegmentNo ?? transition.to_segment_no), mode: text(transition.mode) || "short", status: text(transition.status) || "planned", videoUrl: optionalText(transition.videoUrl ?? transition.video_url), selectedFrameUrl: optionalText(transition.selectedFrameUrl ?? transition.selected_frame_url), locked: transition.locked === true, payload: json(transition) },
        update: { fromCameraId: optionalText(transition.fromCameraId ?? transition.from_camera_id), toCameraId: text(transition.toCameraId ?? transition.to_camera_id), toSegmentNo: integer(transition.toSegmentNo ?? transition.to_segment_no), mode: text(transition.mode) || "short", status: text(transition.status) || "planned", videoUrl: optionalText(transition.videoUrl ?? transition.video_url), selectedFrameUrl: optionalText(transition.selectedFrameUrl ?? transition.selected_frame_url), locked: transition.locked === true, payload: json(transition) },
      });
    }

    for (const [artifactId, value] of Object.entries(metadata)) {
      const item = record(value);
      const revision = positiveInteger(item.revision) ?? 1;
      await tx.videoArtifactMetadata.upsert({
        where: { projectId_artifactId_revision: { projectId, artifactId, revision } },
        create: { projectId, artifactId, artifactType: text(item.artifactType ?? item.artifact_type), producedByStage: text(item.producedByStage ?? item.produced_by_stage), revision, status: text(item.status) || "draft", retryFromStage: optionalText(item.retryFromStage ?? item.retry_from_stage), userAccepted: item.userAccepted === true || item.user_accepted === true, invalidatedByArtifactIds: jsonArray(item.invalidatedByArtifactIds ?? item.invalidated_by_artifact_ids), parentRevisionIds: jsonArray(item.parentRevisionIds ?? item.parent_revision_ids), payload: json(item) },
        update: { artifactType: text(item.artifactType ?? item.artifact_type), producedByStage: text(item.producedByStage ?? item.produced_by_stage), status: text(item.status) || "draft", retryFromStage: optionalText(item.retryFromStage ?? item.retry_from_stage), userAccepted: item.userAccepted === true || item.user_accepted === true, invalidatedByArtifactIds: jsonArray(item.invalidatedByArtifactIds ?? item.invalidated_by_artifact_ids), parentRevisionIds: jsonArray(item.parentRevisionIds ?? item.parent_revision_ids), payload: json(item) },
      });
    }
  });
}

export class ArtifactAuthorityError extends Error {
  constructor(
    public readonly errorCode:
      | "ARTIFACT_AUTHORITY_NOT_READY"
      | "ARTIFACT_MIGRATION_QUARANTINED",
    public readonly recoveryAction:
      | "MIGRATE_ARTIFACT_TABLES"
      | "REPAIR_PLAN_FIELDS",
    message: string,
  ) {
    super(message);
    this.name = "ArtifactAuthorityError";
  }
}

export async function commitArtifactPlan(
  projectId: string,
  planValue: unknown,
): Promise<Prisma.JsonValue> {
  const plan = assertCanonicalPlanContract(planValue);
  await writeArtifactPlanTables(projectId, plan);
  const snapshot = await writeExecutionSnapshot(projectId, plan, "runtime");
  await prisma.videoProject.update({
    where: { id: projectId },
    data: { planJson: snapshot as Prisma.InputJsonValue },
  });
  return snapshot;
}

export async function readArtifactPlan(
  projectId: string,
  options?: { allowMissing?: boolean },
): Promise<Prisma.JsonValue | null> {
  const marker = await prisma.videoArtifactMetadata.findUnique({
    where: {
      projectId_artifactId_revision: {
        projectId,
        artifactId: ARTIFACT_MIGRATION_MARKER,
        revision: 1,
      },
    },
  });
  if (marker?.status === "quarantined") {
    throw new ArtifactAuthorityError(
      "ARTIFACT_MIGRATION_QUARANTINED",
      "REPAIR_PLAN_FIELDS",
      `Project ${projectId} is quarantined because its artifact migration is incomplete.`,
    );
  }
  const snapshot = await prisma.videoArtifactMetadata.findUnique({
    where: {
      projectId_artifactId_revision: {
        projectId,
        artifactId: ARTIFACT_EXECUTION_SNAPSHOT,
        revision: 1,
      },
    },
  });
  if (!snapshot || marker?.status !== "completed") {
    if (options?.allowMissing) return null;
    throw new ArtifactAuthorityError(
      "ARTIFACT_AUTHORITY_NOT_READY",
      "MIGRATE_ARTIFACT_TABLES",
      `Project ${projectId} has no completed artifact-table authority marker.`,
    );
  }
  const payload = record(snapshot.payload);
  const plan = record(payload.plan);
  const expectedHash = text(payload.contentHash);
  const actualHash = artifactContentHash(plan);
  if (!expectedHash || expectedHash !== actualHash) {
    throw new ArtifactAuthorityError(
      "ARTIFACT_MIGRATION_QUARANTINED",
      "REPAIR_PLAN_FIELDS",
      `Project ${projectId} has an invalid artifact execution snapshot hash.`,
    );
  }
  const expectedCounts = record(record(marker.payload).tableCounts);
  const actualCounts = await artifactTableCounts(projectId);
  if (
    !Object.keys(expectedCounts).length
    || stableJson(expectedCounts) !== stableJson(actualCounts)
  ) {
    throw new ArtifactAuthorityError(
      "ARTIFACT_MIGRATION_QUARANTINED",
      "REPAIR_PLAN_FIELDS",
      `Project ${projectId} has incomplete artifact tables; expected=${stableJson(expectedCounts)}, actual=${stableJson(actualCounts)}.`,
    );
  }
  return json(plan) as Prisma.JsonValue;
}

async function writeExecutionSnapshot(
  projectId: string,
  planValue: unknown,
  source: "runtime" | "planJson_migration",
): Promise<Prisma.JsonValue> {
  const plan = json(assertCanonicalPlanContract(planValue));
  const contentHash = artifactContentHash(plan);
  const tableCounts = await artifactTableCounts(projectId);
  const snapshotPayload = json({
    schemaVersion: 1,
    contentHash,
    source,
    plan,
    tableCounts,
    writtenAt: new Date().toISOString(),
  });
  await prisma.$transaction([
    prisma.videoArtifactMetadata.upsert({
      where: {
        projectId_artifactId_revision: {
          projectId,
          artifactId: ARTIFACT_EXECUTION_SNAPSHOT,
          revision: 1,
        },
      },
      create: {
        projectId,
        artifactId: ARTIFACT_EXECUTION_SNAPSHOT,
        artifactType: "execution_plan_snapshot",
        producedByStage: "artifact_authority",
        revision: 1,
        status: "completed",
        payload: snapshotPayload,
      },
      update: { status: "completed", payload: snapshotPayload },
    }),
    prisma.videoArtifactMetadata.upsert({
      where: {
        projectId_artifactId_revision: {
          projectId,
          artifactId: ARTIFACT_MIGRATION_MARKER,
          revision: 1,
        },
      },
      create: {
        projectId,
        artifactId: ARTIFACT_MIGRATION_MARKER,
        artifactType: "migration_marker",
        producedByStage: "artifact_authority",
        revision: 1,
        status: "completed",
        payload: json({
          source,
          sourceHash: contentHash,
          authorityHash: contentHash,
          tableCounts,
          authority: "artifact_tables",
          completedAt: new Date().toISOString(),
        }),
      },
      update: {
        status: "completed",
        payload: json({
          source,
          sourceHash: contentHash,
          authorityHash: contentHash,
          tableCounts,
          authority: "artifact_tables",
          completedAt: new Date().toISOString(),
        }),
      },
    }),
  ]);
  return json(plan) as Prisma.JsonValue;
}

function latestPayloads<T extends { payload: unknown }>(rows: T[], key: (row: T) => string): Prisma.JsonValue[] {
  return latestRows(rows, key).map((row) => row.payload as Prisma.JsonValue);
}
function latestRows<T>(rows: T[], key: (row: T) => string): T[] { const seen = new Set<string>(); return rows.filter((row) => !seen.has(key(row)) && Boolean(seen.add(key(row)))); }
function artifactRevision(metadata: JsonRecord, artifactId: string): number { return positiveInteger(record(metadata[artifactId]).revision) ?? 1; }
function parentRevision(value: JsonRecord): string | undefined { return strings(value.parentRevisionIds ?? value.parent_revision_ids)[0]; }
function record(value: unknown): JsonRecord { return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function records(value: unknown): JsonRecord[] { return Array.isArray(value) ? value.filter((item): item is JsonRecord => item != null && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function optionalText(value: unknown): string | undefined { return text(value) || undefined; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function integer(value: unknown): number | undefined { const number = Number(value); return Number.isInteger(number) ? number : undefined; }
function positiveInteger(value: unknown): number | undefined { const number = integer(value); return number != null && number > 0 ? number : undefined; }
function optionalNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue; }
function jsonArray(value: unknown): Prisma.InputJsonValue { return json(Array.isArray(value) ? value : []); }
function artifactContentHash(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
async function artifactTableCounts(projectId: string): Promise<JsonRecord> {
  const [
    consistencyAnchorImages,
    anchorReferenceViews,
    referenceSelections,
    promptCompilations,
    qualityReports,
    audioAssets,
    transitionReferences,
    artifactMetadata,
  ] = await Promise.all([
    prisma.videoConsistencyAnchorImage.count({ where: { projectId } }),
    prisma.videoAnchorReferenceView.count({ where: { projectId } }),
    prisma.videoReferenceSelectionOutput.count({ where: { projectId } }),
    prisma.videoPromptCompilation.count({ where: { projectId } }),
    prisma.videoGenerationQualityReport.count({ where: { projectId } }),
    prisma.videoAudioAsset.count({ where: { projectId } }),
    prisma.videoTransitionReference.count({ where: { projectId } }),
    prisma.videoArtifactMetadata.count({
      where: {
        projectId,
        artifactId: {
          notIn: [ARTIFACT_MIGRATION_MARKER, ARTIFACT_EXECUTION_SNAPSHOT],
        },
      },
    }),
  ]);
  return {
    consistencyAnchorImages,
    anchorReferenceViews,
    referenceSelections,
    promptCompilations,
    qualityReports,
    audioAssets,
    transitionReferences,
    artifactMetadata,
  };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value != null && typeof value === "object") {
    const valueRecord = value as JsonRecord;
    return `{${Object.keys(valueRecord).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(valueRecord[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}
