import type { ReferenceSelectionCandidate, VideoAssetView } from "./types";
import { ONE_PROMPT_MAX_REFERENCE_IMAGES } from "@/lib/one-prompt-video-limits";

export type ReferenceOrientation = "front" | "side" | "back" | "unknown";

export type SelectableReferenceCandidate = Omit<ReferenceSelectionCandidate, "selected" | "finalScore" | "rejectionReason"> & {
  selected?: boolean;
  finalScore?: number;
  rejectionReason?: string;
};

export interface ReferenceSelectionDecision {
  candidates: ReferenceSelectionCandidate[];
  selected: ReferenceSelectionCandidate[];
  targetOrientation: ReferenceOrientation;
  selectedView?: VideoAssetView;
  orientationFallbackReason?: string;
  warnings: string[];
}

export const REFERENCE_SELECTION_POLICY_VERSION = "ref-selector-v2";
export const REFERENCE_CONFLICT_THRESHOLD = 0.75;

export function referenceFinalScore(candidate: Pick<ReferenceSelectionCandidate, "relevanceScore" | "viewMatchScore" | "recencyScore" | "conflictScore">): number {
  return candidate.relevanceScore * 0.45 +
    candidate.viewMatchScore * 0.25 +
    candidate.recencyScore * 0.2 -
    candidate.conflictScore * 0.35;
}

export function referenceRecencyScore(distance: number, maxDistance = 4): number {
  if (!Number.isFinite(distance)) return 0;
  return clamp01(1 - Math.max(0, distance) / Math.max(1, maxDistance));
}

export function detectReferenceOrientation(...values: Array<string | undefined>): ReferenceOrientation {
  const value = values.filter(Boolean).join(" ").toLowerCase();
  if (!value.trim()) return "unknown";
  if (/背面|背对|背向|后背|rear view|back view|back-facing|facing away|from behind/.test(value)) return "back";
  if (/侧面|侧身|侧脸|侧向|左侧|右侧|profile|side view|side-facing|from the side/.test(value)) return "side";
  if (/正面|面向镜头|面对镜头|正脸|frontal|front view|facing (?:the )?camera|three-quarter front|three quarter front/.test(value)) return "front";
  return "unknown";
}

export function referenceViewMatchScore(target: ReferenceOrientation, view?: VideoAssetView): number {
  if (!view) return target === "unknown" ? 0.4 : 0.25;
  if (target === "unknown") return view === "front" ? 0.7 : view === "side" || view === "back" ? 0.5 : 0.35;
  if (view === target) return 1;
  if (view === "front") return 0.55;
  if (view === "side" && target === "back") return 0.35;
  if (view === "back" && target === "side") return 0.25;
  return 0.2;
}

export function selectReferenceCandidates(params: {
  candidates: SelectableReferenceCandidate[];
  targetOrientation: ReferenceOrientation;
  maxReferenceCount?: number;
  conflictThreshold?: number;
}): ReferenceSelectionDecision {
  const maxReferenceCount = Math.max(
    1,
    Math.min(ONE_PROMPT_MAX_REFERENCE_IMAGES, params.maxReferenceCount ?? ONE_PROMPT_MAX_REFERENCE_IMAGES),
  );
  const conflictThreshold = clamp01(params.conflictThreshold ?? REFERENCE_CONFLICT_THRESHOLD);
  const scored = params.candidates
    .map((candidate) => ({ ...candidate, finalScore: referenceFinalScore(candidate) }))
    .sort((a, b) => b.finalScore - a.finalScore);
  const selectedIds = new Set<string>();
  const quotaUsed = new Set<NonNullable<ReferenceSelectionCandidate["quotaType"]>>();
  const warnings: string[] = [];

  const viableHardCandidates = scored
    .filter((candidate) => candidate.hardRequired && (isMandatoryTransitionCandidate(candidate) || candidate.conflictScore < conflictThreshold))
    .sort((a, b) => Number(isMandatoryTransitionCandidate(b)) - Number(isMandatoryTransitionCandidate(a)));
  const hardGroups = new Map<string, typeof scored>();
  for (const candidate of viableHardCandidates) {
    const key = `${candidate.quotaType ?? "custom"}:${candidate.anchorId ?? candidate.artifactId}`;
    hardGroups.set(key, [...(hardGroups.get(key) ?? []), candidate]);
  }
  for (const [group, candidates] of hardGroups) {
    if (selectedIds.size >= maxReferenceCount) {
      warnings.push(`required hard reference ${group} exceeds max reference count ${maxReferenceCount}`);
      continue;
    }
    const candidate = candidates[0];
    if (!candidate) continue;
    if (candidate.quotaType && quotaUsed.has(candidate.quotaType)) {
      warnings.push(`required hard reference ${group} conflicts with quota ${candidate.quotaType}`);
      continue;
    }
    selectedIds.add(candidate.artifactId);
    if (candidate.quotaType) quotaUsed.add(candidate.quotaType);
  }

  for (const candidate of scored) {
    if (selectedIds.size >= maxReferenceCount) break;
    if (selectedIds.has(candidate.artifactId)) continue;
    if (candidate.conflictScore >= conflictThreshold) continue;
    if (candidate.quotaType && quotaUsed.has(candidate.quotaType)) continue;
    selectedIds.add(candidate.artifactId);
    if (candidate.quotaType) quotaUsed.add(candidate.quotaType);
  }

  // Quotas guarantee category coverage; they are not a global one-per-category
  // ceiling. Once every useful category has a representative, use remaining
  // model capacity for the next strongest non-conflicting references.
  for (const candidate of scored) {
    if (selectedIds.size >= maxReferenceCount) break;
    if (selectedIds.has(candidate.artifactId)) continue;
    if (candidate.hardRequired) continue;
    if (candidate.conflictScore >= conflictThreshold && !isMandatoryTransitionCandidate(candidate)) continue;
    selectedIds.add(candidate.artifactId);
  }

  const selectedCharacter = scored.find((candidate) => selectedIds.has(candidate.artifactId) && candidate.quotaType === "character");
  let orientationFallbackReason: string | undefined;
  if (selectedCharacter?.assetView && params.targetOrientation !== "unknown" && selectedCharacter.assetView !== params.targetOrientation) {
    orientationFallbackReason = `requested_${params.targetOrientation}_view_unavailable_or_conflicted; fallback_to_${selectedCharacter.assetView}`;
    warnings.push(orientationFallbackReason);
  } else if (selectedCharacter?.assetView && params.targetOrientation === "unknown" && selectedCharacter.assetView === "front") {
    orientationFallbackReason = "target_orientation_unknown; fallback_to_front";
    warnings.push(orientationFallbackReason);
  }

  const outputCandidates: ReferenceSelectionCandidate[] = scored.map((candidate) => {
    const selected = selectedIds.has(candidate.artifactId);
    let rejectionReason: string | undefined;
    if (!selected) {
      if (candidate.conflictScore >= conflictThreshold && !isMandatoryTransitionCandidate(candidate)) {
        rejectionReason = candidate.conflictReasons?.length
          ? `conflict_threshold_exceeded:${candidate.conflictReasons.join("|")}`
          : "conflict_threshold_exceeded";
      } else if (candidate.hardRequired) {
        rejectionReason = `hard_anchor_alternate_view_not_selected:${selectedCharacter?.assetView ?? "none"}`;
      } else if (candidate.quotaType && quotaUsed.has(candidate.quotaType)) {
        rejectionReason = `quota_${candidate.quotaType}_already_selected`;
      } else if (selectedIds.size >= maxReferenceCount) {
        rejectionReason = "max_reference_count_reached";
      } else {
        rejectionReason = "lower_score";
      }
    }
    return {
      ...candidate,
      finalScore: roundScore(candidate.finalScore),
      relevanceScore: roundScore(candidate.relevanceScore),
      conflictScore: roundScore(candidate.conflictScore),
      recencyScore: roundScore(candidate.recencyScore),
      viewMatchScore: roundScore(candidate.viewMatchScore),
      selected,
      rejectionReason,
    };
  });
  return {
    candidates: outputCandidates,
    selected: outputCandidates.filter((candidate) => candidate.selected),
    targetOrientation: params.targetOrientation,
    selectedView: selectedCharacter?.assetView,
    orientationFallbackReason,
    warnings,
  };
}

function isMandatoryTransitionCandidate(candidate: Pick<SelectableReferenceCandidate, "sourceType" | "hardRequired">): boolean {
  return candidate.sourceType === "transition_reference" && candidate.hardRequired === true;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
