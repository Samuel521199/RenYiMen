import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type {
  GenerationIssueLedgerEntry,
  GenerationQualityReport,
  QualityDisplayLanguage,
  QualityDisplaySummary,
  QualityDisplaySummaryItem,
} from "./types";

const SUMMARY_VERSION = "quality-summary-v2" as const;
const DEFAULT_SUMMARY_MODEL = "qwen-flash";
const MAX_SUMMARY_ITEMS = 3;

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

  let summary: QualityDisplaySummary;
  try {
    summary = await summarizeWithQwen(report, params.lang, sourceHash);
  } catch {
    // The summary is presentation-only. Never fail or slow the generation pipeline
    // because this optional model is unavailable.
    return fallbackQualityDisplaySummary(report, params.lang, sourceHash);
  }

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
    issueLedger: report.issueLedger ?? [],
    correctionActions: report.correctionActions ?? [],
    artifactIssues: report.artifactIssues ?? [],
  })).digest("hex").slice(0, 16);
}

export function fallbackQualityDisplaySummary(
  report: GenerationQualityReport,
  lang: QualityDisplayLanguage,
  sourceHash = qualitySummarySourceHash(report),
): QualityDisplaySummary {
  const prioritized = [...(report.issueLedger ?? [])].sort((a, b) => issuePriority(a) - issuePriority(b));
  const items = prioritized.slice(0, MAX_SUMMARY_ITEMS).map((issue) => ({
    status: displayStatus(issue),
    text: fallbackIssueText(issue, lang),
  }));
  if (!items.length && report.artifactIssues.length) {
    items.push(...report.artifactIssues.slice(0, MAX_SUMMARY_ITEMS).map((issue) => ({
      status: "open" as const,
      text: compactText(issue, lang === "zh" ? 32 : 100),
    })));
  }
  if (!items.length) {
    items.push({
      status: report.passed ? "resolved" : "open",
      text: lang === "zh" ? (report.passed ? "当前画面已通过质检" : "当前画面仍需调整") : (report.passed ? "The image passed quality review." : "The image still needs adjustment."),
    });
  }
  return { version: SUMMARY_VERSION, lang, model: "local-fallback", sourceHash, items };
}

async function summarizeWithQwen(
  report: GenerationQualityReport,
  lang: QualityDisplayLanguage,
  sourceHash: string,
): Promise<QualityDisplaySummary> {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY;
  if (!apiKey) throw new Error("missing DashScope API key");
  const model = process.env.ALIYUN_QUALITY_SUMMARY_MODEL?.trim() || DEFAULT_SUMMARY_MODEL;
  const timeoutMs = boundedInteger(process.env.ONE_PROMPT_QUALITY_SUMMARY_TIMEOUT_MS, 8_000, 2_000, 20_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are a concise UI copy editor for an AI image quality review panel.",
              `Write only in ${lang === "zh" ? "Simplified Chinese" : "English"}.`,
              "Merge duplicates and return at most 3 conclusions total, prioritizing unresolved issues.",
              "For status=resolved, describe only the positive state visibly achieved in the current candidate. Never repeat, negate, or append the historical defect recorded in observed.",
              "A resolved sentence must read as a present-state fact, for example '当前已显示两个点赞图标' or 'Two like icons are now visible.' Do not write 'previously', 'used to', 'no longer', or 'the issue was resolved'.",
              "For status=open, describe only the current remaining gap. For status=deferred, describe what must be checked in video.",
              lang === "zh"
                ? "每条使用自然、明确的界面短句，12至30个汉字；说明画面哪里不对或已经解决，不复述字段名，不展示模型原文，不写修改步骤。"
                : "Each item must be a natural 6-18 word UI sentence stating what is wrong or resolved; do not repeat field names, raw output, or correction steps.",
              'Return strict JSON only: {"items":[{"status":"open|resolved|deferred","text":"..."}]}.',
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify(summaryInput(report)),
          },
        ],
        temperature: 0.1,
        max_tokens: 240,
        enable_thinking: false,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`quality summary HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    const content = readMessageContent(payload);
    const parsed = JSON.parse(stripJsonFence(content)) as unknown;
    const items = normalizeSummaryItems(parsed, lang);
    if (!items.length) throw new Error("empty quality summary");
    return { version: SUMMARY_VERSION, lang, model, sourceHash, items };
  } finally {
    clearTimeout(timer);
  }
}

function summaryInput(report: GenerationQualityReport): Record<string, unknown> {
  return {
    passed: report.passed,
    issues: (report.issueLedger ?? []).slice(0, 12).map((issue) => ({
      status: displayStatus(issue),
      category: issue.category,
      region: issue.region,
      ...(issue.status === "resolved"
        ? { currentAchievedState: issue.target || resolvedCurrentStateText(issue, "en") }
        : { currentObservation: issue.summary, target: issue.target }),
    })),
    corrections: (report.correctionActions ?? []).slice(0, 8).map((action) => ({
      region: action.region,
      element: action.element,
      observed: action.observed,
      target: action.target,
    })),
  };
}

function normalizeSummaryItems(value: unknown, lang: QualityDisplayLanguage): QualityDisplaySummaryItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) return [];
  const seen = new Set<string>();
  const items: QualityDisplaySummaryItem[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.text !== "string") continue;
    const text = compactText(raw.text, lang === "zh" ? 42 : 150);
    if (!text || seen.has(text.toLowerCase())) continue;
    const status = raw.status === "resolved" ? "resolved" : raw.status === "deferred" ? "deferred" : "open";
    seen.add(text.toLowerCase());
    items.push({ status, text });
    if (items.length >= MAX_SUMMARY_ITEMS) break;
  }
  return items;
}

function fallbackIssueText(issue: GenerationIssueLedgerEntry, lang: QualityDisplayLanguage): string {
  const category = issue.category;
  const resolved = issue.status === "resolved";
  if (resolved) return resolvedCurrentStateText(issue, lang);
  if (lang === "zh") {
    if (category === "text_brand") return "品牌文字或标识与要求不一致";
    if (category === "game_ui") return "游戏界面数值或状态不准确";
    if (category === "anatomy") return "人物肢体或手指形态异常";
    if (category === "identity") return "人物形象与参考设定不一致";
    if (category === "layout") return "画面构图或元素位置有偏差";
    return compactText(issue.summary, 32);
  }
  if (category === "text_brand") return "Brand text or logo does not match the requirement.";
  if (category === "game_ui") return "Game UI values or state are inaccurate.";
  if (category === "anatomy") return "The character has malformed limbs or fingers.";
  if (category === "identity") return "The character does not match the identity reference.";
  if (category === "layout") return "Composition or element placement is inaccurate.";
  return compactText(issue.summary, 100);
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

function issuePriority(issue: GenerationIssueLedgerEntry): number {
  if (issue.status === "regressed") return 0;
  if (issue.status === "open") return 1;
  if (issue.status === "resolved") return 2;
  return 3;
}

function displayStatus(issue: GenerationIssueLedgerEntry): QualityDisplaySummaryItem["status"] {
  if (issue.status === "resolved") return "resolved";
  if (issue.status === "invalid_for_stage") return "deferred";
  return "open";
}

function readMessageContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices)) throw new Error("missing choices");
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") throw new Error("missing message content");
  return first.message.content;
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || trimmed;
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").replace(/^[•\-–—\d.)\s]+/, "").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function compatibleBaseUrl(): string {
  return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
