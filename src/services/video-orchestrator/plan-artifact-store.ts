import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type JsonRecord = Record<string, unknown>;

export function artifactTableDualWriteEnabled(): boolean {
  return process.env.ONE_PROMPT_ARTIFACT_TABLES_DUAL_WRITE?.trim().toLowerCase() === "true";
}

export function artifactTableReadEnabled(): boolean {
  return process.env.ONE_PROMPT_ARTIFACT_TABLES_READ?.trim().toLowerCase() === "true";
}

export async function mirrorPlanArtifactsToTables(projectId: string, planValue: Prisma.JsonValue | JsonRecord, options?: { force?: boolean }): Promise<void> {
  if (!options?.force && !artifactTableDualWriteEnabled()) return;
  const plan = record(planValue);
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

export async function hydratePlanArtifactsFromTables(projectId: string, planValue: Prisma.JsonValue): Promise<Prisma.JsonValue> {
  if (!artifactTableReadEnabled()) return planValue;
  const [views, selections, prompts, reports, transitions, metadata, audio] = await Promise.all([
    prisma.videoAnchorReferenceView.findMany({ where: { projectId }, orderBy: [{ artifactId: "asc" }, { revision: "desc" }] }),
    prisma.videoReferenceSelectionOutput.findMany({ where: { projectId }, orderBy: [{ targetArtifactId: "asc" }, { revision: "desc" }] }),
    prisma.videoPromptCompilation.findMany({ where: { projectId }, orderBy: [{ targetArtifactId: "asc" }, { revision: "desc" }] }),
    prisma.videoGenerationQualityReport.findMany({ where: { projectId }, orderBy: [{ assetId: "asc" }, { revision: "desc" }] }),
    prisma.videoTransitionReference.findMany({ where: { projectId }, orderBy: [{ artifactId: "asc" }, { revision: "desc" }] }),
    prisma.videoArtifactMetadata.findMany({ where: { projectId }, orderBy: [{ artifactId: "asc" }, { revision: "desc" }] }),
    prisma.videoAudioAsset.findMany({ where: { projectId, kind: "mix_config", active: true }, orderBy: { revision: "desc" }, take: 1 }),
  ]);
  const plan = { ...record(planValue) };
  if (views.length) plan.consistencyReferences = latestPayloads(views, (item) => item.artifactId);
  if (selections.length) plan.referenceSelectionOutputs = latestPayloads(selections, (item) => item.targetArtifactId);
  if (prompts.length) plan.promptDebugArtifacts = Object.fromEntries(latestRows(prompts, (item) => item.targetArtifactId).map((item) => [item.targetArtifactId, item.payload]));
  if (reports.length) plan.generationQualityReports = latestPayloads(reports, (item) => `${item.assetId}:${item.reportKey}`);
  if (transitions.length) plan.transitionReferenceArtifacts = latestPayloads(transitions, (item) => item.artifactId);
  if (metadata.length) plan.artifactMetadata = Object.fromEntries(latestRows(metadata, (item) => item.artifactId).map((item) => [item.artifactId, item.payload]));
  if (audio[0]?.payload) plan.audioBible = audio[0].payload;
  return JSON.parse(JSON.stringify(plan)) as Prisma.JsonValue;
}

export async function comparePlanJsonAndArtifactTables(projectId: string, planValue: Prisma.JsonValue): Promise<{ matched: boolean; differences: string[] }> {
  const plan = record(planValue);
  const counts = {
    anchorImages: records(plan.consistencyReferences ?? plan.consistency_references).length,
    referenceViews: records(plan.consistencyReferences ?? plan.consistency_references).length,
    selections: records(plan.referenceSelectionOutputs ?? plan.reference_selection_outputs).length,
    prompts: Object.keys(record(plan.promptDebugArtifacts ?? plan.prompt_debug_artifacts)).length,
    reports: records(plan.generationQualityReports ?? plan.generation_quality_reports).length,
    transitions: records(plan.transitionReferenceArtifacts ?? plan.transition_reference_artifacts).length,
    metadata: Object.keys(record(plan.artifactMetadata ?? plan.artifact_metadata)).length,
    audio: Object.keys(record(plan.audioBible ?? plan.audio_bible)).length ? 1 : 0,
  };
  const tableCounts = {
    anchorImages: await prisma.videoConsistencyAnchorImage.groupBy({ by: ["artifactId"], where: { projectId } }).then((items) => items.length),
    referenceViews: await prisma.videoAnchorReferenceView.groupBy({ by: ["artifactId"], where: { projectId } }).then((items) => items.length),
    selections: await prisma.videoReferenceSelectionOutput.groupBy({ by: ["targetArtifactId"], where: { projectId } }).then((items) => items.length),
    prompts: await prisma.videoPromptCompilation.groupBy({ by: ["targetArtifactId"], where: { projectId } }).then((items) => items.length),
    reports: await prisma.videoGenerationQualityReport.groupBy({ by: ["assetId", "reportKey"], where: { projectId } }).then((items) => items.length),
    transitions: await prisma.videoTransitionReference.groupBy({ by: ["artifactId"], where: { projectId } }).then((items) => items.length),
    metadata: await prisma.videoArtifactMetadata.groupBy({ by: ["artifactId"], where: { projectId } }).then((items) => items.length),
    audio: await prisma.videoAudioAsset.count({ where: { projectId, kind: "mix_config" } }).then((value) => value ? 1 : 0),
  };
  const differences = Object.entries(counts).flatMap(([key, value]) => tableCounts[key as keyof typeof tableCounts] === value ? [] : [`${key}: planJson=${value}, tables=${tableCounts[key as keyof typeof tableCounts]}`]);
  return { matched: differences.length === 0, differences };
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
