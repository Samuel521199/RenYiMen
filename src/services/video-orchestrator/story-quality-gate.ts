import type {
  OnePromptVideoPlan,
  VideoCreativeTemplateId,
  VideoPlanSegment,
  VideoStoryBeat,
  VideoStoryFunction,
  VideoStoryQualityReport,
} from "./types";

type StoryIssue = NonNullable<VideoStoryQualityReport["issues"]>[number];
export type StoryRewriteStage = NonNullable<VideoStoryQualityReport["rewriteFromStage"]>;

export type StoryRewriteDecision = {
  shouldRewrite: boolean;
  stage: StoryRewriteStage;
  score: number;
  riskScores: Record<string, number>;
  hardIssueCodes: string[];
  reasons: string[];
};

type StoryItem = {
  id: string;
  order: number;
  segmentNo?: number;
  storyFunction?: VideoStoryFunction;
  emotionalBeat?: string;
  cause?: string;
  effect?: string;
  informationUnit?: string;
  keyEvidenceIds: string[];
  requiredAnchorIds: string[];
  linkedBeatIds: string[];
  actionContinuity?: {
    motivationOrPreparation?: string;
    execution?: string;
    resultOrReaction?: string;
  };
  reactionBeat?: string;
  powerShift?: string;
  text: string;
};

export function evaluateStoryQualityGate(plan: OnePromptVideoPlan): VideoStoryQualityReport {
  const existingIssues = plan.storyQualityReport?.issues ?? [];
  const items = collectStoryItems(plan);
  const issues: StoryIssue[] = [...existingIssues];
  const category = plan.creativeStrategy?.videoCategory;
  const templateId = plan.creativeStrategy?.templateId;
  const functions = new Set(items.map((item) => item.storyFunction).filter(Boolean));
  const hasHook = functions.has("hook") || hasNonEmpty(plan.creativeStrategy?.hook, plan.creativeStrategy?.hookZh, plan.creativeStrategy?.hookEn);
  const hasConflict = functions.has("conflict") || hasNonEmpty(plan.creativeStrategy?.conflict, plan.creativeStrategy?.conflictZh, plan.creativeStrategy?.conflictEn);
  const hasTurningPoint = functions.has("turning_point") || hasNonEmpty(plan.creativeStrategy?.turningPoint, plan.creativeStrategy?.turningPointZh, plan.creativeStrategy?.turningPointEn);
  const hasPayoff = functions.has("payoff") || hasNonEmpty(plan.creativeStrategy?.payoff, plan.creativeStrategy?.payoffZh, plan.creativeStrategy?.payoffEn);
  const hasProof = functions.has("proof");
  const ctaItems = items.filter((item) => item.storyFunction === "cta");
  const hasCta = ctaItems.length > 0 || hasNonEmpty(plan.creativeStrategy?.cta, plan.creativeStrategy?.ctaZh, plan.creativeStrategy?.ctaEn);
  const payoffItems = items.filter((item) => item.storyFunction === "payoff");
  const turningItems = items.filter((item) => item.storyFunction === "turning_point");
  const proofItems = items.filter((item) => item.storyFunction === "proof");

  if (!hasHook) addIssue(issues, {
    code: "missingHook",
    messageZh: "缺少 hook，开头没有明确抓住用户注意力的剧情功能。",
    recommendationZh: "补充一个开场问题、反差、压力或强利益点。",
  });
  if (!hasConflict) addIssue(issues, {
    code: "missingConflict",
    messageZh: "缺少 conflict，故事没有明确阻力、痛点或悬念。",
    recommendationZh: "补充用户痛点、失败压力、人物冲突或未满足需求。",
  });
  if (!hasTurningPoint && !hasPayoff) addIssue(issues, {
    code: "missingTurningPointOrPayoff",
    messageZh: "缺少 turning point/payoff，结果或爽点没有被设计出来。",
    recommendationZh: "补充可见触发动作，以及动作后的结果兑现。",
  });

  if (!hasCta) addIssue(issues, {
    code: "missingCta",
    messageZh: "缺少 CTA，故事没有明确把前面的价值引导到下一步行动。",
    recommendationZh: "补充下载、购买、预约、了解更多或继续观看等明确行动引导，并让它承接前面的利益点。",
  });

  checkSuddenOutcomeRisk(issues, items, payoffItems, turningItems, proofItems);
  checkCtaTraceability(issues, items, ctaItems);
  checkNewInformationPerSegment(issues, plan.segments, items);
  checkPayoffReaction(issues, payoffItems);
  checkComplexActionContinuity(issues, items);
  checkKeyEvidence(issues, category, templateId, items);
  checkReferenceOveruse(issues, plan, items, hasHook, hasConflict, hasTurningPoint || hasPayoff);
  checkProductSpecificRisks(issues, category, templateId, hasHook, hasConflict, proofItems, payoffItems);

  const uniqueIssues = dedupeIssues(issues);
  const issueCodes = uniqueIssues.map((issue) => issue.code);
  const score = scoreFromIssues(uniqueIssues);
  const riskScores = riskScoresFromIssues(uniqueIssues);

  return {
    ...(plan.storyQualityReport ?? {}),
    passed: uniqueIssues.length === 0,
    score,
    hookScore: hasHook ? 100 : 35,
    causalityScore: issueCodes.includes("suddenOutcomeRisk") ? 35 : issueCodes.includes("missingConflict") ? 55 : 88,
    payoffScore: hasPayoff || hasTurningPoint ? issueCodes.includes("payoffReactionMissing") ? 65 : 90 : 30,
    ctaScore: ctaItems.length ? issueCodes.includes("ctaTraceMissing") ? 45 : 88 : 65,
    continuityScore: issueCodes.includes("complexActionContinuityMissing") ? 50 : 86,
    riskScores,
    issueCodes,
    issues: uniqueIssues,
    rewriteRequired: plan.storyQualityReport?.rewriteRequired ?? false,
    autoRewriteAttempts: plan.storyQualityReport?.autoRewriteAttempts,
    rewriteReasons: plan.storyQualityReport?.rewriteReasons ?? [],
    rewriteFromStage: plan.storyQualityReport?.rewriteFromStage ?? "none",
    summaryZh: uniqueIssues.length
      ? `Story Quality Gate 发现 ${uniqueIssues.length} 个软风险，不阻断生成。`
      : "Story Quality Gate 未发现明显剧情结构风险。",
  };
}

export function withStoryQualityGate(plan: OnePromptVideoPlan): OnePromptVideoPlan {
  return {
    ...plan,
    storyQualityReport: evaluateStoryQualityGate(plan),
  };
}

export function decideStoryRewrite(report: VideoStoryQualityReport | undefined): StoryRewriteDecision {
  const issueCodes = report?.issueCodes ?? [];
  const riskScores = report?.riskScores ?? riskScoresFromIssueCodes(issueCodes);
  const score = typeof report?.score === "number" ? report.score : 0;
  const hardIssueCodes = issueCodes.filter((code) =>
    code === "missingHook" ||
    code === "missingConflict" ||
    code === "missingTurningPointOrPayoff" ||
    code === "missingCta");
  const reasons: string[] = [];
  if (score < 75) reasons.push(`score ${score} < 75`);
  if ((riskScores.suddenOutcomeRisk ?? 0) > 0.35) reasons.push("suddenOutcomeRisk > 0.35");
  if ((riskScores.referenceOveruseRisk ?? 0) > 0.45) reasons.push("referenceOveruseRisk > 0.45");
  if (hardIssueCodes.length) reasons.push(`missing hard story fields: ${hardIssueCodes.join(", ")}`);
  const shouldRewrite = reasons.length > 0;
  return {
    shouldRewrite,
    stage: shouldRewrite ? earliestRewriteStage(issueCodes) : "none",
    score,
    riskScores,
    hardIssueCodes,
    reasons,
  };
}

export function markStoryRewriteRequired(
  plan: OnePromptVideoPlan,
  attempts: number,
  decision = decideStoryRewrite(plan.storyQualityReport),
): OnePromptVideoPlan {
  return {
    ...plan,
    storyQualityReport: {
      ...(plan.storyQualityReport ?? {}),
      rewriteRequired: decision.shouldRewrite,
      autoRewriteAttempts: attempts,
      rewriteReasons: decision.reasons,
      rewriteFromStage: decision.shouldRewrite ? decision.stage : "none",
      summaryZh: decision.shouldRewrite
        ? `Story Quality Gate 自动重写 ${attempts} 次后仍未达标：${decision.reasons.join("；")}`
        : plan.storyQualityReport?.summaryZh,
    },
    plannerWarnings: decision.shouldRewrite
      ? uniqueStrings([...(plan.plannerWarnings ?? []), `story quality auto rewrite exhausted: ${decision.reasons.join("; ")}`])
      : plan.plannerWarnings,
  };
}

function collectStoryItems(plan: OnePromptVideoPlan): StoryItem[] {
  const beatItems = (plan.storyBeats ?? []).map(storyBeatToItem);
  const beatMap = new Map(beatItems.map((item) => [item.id, item]));
  const segmentItems = (plan.segments ?? []).map((segment) => segmentToItem(segment, beatMap));
  return [...beatItems, ...segmentItems].sort((a, b) => a.order - b.order);
}

function storyBeatToItem(beat: VideoStoryBeat): StoryItem {
  return {
    id: beat.beatId,
    order: beat.order,
    segmentNo: beat.targetSegmentNos?.[0],
    storyFunction: beat.storyFunction,
    emotionalBeat: firstText(beat.emotionalBeatZh, beat.emotionalBeat, beat.emotionalBeatEn),
    cause: beat.cause,
    effect: beat.effect,
    informationUnit: beat.informationUnit,
    keyEvidenceIds: beat.keyEvidenceIds ?? [],
    requiredAnchorIds: beat.requiredAnchorIds ?? [],
    linkedBeatIds: [beat.beatId],
    actionContinuity: beat.actionContinuity,
    reactionBeat: beat.reactionBeat,
    powerShift: beat.powerShift,
    text: [
      beat.titleZh,
      beat.title,
      beat.titleEn,
      beat.emotionalBeatZh,
      beat.cause,
      beat.effect,
      beat.informationUnit,
      beat.reactionBeat,
      beat.powerShift,
      ...(beat.notes ?? []),
    ].filter(Boolean).join(" "),
  };
}

function segmentToItem(segment: VideoPlanSegment, beatMap: Map<string, StoryItem>): StoryItem {
  const linkedBeatIds = segment.linkedBeatIds ?? [];
  const linked = linkedBeatIds.map((id) => beatMap.get(id)).filter((item): item is StoryItem => Boolean(item));
  const primary = linked[0];
  return {
    id: `segment_${segment.segmentNo}`,
    order: 1000 + segment.segmentNo,
    segmentNo: segment.segmentNo,
    storyFunction: segment.storyFunction ?? primary?.storyFunction,
    emotionalBeat: firstText(segment.emotionalBeatZh, segment.emotionalBeat, segment.emotionalBeatEn, primary?.emotionalBeat),
    cause: firstText(segment.cause, primary?.cause),
    effect: firstText(segment.effect, primary?.effect),
    informationUnit: firstText(segment.informationUnit, primary?.informationUnit),
    keyEvidenceIds: segment.keyEvidenceIds?.length ? segment.keyEvidenceIds : primary?.keyEvidenceIds ?? [],
    requiredAnchorIds: segment.usesConsistencyAnchors ?? [],
    linkedBeatIds,
    actionContinuity: segment.actionContinuity ?? primary?.actionContinuity,
    reactionBeat: firstText(segment.reactionBeat, primary?.reactionBeat),
    powerShift: firstText(segment.powerShift, primary?.powerShift),
    text: [
      segment.purposeZh,
      segment.purpose,
      segment.motion,
      segment.videoPromptZh,
      segment.videoPrompt,
      segment.subtitle,
      segment.cause,
      segment.effect,
      segment.informationUnit,
      segment.reactionBeat,
      segment.powerShift,
    ].filter(Boolean).join(" "),
  };
}

function checkSuddenOutcomeRisk(
  issues: StoryIssue[],
  items: StoryItem[],
  payoffItems: StoryItem[],
  turningItems: StoryItem[],
  proofItems: StoryItem[],
): void {
  for (const payoff of payoffItems) {
    const priorTrigger = [...turningItems, ...proofItems].some((item) =>
      item.order < payoff.order &&
      (hasCompleteActionContinuity(item) || hasText(item.cause) || item.keyEvidenceIds.length > 0 || item.requiredAnchorIds.length > 0));
    if (!priorTrigger || !hasText(payoff.cause)) {
      addIssue(issues, {
        code: "suddenOutcomeRisk",
        segmentNo: payoff.segmentNo,
        beatId: payoff.id.startsWith("beat") ? payoff.id : undefined,
        messageZh: "payoff/胜利结果缺少前置触发动作或可追溯原因，容易出现“突然赢了”。",
        recommendationZh: "在 payoff 前补充 turning point/proof：明确准备、执行、结果三段动作和关键证据。",
      });
    }
  }
  if (!payoffItems.length && looksLikeOutcome(items.map((item) => item.text).join(" "))) {
    addIssue(issues, {
      code: "suddenOutcomeRisk",
      messageZh: "文本中出现胜利、奖励或结果，但没有明确 payoff beat。",
      recommendationZh: "补充 payoff beat，并绑定前置触发动作。",
    });
  }
}

function checkCtaTraceability(issues: StoryIssue[], items: StoryItem[], ctaItems: StoryItem[]): void {
  for (const cta of ctaItems) {
    const priorBenefit = items.some((item) =>
      item.order < cta.order &&
      (item.storyFunction === "payoff" || item.storyFunction === "proof" || item.storyFunction === "reaction") &&
      (hasText(item.effect) || hasText(item.informationUnit) || item.keyEvidenceIds.length > 0));
    if (!priorBenefit) addIssue(issues, {
      code: "ctaTraceMissing",
      segmentNo: cta.segmentNo,
      beatId: cta.id.startsWith("beat") ? cta.id : undefined,
      messageZh: "CTA 不能追溯到前面的利益点或证明，像是突然出现的下载/购买按钮。",
      recommendationZh: "让 CTA 接在 payoff/proof/reaction 后面，并写明转化理由。",
    });
  }
}

function checkNewInformationPerSegment(issues: StoryIssue[], segments: VideoPlanSegment[], items: StoryItem[]): void {
  const seen = new Set<string>();
  for (const segment of segments) {
    const item = items.find((candidate) => candidate.id === `segment_${segment.segmentNo}`);
    const info = normalizeInfo(item?.informationUnit || item?.effect || segment.purposeZh || segment.purpose);
    if (!info || seen.has(info)) {
      addIssue(issues, {
        code: "noNewInformationRisk",
        segmentNo: segment.segmentNo,
        messageZh: `镜头 ${segment.segmentNo} 没有明确新增信息，可能只是重复展示画面。`,
        recommendationZh: "给该镜头绑定新的 informationUnit，例如新痛点、新证据、新反应或新行动。",
      });
    }
    if (info) seen.add(info);
  }
}

function checkPayoffReaction(issues: StoryIssue[], payoffItems: StoryItem[]): void {
  for (const payoff of payoffItems) {
    if (!hasText(payoff.reactionBeat)) addIssue(issues, {
      code: "payoffReactionMissing",
      segmentNo: payoff.segmentNo,
      beatId: payoff.id.startsWith("beat") ? payoff.id : undefined,
      messageZh: "payoff 缺少 reactionBeat，爽点没有通过人物/用户反应被确认。",
      recommendationZh: "补充主角、顾客、朋友或对手的反应，让结果有情绪反馈。",
    });
  }
}

function checkComplexActionContinuity(issues: StoryIssue[], items: StoryItem[]): void {
  for (const item of items) {
    const needsContinuity = item.storyFunction === "turning_point" ||
      item.storyFunction === "payoff" ||
      item.storyFunction === "proof" ||
      /触发|完成|使用|拿起|下单|反转|翻盘|赢|奖励|before|after|apply|order|win|bonus|transform/i.test(item.text);
    if (needsContinuity && !hasCompleteActionContinuity(item)) addIssue(issues, {
      code: "complexActionContinuityMissing",
      segmentNo: item.segmentNo,
      beatId: item.id.startsWith("beat") ? item.id : undefined,
      messageZh: "复杂动作缺少 motivation_or_preparation / execution / result_or_reaction 三段式。",
      recommendationZh: "补齐动机或准备、执行动作、结果或反应，避免动作和结果断裂。",
    });
  }
}

function checkKeyEvidence(
  issues: StoryIssue[],
  category: string | undefined,
  templateId: VideoCreativeTemplateId | undefined,
  items: StoryItem[],
): void {
  const evidenceSensitive = category === "game" ||
    category === "product" ||
    category === "ecommerce" ||
    category === "food" ||
    templateId === "product_problem_solution" ||
    templateId === "ecommerce_offer_conversion" ||
    templateId === "food_sensory_reaction" ||
    templateId === "game_reversal" ||
    templateId === "game_bonus_payoff";
  if (!evidenceSensitive) return;
  for (const item of items) {
    if ((item.storyFunction === "proof" || item.storyFunction === "turning_point" || item.storyFunction === "payoff") &&
      !item.keyEvidenceIds.length &&
      !item.requiredAnchorIds.length) {
      addIssue(issues, {
        code: "keyEvidenceMissing",
        segmentNo: item.segmentNo,
        beatId: item.id.startsWith("beat") ? item.id : undefined,
        messageZh: "关键机制或产品卖点缺少 keyEvidence，证明链不够明确。",
        recommendationZh: "绑定产品、机制、前后对比、顾客反应或奖励触发等证据 ID。",
      });
    }
  }
}

function checkReferenceOveruse(
  issues: StoryIssue[],
  plan: OnePromptVideoPlan,
  items: StoryItem[],
  hasHook: boolean,
  hasConflict: boolean,
  hasOutcome: boolean,
): void {
  const joined = [
    plan.creativeStrategy?.referenceUsageStrategy,
    plan.creativeStrategy?.referenceUsageStrategyZh,
    ...(plan.segments ?? []).map((segment) => [segment.purpose, segment.motion, segment.videoPrompt, segment.videoPromptZh].join(" ")),
    ...items.map((item) => item.text),
  ].join(" ");
  const referenceLanguage = /参考图|参考|动起来|让.*动|展示.*图|原图|reference image|animate.*reference|make.*image.*move|showcase/i.test(joined);
  const causalItems = items.filter((item) => hasText(item.cause) && hasText(item.effect) && hasText(item.informationUnit));
  if (referenceLanguage && (!hasHook || !hasConflict || !hasOutcome || causalItems.length < Math.ceil(Math.max(1, items.length) / 3))) {
    addIssue(issues, {
      code: "referenceOveruseRisk",
      messageZh: "计划疑似过度依赖参考图，只是在展示或让参考图动起来，而不是先设计剧情因果。",
      recommendationZh: "把参考图降级为资产来源，补充 hook、conflict、turning point、payoff 和 CTA 的因果链。",
    });
  }
}

function checkProductSpecificRisks(
  issues: StoryIssue[],
  category: string | undefined,
  templateId: VideoCreativeTemplateId | undefined,
  hasHook: boolean,
  hasConflict: boolean,
  proofItems: StoryItem[],
  payoffItems: StoryItem[],
): void {
  const isProduct = category === "product" || templateId === "product_problem_solution";
  if (!isProduct) return;
  if (!hasHook && !hasConflict) addIssue(issues, {
    code: "productPainPointMissingRisk",
    messageZh: "产品广告缺少痛点或使用前问题，产品出现得太生硬。",
    recommendationZh: "补充使用前困扰、需求场景或用户动机。",
  });
  const hasProof = proofItems.some((item) =>
    hasText(item.effect, item.informationUnit) || item.keyEvidenceIds.length > 0 || item.requiredAnchorIds.length > 0) ||
    payoffItems.some((item) =>
      hasText(item.effect) || item.keyEvidenceIds.length > 0 || item.requiredAnchorIds.length > 0);
  if (!hasProof) addIssue(issues, {
    code: "productProofMissingRisk",
    messageZh: "产品广告缺少效果证明或卖点证据。",
    recommendationZh: "补充成分/功能/前后对比/用户反应等证明 beat。",
  });
}

function addIssue(issues: StoryIssue[], issue: Omit<StoryIssue, "severity"> & { severity?: StoryIssue["severity"] }): void {
  issues.push({ severity: "warning", ...issue });
}

function dedupeIssues(issues: StoryIssue[]): StoryIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.code, issue.beatId ?? "", issue.segmentNo ?? "", issue.messageZh ?? ""].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreFromIssues(issues: StoryIssue[]): number {
  const penalty = issues.reduce((total, issue) => {
    if (issue.code === "suddenOutcomeRisk" || issue.code === "referenceOveruseRisk") return total + 18;
    if (issue.code === "productProofMissingRisk" || issue.code === "ctaTraceMissing") return total + 14;
    return total + 9;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function riskScoresFromIssues(issues: StoryIssue[]): Record<string, number> {
  return riskScoresFromIssueCodes(issues.map((issue) => issue.code));
}

function riskScoresFromIssueCodes(issueCodes: string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const code of issueCodes) {
    scores[code] = Math.max(scores[code] ?? 0, riskWeightForIssueCode(code));
  }
  return scores;
}

function riskWeightForIssueCode(code: string): number {
  if (code === "missingHook" || code === "missingConflict" || code === "missingTurningPointOrPayoff" || code === "missingCta") return 1;
  if (code === "referenceOveruseRisk") return 0.55;
  if (code === "suddenOutcomeRisk") return 0.5;
  if (code === "ctaTraceMissing" || code === "productProofMissingRisk") return 0.45;
  if (code === "complexActionContinuityMissing" || code === "keyEvidenceMissing") return 0.4;
  if (code === "productPainPointMissingRisk") return 0.38;
  if (code === "payoffReactionMissing") return 0.32;
  if (code === "noNewInformationRisk") return 0.25;
  return 0.2;
}

function earliestRewriteStage(issueCodes: string[]): StoryRewriteStage {
  const codes = new Set(issueCodes);
  if (codes.has("referenceOveruseRisk") || codes.has("missingHook")) return "creative_strategy";
  if (
    codes.has("missingConflict") ||
    codes.has("missingTurningPointOrPayoff") ||
    codes.has("missingCta") ||
    codes.has("productPainPointMissingRisk") ||
    codes.has("productProofMissingRisk")
  ) return "beat_sheet";
  if (
    codes.has("suddenOutcomeRisk") ||
    codes.has("ctaTraceMissing") ||
    codes.has("noNewInformationRisk") ||
    codes.has("payoffReactionMissing") ||
    codes.has("complexActionContinuityMissing") ||
    codes.has("keyEvidenceMissing")
  ) return "storyboard";
  return "storyboard";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => Boolean(value.trim()))));
}

function hasCompleteActionContinuity(item: StoryItem): boolean {
  return hasText(item.actionContinuity?.motivationOrPreparation) &&
    hasText(item.actionContinuity?.execution) &&
    hasText(item.actionContinuity?.resultOrReaction);
}

function looksLikeOutcome(text: string): boolean {
  return /赢|胜利|翻盘|奖励|爆发|结果|改善|下单|购买|win|victory|payoff|reward|bonus|order/i.test(text);
}

function normalizeInfo(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

function hasText(...values: Array<string | undefined>): boolean {
  return values.some((value) => Boolean(value?.trim()));
}

function hasNonEmpty(...values: Array<string | undefined>): boolean {
  return hasText(...values);
}

function firstText(...values: Array<string | undefined>): string {
  return values.find((value) => Boolean(value?.trim()))?.trim() ?? "";
}
