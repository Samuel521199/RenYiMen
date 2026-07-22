export type Phase9ScenarioId =
  | "single_character_turn"
  | "person_single_product"
  | "two_camera_same_scene"
  | "large_state_change"
  | "thirty_second_audio_ad"
  | "front_edit_selective_rerun"
  | "resume_after_failure"
  | "historical_project_compatibility";

export interface Phase9AcceptanceEvidence {
  scenarioId: Phase9ScenarioId;
  hardAnchors?: Array<{ id: string; visible: boolean; approved: boolean; selected: boolean }>;
  generationAttempts?: Array<{
    artifactId: string;
    kind: "image" | "video";
    submitted: boolean;
    requiresCut?: boolean;
    riskLevel?: string;
    idempotencyKey?: string;
  }>;
  threeViews?: Array<{ view: "front" | "side" | "back"; beforeRevision: string; afterRevision: string; intentionallyRegenerated?: boolean }>;
  revisions?: Array<{ artifactId: string; approvedRevision: string; activeRevision: string; backgroundOverwrote?: boolean }>;
  mediaArtifacts?: Array<{
    artifactId: string;
    generated: boolean;
    referenceSelection: boolean;
    promptDebug: boolean;
    qualityReport: boolean;
    artifactMetadata: boolean;
  }>;
  dirtyRerun?: { expectedArtifactIds: string[]; actualArtifactIds: string[] };
  resume?: { runningTaskIdsBefore: string[]; submittedTaskIdsAfter: string[]; completedArtifactIdsBefore: string[]; resubmittedArtifactIdsAfter: string[] };
  camera?: { graphUsed: boolean; axisPreserved: boolean; transitionReferenceUsed: boolean };
  splitRepair?: { blockedBeforeSubmit: boolean; repairRequested: boolean };
  product?: { expectedInstances: number; observedInstances: number; appearedWithoutSource: boolean };
  audio?: { postProductionMode: boolean; narration: boolean; bgm: boolean; sfx: boolean; subtitles: boolean; randomSourceAudioStreams: number };
  history?: { opened: boolean; regenerated: boolean; approved: boolean; rolledBack: boolean; planJsonReadable: boolean };
}

export interface Phase9AcceptanceMetrics {
  hardAnchorMissRate: number;
  unapprovedHardAnchorGenerationCount: number;
  unsafeVideoSubmissionCount: number;
  threeViewOverwriteCount: number;
  approvedRevisionOverwriteCount: number;
  duplicateSubmissionCount: number;
  observableMediaCoverage: number;
  randomSourceAudioStreamCount: number;
}

export interface Phase9AcceptanceResult {
  scenarioId: Phase9ScenarioId;
  passed: boolean;
  metrics: Phase9AcceptanceMetrics;
  issues: string[];
}

export function evaluatePhase9Acceptance(evidence: Phase9AcceptanceEvidence): Phase9AcceptanceResult {
  const issues: string[] = [];
  const visibleHardAnchors = (evidence.hardAnchors ?? []).filter((anchor) => anchor.visible);
  const missedHardAnchors = visibleHardAnchors.filter((anchor) => !anchor.selected);
  const hardAnchorMissRate = visibleHardAnchors.length ? missedHardAnchors.length / visibleHardAnchors.length : 0;
  const unapprovedHardAnchorGenerationCount = (evidence.generationAttempts ?? []).filter((attempt) =>
    attempt.kind === "image" && attempt.submitted && visibleHardAnchors.some((anchor) => !anchor.approved)
  ).length;
  const unsafeVideoSubmissionCount = (evidence.generationAttempts ?? []).filter((attempt) =>
    attempt.kind === "video" && attempt.submitted && (attempt.requiresCut || attempt.riskLevel === "high")
  ).length;
  const threeViewOverwriteCount = (evidence.threeViews ?? []).filter((view) =>
    view.beforeRevision !== view.afterRevision && !view.intentionallyRegenerated
  ).length;
  const approvedRevisionOverwriteCount = (evidence.revisions ?? []).filter((revision) =>
    revision.backgroundOverwrote || revision.approvedRevision !== revision.activeRevision
  ).length;
  const submittedKeys = (evidence.generationAttempts ?? []).filter((attempt) => attempt.submitted && attempt.idempotencyKey).map((attempt) => attempt.idempotencyKey as string);
  const duplicateSubmissionCount = submittedKeys.length - new Set(submittedKeys).size;
  const generatedMedia = (evidence.mediaArtifacts ?? []).filter((artifact) => artifact.generated);
  const observableMedia = generatedMedia.filter((artifact) => artifact.referenceSelection && artifact.promptDebug && artifact.qualityReport && artifact.artifactMetadata);
  const observableMediaCoverage = generatedMedia.length ? observableMedia.length / generatedMedia.length : 1;
  const randomSourceAudioStreamCount = evidence.audio?.postProductionMode ? evidence.audio.randomSourceAudioStreams : 0;

  if (hardAnchorMissRate > 0) issues.push(`hard anchor miss rate is ${hardAnchorMissRate}`);
  if (unapprovedHardAnchorGenerationCount) issues.push(`${unapprovedHardAnchorGenerationCount} image generation(s) started before hard-anchor approval`);
  if (unsafeVideoSubmissionCount) issues.push(`${unsafeVideoSubmissionCount} unsafe video generation(s) bypassed Single-take Audit`);
  if (threeViewOverwriteCount) issues.push(`${threeViewOverwriteCount} three-view revision(s) were overwritten unexpectedly`);
  if (approvedRevisionOverwriteCount) issues.push(`${approvedRevisionOverwriteCount} approved revision(s) were replaced by background work`);
  if (duplicateSubmissionCount) issues.push(`${duplicateSubmissionCount} duplicate upstream submission(s) detected`);
  if (observableMediaCoverage !== 1) issues.push(`observable media coverage is ${observableMediaCoverage}`);
  if (randomSourceAudioStreamCount) issues.push(`${randomSourceAudioStreamCount} random source audio stream(s) survived post-production mix`);
  appendScenarioIssues(evidence, issues);

  return {
    scenarioId: evidence.scenarioId,
    passed: issues.length === 0,
    metrics: {
      hardAnchorMissRate,
      unapprovedHardAnchorGenerationCount,
      unsafeVideoSubmissionCount,
      threeViewOverwriteCount,
      approvedRevisionOverwriteCount,
      duplicateSubmissionCount,
      observableMediaCoverage,
      randomSourceAudioStreamCount,
    },
    issues,
  };
}

function appendScenarioIssues(evidence: Phase9AcceptanceEvidence, issues: string[]): void {
  if (evidence.scenarioId === "single_character_turn" && !(["front", "side", "back"] as const).every((view) => evidence.threeViews?.some((item) => item.view === view))) issues.push("front/side/back character-turn evidence is incomplete");
  if (evidence.scenarioId === "person_single_product" && evidence.product && (evidence.product.observedInstances !== evidence.product.expectedInstances || evidence.product.appearedWithoutSource)) issues.push("product instance continuity failed");
  if (evidence.scenarioId === "two_camera_same_scene" && evidence.camera && (!evidence.camera.graphUsed || !evidence.camera.axisPreserved || !evidence.camera.transitionReferenceUsed)) issues.push("camera graph, axis, or transition reference evidence is incomplete");
  if (evidence.scenarioId === "large_state_change" && evidence.splitRepair && (!evidence.splitRepair.blockedBeforeSubmit || !evidence.splitRepair.repairRequested)) issues.push("unsafe state change did not enter Split Repair before submission");
  if (evidence.scenarioId === "thirty_second_audio_ad" && evidence.audio && (!evidence.audio.narration || !evidence.audio.bgm || !evidence.audio.sfx || !evidence.audio.subtitles)) issues.push("30-second audio/subtitle deliverables are incomplete");
  if (evidence.scenarioId === "front_edit_selective_rerun" && evidence.dirtyRerun && !sameSet(evidence.dirtyRerun.expectedArtifactIds, evidence.dirtyRerun.actualArtifactIds)) issues.push("front edit reran unrelated artifacts or missed dependents");
  if (evidence.scenarioId === "resume_after_failure" && evidence.resume) {
    if (evidence.resume.submittedTaskIdsAfter.some((id) => evidence.resume?.runningTaskIdsBefore.includes(id))) issues.push("resume resubmitted a running task");
    if (evidence.resume.resubmittedArtifactIdsAfter.some((id) => evidence.resume?.completedArtifactIdsBefore.includes(id))) issues.push("resume resubmitted a completed artifact");
  }
  if (evidence.scenarioId === "historical_project_compatibility" && evidence.history && !Object.values(evidence.history).every(Boolean)) issues.push("historical project open/regenerate/approve/rollback compatibility failed");
}

function sameSet(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
}
