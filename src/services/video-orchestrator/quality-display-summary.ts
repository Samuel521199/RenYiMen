import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type {
  AtomicVisualRequirement,
  GenerationIssueLedgerEntry,
  GenerationQualityReport,
  QualityDisplayItemStatus,
  QualityDisplayLanguage,
  QualityDisplaySummary,
  QualityDisplaySummaryItem,
  QualityGateStatus,
  VisualEvidenceObservation,
} from "./types";

const SUMMARY_VERSION = "quality-summary-v3" as const;
const MAX_SUMMARY_ITEMS = 12;
const HARD_EVIDENCE_CONFIDENCE = 0.8;

type CurrentDisplayStatus = Exclude<QualityDisplayItemStatus, "open" | "resolved" | "deferred">;

export async function getOrCreateCandidateQualityDisplaySummary(params: {
  userId: string;
  projectId: string;
  candidateId: string;
  lang: QualityDisplayLanguage;
}): Promise<QualityDisplaySummary> {
  const candidate = await prisma.videoGenerationCandidate.findFirst({
    where: {
      id: params.candidateId,
      projectId: params.projectId,
      project: { userId: params.userId },
    },
    select: { id: true, qualityReport: true },
  });
  if (!candidate) throw new Error(params.lang === "zh" ? "候选版本不存在或无权访问" : "Candidate not found or access denied");
  if (!candidate.qualityReport || !isRecord(candidate.qualityReport)) {
    throw new Error(params.lang === "zh" ? "该候选尚无质检报告" : "This candidate has no quality report yet");
  }

  const report = candidate.qualityReport as unknown as GenerationQualityReport;
  const sourceHash = qualitySummarySourceHash(report);
  const cached = report.displaySummaries?.[params.lang];
  if (cached?.version === SUMMARY_VERSION && cached.sourceHash === sourceHash && cached.items.length) return cached;

  // Severity is policy, not copywriting. Build the summary deterministically so
  // an optional language model can never promote advice into a blocking defect.
  const summary = fallbackQualityDisplaySummary(report, params.lang, sourceHash);
  const nextReport: GenerationQualityReport = {
    ...report,
    displaySummaries: {
      ...(report.displaySummaries ?? {}),
      [params.lang]: summary,
    },
  };
  await prisma.videoGenerationCandidate.update({
    where: { id: candidate.id },
    data: { qualityReport: nextReport as unknown as Prisma.InputJsonValue },
  });
  return summary;
}

export function qualitySummarySourceHash(report: GenerationQualityReport): string {
  return createHash("sha1").update(JSON.stringify({
    evaluationStatus: report.evaluationStatus,
    qualityDecision: report.qualityDecision,
    passed: report.passed,
    atomicRequirements: report.atomicRequirements ?? [],
    evidenceObservations: report.evidenceObservations ?? [],
    issueLedger: report.issueLedger ?? [],
    hardFailureReasons: report.hardFailureReasons ?? [],
    softSuggestions: report.softSuggestions ?? [],
    correctionActions: report.correctionActions ?? [],
    artifactIssues: report.artifactIssues ?? [],
  })).digest("hex").slice(0, 16);
}

export function fallbackQualityDisplaySummary(
  report: GenerationQualityReport,
  lang: QualityDisplayLanguage,
  sourceHash = qualitySummarySourceHash(report),
): QualityDisplaySummary {
  const special = specialEvaluationItem(report, lang);
  let items = special ? [special] : evidenceItems(report, lang);

  if (!special) {
    items.push(...unrepresentedHardFailureItems(report, items, lang));
    items.push(...unrepresentedSoftSuggestionItems(report, items, lang));
    if (!items.length) items = legacyLedgerItems(report.issueLedger ?? [], lang);
    if (!items.length && report.artifactIssues.length) {
      const status: CurrentDisplayStatus = report.passed ? "improvement" : "pending_review";
      items = report.artifactIssues.map((text) => ({ status, text: compactText(text, lang === "zh" ? 42 : 140) }));
    }
  }

  if (!items.length) {
    items.push({
      status: report.passed ? "satisfied" : "pending_review",
      text: lang === "zh"
        ? (report.passed ? "当前画面已满足质检要求" : "当前结论需要人工确认")
        : (report.passed ? "The current image meets the quality requirements." : "The current result needs review."),
    });
  }

  const allItems = dedupeAndPrioritize(items);
  const counts = countStatuses(allItems);
  const gateStatus = determineGateStatus(report, counts);
  return {
    version: SUMMARY_VERSION,
    lang,
    model: "deterministic-policy",
    sourceHash,
    items: allItems.slice(0, MAX_SUMMARY_ITEMS),
    gateStatus,
    blocksQualityPass: gateStatus === "hard_fail",
    counts,
  };
}

function specialEvaluationItem(
  report: GenerationQualityReport,
  lang: QualityDisplayLanguage,
): QualityDisplaySummaryItem | undefined {
  if (report.contractConflictsVerified && (report.contractConflicts?.length ?? 0) > 0) {
    return {
      status: "blocked_input",
      text: lang === "zh" ? "已确认的目标约束互相冲突，请先修正合同再重新质检" : "Confirmed target constraints conflict; correct the contract before review.",
    };
  }
  if (report.evaluationStatus === "reference_missing" || report.referenceComparable === false) {
    return {
      status: "blocked_input",
      text: lang === "zh" ? "缺少已批准且可比较的参考图，请补齐后重新质检" : "An approved comparable reference is required before review.",
    };
  }
  if (["technical_failed", "unavailable", "not_run"].includes(report.evaluationStatus ?? "")) {
    return {
      status: "technical_retry",
      text: lang === "zh" ? "质检服务暂不可用，请对当前图片重试质检" : "Quality review is unavailable; retry review on this image.",
    };
  }
  if (
    report.evaluationStatus === "partial"
    || report.evaluationStatus === "adjudication_required"
    || report.adjudicationRequired
    || report.qualityDecision === "review"
  ) {
    return {
      status: "pending_review",
      text: lang === "zh" ? "证据不完整或结论冲突，需要复核当前图片" : "Evidence is incomplete or disputed; review this image.",
    };
  }
  return undefined;
}

function evidenceItems(report: GenerationQualityReport, lang: QualityDisplayLanguage): QualityDisplaySummaryItem[] {
  const requirements = new Map((report.atomicRequirements ?? []).map((item) => [item.requirementId, item]));
  return (report.evidenceObservations ?? [])
    .filter((observation) => observation.status !== "not_applicable")
    .map((observation) => {
      const requirement = requirements.get(observation.requirementId);
      if (!requirement) {
        return {
          status: "pending_review" as const,
          text: observation.description || (lang === "zh" ? "存在未关联到明确要求的视觉发现" : "A visual finding is not linked to a defined requirement."),
          requirementId: observation.requirementId,
          confidence: observation.confidence,
        };
      }
      return evidenceItem(requirement, observation, lang);
    });
}

function evidenceItem(
  requirement: AtomicVisualRequirement,
  observation: VisualEvidenceObservation,
  lang: QualityDisplayLanguage,
): QualityDisplaySummaryItem {
  const base = {
    requirementId: requirement.requirementId,
    confidence: observation.confidence,
  };
  if (observation.status === "satisfied") {
    return { ...base, status: "satisfied", text: satisfiedText(requirement, lang) };
  }
  if (observation.status === "unknown") {
    return { ...base, status: "pending_review", text: pendingText(requirement, lang) };
  }
  const evidenceBacked = observation.evidenceSource === "current_output"
    && observation.confidence >= HARD_EVIDENCE_CONFIDENCE;
  if (!evidenceBacked) {
    return { ...base, status: "pending_review", text: pendingText(requirement, lang) };
  }
  return {
    ...base,
    status: requirement.severity === "hard" ? "must_fix" : "improvement",
    text: violatedText(requirement, observation, lang),
  };
}

function unrepresentedHardFailureItems(
  report: GenerationQualityReport,
  existing: QualityDisplaySummaryItem[],
  lang: QualityDisplayLanguage,
): QualityDisplaySummaryItem[] {
  const joined = existing.map((item) => `${item.requirementId ?? ""} ${item.text}`.toLowerCase()).join("\n");
  return (report.hardFailureReasons ?? [])
    .filter((reason) => {
      const requirementId = reason.match(/^requirement\s+(\S+)\s+visibly violated:/i)?.[1];
      if (requirementId && existing.some((item) => item.requirementId === requirementId)) return false;
      return !joined.includes(reason.toLowerCase()) && !isUnresolvedEvidenceReason(reason);
    })
    .map((reason) => ({
      status: "must_fix" as const,
      text: localizeHardFailure(reason, lang),
    }));
}

function unrepresentedSoftSuggestionItems(
  report: GenerationQualityReport,
  existing: QualityDisplaySummaryItem[],
  lang: QualityDisplayLanguage,
): QualityDisplaySummaryItem[] {
  const joined = existing.map((item) => item.text.toLowerCase()).join("\n");
  return (report.softSuggestions ?? [])
    .filter((suggestion) => !joined.includes(suggestion.toLowerCase()))
    .map((suggestion) => ({
      status: "improvement" as const,
      text: compactText(suggestion, lang === "zh" ? 42 : 140),
    }));
}

function legacyLedgerItems(issues: GenerationIssueLedgerEntry[], lang: QualityDisplayLanguage): QualityDisplaySummaryItem[] {
  return issues.map((issue) => ({
    status: legacyStatus(issue),
    text: issue.status === "resolved" ? resolvedCurrentStateText(issue, lang) : fallbackIssueText(issue, lang),
  }));
}

function legacyStatus(issue: GenerationIssueLedgerEntry): CurrentDisplayStatus {
  if (issue.status === "resolved") return "satisfied";
  if (issue.status === "invalid_for_stage") return "pending_review";
  return issue.severity === "hard" ? "must_fix" : "improvement";
}

function determineGateStatus(
  report: GenerationQualityReport,
  counts: Partial<Record<CurrentDisplayStatus, number>>,
): QualityGateStatus {
  if ((counts.blocked_input ?? 0) > 0) return "blocked_input";
  if ((counts.technical_retry ?? 0) > 0) return "technical_retry";
  if ((counts.pending_review ?? 0) > 0 && report.qualityDecision === "review") return "pending_review";
  if ((counts.must_fix ?? 0) > 0) return "hard_fail";
  if ((counts.pending_review ?? 0) > 0 && !report.passed) return "pending_review";
  if ((counts.improvement ?? 0) > 0 || (counts.pending_review ?? 0) > 0) return "pass_with_advice";
  return "pass";
}

function countStatuses(items: QualityDisplaySummaryItem[]): Partial<Record<CurrentDisplayStatus, number>> {
  const counts: Partial<Record<CurrentDisplayStatus, number>> = {};
  for (const item of items) {
    if (item.status === "open" || item.status === "resolved" || item.status === "deferred") continue;
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

function dedupeAndPrioritize(items: QualityDisplaySummaryItem[]): QualityDisplaySummaryItem[] {
  const priority: Record<CurrentDisplayStatus, number> = {
    must_fix: 0,
    blocked_input: 1,
    technical_retry: 2,
    pending_review: 3,
    improvement: 4,
    satisfied: 5,
  };
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = `${item.status}:${item.requirementId ?? item.text.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => priority[a.status as CurrentDisplayStatus] - priority[b.status as CurrentDisplayStatus]);
}

function satisfiedText(requirement: AtomicVisualRequirement, lang: QualityDisplayLanguage): string {
  return lang === "zh"
    ? `${domainLabel(requirement, lang)}符合要求：${compactText(requirement.target, 32)}`
    : `${domainLabel(requirement, lang)} meets the requirement: ${compactText(requirement.target, 100)}`;
}

function pendingText(requirement: AtomicVisualRequirement, lang: QualityDisplayLanguage): string {
  return lang === "zh"
    ? `${domainLabel(requirement, lang)}证据不足，需确认：${compactText(requirement.target, 30)}`
    : `${domainLabel(requirement, lang)} needs confirmation: ${compactText(requirement.target, 100)}`;
}

function violatedText(
  requirement: AtomicVisualRequirement,
  observation: VisualEvidenceObservation,
  lang: QualityDisplayLanguage,
): string {
  const detail = observation.description || requirement.target;
  return lang === "zh"
    ? `${domainLabel(requirement, lang)}不符合要求：${compactText(detail, 32)}`
    : `${domainLabel(requirement, lang)} does not meet the requirement: ${compactText(detail, 100)}`;
}

function domainLabel(requirement: AtomicVisualRequirement, lang: QualityDisplayLanguage): string {
  if (lang === "en") return requirement.domain.replace("_", " ");
  return {
    identity: "身份",
    style: "渲染风格",
    layout: "构图",
    brand_text: "品牌文字",
    game_ui: "界面",
    narrative: "剧情逻辑",
    anatomy: "人物结构",
    continuity: "连续性",
    artifact: "画面完整性",
  }[requirement.domain];
}

function fallbackIssueText(issue: GenerationIssueLedgerEntry, lang: QualityDisplayLanguage): string {
  if (issue.status === "invalid_for_stage") {
    return lang === "zh" ? "该项需在视频阶段确认" : "This item must be checked in video.";
  }
  if (lang === "zh") {
    if (issue.category === "text_brand") return "品牌文字或标识与要求不一致";
    if (issue.category === "game_ui") return "游戏界面数值或状态不准确";
    if (issue.category === "anatomy") return "人物肢体或手指形态异常";
    if (issue.category === "identity") return "人物形象与参考设定不一致";
    if (issue.category === "layout") return "画面构图或元素位置有偏差";
    return compactText(issue.summary, 42);
  }
  if (issue.category === "text_brand") return "Brand text or logo does not match the requirement.";
  if (issue.category === "game_ui") return "Game UI values or state are inaccurate.";
  if (issue.category === "anatomy") return "The character has malformed limbs or fingers.";
  if (issue.category === "identity") return "The character does not match the identity reference.";
  if (issue.category === "layout") return "Composition or element placement is inaccurate.";
  return compactText(issue.summary, 140);
}

function resolvedCurrentStateText(issue: GenerationIssueLedgerEntry, lang: QualityDisplayLanguage): string {
  if (lang === "zh") {
    if (issue.category === "text_brand") return "当前品牌文字与标识符合要求";
    if (issue.category === "game_ui") return "当前游戏界面已达到目标状态";
    if (issue.category === "anatomy") return "当前人物肢体形态自然完整";
    if (issue.category === "identity") return "当前人物形象与参考保持一致";
    if (issue.category === "layout") return "当前构图与元素位置符合要求";
    if (issue.category === "continuity") return "当前画面连续性符合要求";
    return "当前画面已达到对应要求";
  }
  if (issue.category === "text_brand") return "Brand text and logo now match the requirement.";
  if (issue.category === "game_ui") return "The game UI now matches the target state.";
  if (issue.category === "anatomy") return "The character anatomy is now natural and complete.";
  if (issue.category === "identity") return "The character now matches the identity reference.";
  if (issue.category === "layout") return "Composition and element placement now match the requirement.";
  if (issue.category === "continuity") return "The current image now meets continuity requirements.";
  return "The current image now meets this requirement.";
}

function localizeHardFailure(reason: string, lang: QualityDisplayLanguage): string {
  if (lang === "en") return compactText(reason, 140);
  const lower = reason.toLowerCase();
  if (lower.includes("identity")) return "身份一致性低于硬性标准";
  if (lower.includes("layout")) return "构图完整性低于硬性标准";
  if (lower.includes("prompt")) return "画面与核心提示要求不一致";
  if (lower.includes("continuity")) return "连续性低于硬性标准";
  if (lower.includes("contract")) return "画面违反已确认的合同约束";
  return compactText(reason, 42);
}

function isUnresolvedEvidenceReason(reason: string): boolean {
  return /^unresolved evidence for /i.test(reason);
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").replace(/^[•·–—\d.)\s]+/, "").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
