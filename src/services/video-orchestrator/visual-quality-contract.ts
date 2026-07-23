import type { GenerationCorrectionAction, GenerationIssueLedgerEntry, GenerationQualityReport } from "./types";

export interface AuthoritativeVisualContract {
  version: "visual-contract-v1";
  mediaStage: "static_image" | "video";
  sourcePriority: string[];
  requiredText: string[];
  allowedText: string[];
  forbiddenText: string[];
  exactTextAuthority: "approved_reference" | "structured_contract" | "none";
  allowGameUi: boolean;
  allowBrandText: boolean;
  staticRequirements: string[];
  deferredVideoChecks: string[];
  verifiedConflicts: string[];
  warnings: string[];
}

export function buildAuthoritativeVisualContract(input: {
  targetContract: Record<string, unknown>;
  anchorContractText?: string;
  prompt: string;
  negativePrompt?: string;
  mediaStage: "static_image" | "video";
  hasApprovedReferences: boolean;
}): AuthoritativeVisualContract {
  const flatTarget = flattenText(input.targetContract);
  const anchorText = input.anchorContractText?.trim() ?? "";
  const combined = [flatTarget, anchorText, input.prompt].filter(Boolean).join("\n");
  const requiredText = unique([
    ...readStringList(input.targetContract, ["requiredText", "required_text", "requiredBrandText", "required_brand_text"]),
    ...extractQuotedBrandText(anchorText),
  ]);
  const explicitForbiddenText = readStringList(input.targetContract, ["forbiddenText", "forbidden_text"]);
  const verifiedConflicts = requiredText
    .filter((required) => explicitForbiddenText.some((forbidden) => normalize(required) === normalize(forbidden)))
    .map((text) => `The structured contract both requires and forbids exact text: ${text}`);
  const allowGameUi = /game[_\s-]?interface|game ui|hud|计时器|得分|分数|游戏界面|asset_category[:=]\s*(?:prop|brand_visual)/i.test(combined);
  const allowBrandText = requiredText.length > 0 || /brand_visual|game[_\s-]?logo|logo|品牌|字样/i.test(combined);
  const dynamicRequirements = extractDynamicRequirements(flatTarget);
  const warnings: string[] = [];
  if ((allowGameUi || allowBrandText) && genericTextBan(input.prompt + "\n" + (input.negativePrompt ?? ""))) {
    warnings.push("Generic no-text/no-UI wording conflicted with required game/brand evidence and was narrowed to random or unauthorized text only.");
  }
  if (input.mediaStage === "static_image" && dynamicRequirements.length) {
    warnings.push("Motion-only requirements were deferred to video evaluation; the still image is checked only for a clear representative state.");
  }
  return {
    version: "visual-contract-v1",
    mediaStage: input.mediaStage,
    sourcePriority: [
      "user-confirmed fields and approved reference images",
      "locked asset contracts",
      "frame or narrative contract",
      "planner inference",
      "visual-evaluator observations",
    ],
    requiredText,
    allowedText: requiredText,
    forbiddenText: unique([...explicitForbiddenText, "gibberish", "misspelled locked text", "unauthorized extra copy", "subtitles", "watermarks"]),
    exactTextAuthority: input.hasApprovedReferences ? "approved_reference" : requiredText.length ? "structured_contract" : "none",
    allowGameUi,
    allowBrandText,
    staticRequirements: input.mediaStage === "static_image"
      ? dynamicRequirements.map(staticProxyForDynamicRequirement)
      : [],
    deferredVideoChecks: input.mediaStage === "static_image" ? dynamicRequirements : [],
    verifiedConflicts,
    warnings,
  };
}

export function repairPromptAgainstVisualContract(prompt: string, contract: AuthoritativeVisualContract): string {
  if (!contract.allowBrandText && !contract.allowGameUi) return prompt;
  return prompt
    .replace(/无文字[、,，\s]*无\s*UI[、,，\s]*无水印/gi, "除权威品牌文字和必要游戏 UI 外，不添加字幕、随机文字或水印")
    .replace(/no text[,.\s]*no ui[,.\s]*no watermark/gi, "no subtitles, unauthorized text, gibberish, or watermark; preserve required brand text and game UI")
    .replace(/无文字(?!体)/g, "无随机或未授权文字")
    .replace(/无\s*UI/gi, "无合同外 UI");
}

export function repairNegativePromptAgainstVisualContract(negativePrompt: string, contract: AuthoritativeVisualContract): string {
  if (!contract.allowBrandText && !contract.allowGameUi) return negativePrompt;
  const forbiddenGeneric = /^(?:text|letters?|typography|logo|ui|ui elements?|文字|字样|徽标|标志|ui元素)$/i;
  return negativePrompt
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item && !forbiddenGeneric.test(item))
    .join(", ");
}

export function isMotionOnlyStillIssue(value: string): boolean {
  return /(?:lacks?|missing|without|无法|缺少|没有).{0,32}(?:animation|animated|motion|moving|jump(?:ing)?|countdown movement|动态|动画|跳动|变化过程)|(?:static|静态).{0,24}(?:score|timer|digit|分数|计时器|数字)/i.test(value);
}

export function reconcileGenerationIssueLedger(input: {
  previous?: GenerationQualityReport;
  candidateNo?: number;
  artifactIssues: string[];
  correctionActions: GenerationCorrectionAction[];
  invalidIssueTexts?: string[];
}): GenerationIssueLedgerEntry[] {
  const previous = input.previous?.issueLedger ?? [];
  const invalid = new Set((input.invalidIssueTexts ?? []).map(issueFingerprint));
  const current = new Map<string, GenerationIssueLedgerEntry>();
  for (const action of input.correctionActions) {
    const fingerprint = issueFingerprint(`${action.region}|${action.element}|${action.observed}`);
    const prior = previous.find((item) => item.fingerprint === fingerprint);
    current.set(fingerprint, {
      issueId: prior?.issueId ?? `issue_${stableHash(fingerprint)}`,
      fingerprint,
      category: issueCategory(`${action.element} ${action.observed}`),
      region: action.region,
      summary: action.observed,
      target: action.target,
      // Visual-model findings are soft until a deterministic checker or the
      // compiler explicitly marks their source as verified.
      severity: /^verified:/i.test(action.sourceConstraint ?? "") ? "hard" : "soft",
      applicableStage: "static_image",
      status: prior?.status === "resolved" ? "regressed" : "open",
      firstSeenCandidateNo: prior?.firstSeenCandidateNo ?? input.candidateNo,
      lastSeenCandidateNo: input.candidateNo,
      occurrenceCount: (prior?.occurrenceCount ?? 0) + 1,
    });
  }
  for (const issue of input.artifactIssues) {
    const fingerprint = issueFingerprint(issue);
    if (current.has(fingerprint)) continue;
    const prior = previous.find((item) => item.fingerprint === fingerprint);
    const motionOnly = invalid.has(fingerprint) || isMotionOnlyStillIssue(issue);
    current.set(fingerprint, {
      issueId: prior?.issueId ?? `issue_${stableHash(fingerprint)}`,
      fingerprint,
      category: issueCategory(issue),
      summary: issue,
      severity: motionOnly || /^Unverified evaluator contract suspicion:/i.test(issue) ? "advisory" : "soft",
      applicableStage: motionOnly ? "video" : "static_image",
      status: motionOnly ? "invalid_for_stage" : prior?.status === "resolved" ? "regressed" : "open",
      firstSeenCandidateNo: prior?.firstSeenCandidateNo ?? input.candidateNo,
      lastSeenCandidateNo: input.candidateNo,
      occurrenceCount: (prior?.occurrenceCount ?? 0) + 1,
    });
  }
  for (const prior of previous) {
    if (current.has(prior.fingerprint) || prior.status === "invalid_for_stage") continue;
    current.set(prior.fingerprint, { ...prior, status: "resolved", lastSeenCandidateNo: input.candidateNo });
  }
  return [...current.values()];
}

function extractDynamicRequirements(value: string): string[] {
  return unique(value.split(/[。.!?；;\n]/).map((item) => item.trim()).filter((item) =>
    /快速跳动|动态变化|动画|闪烁|countdown|jump(?:ing)?|animated|moving|motion/i.test(item)
  ));
}

function staticProxyForDynamicRequirement(value: string): string {
  return `Show one clear representative still state that visually implies this later video action, without requiring motion in the image: ${value}`;
}

function genericTextBan(value: string): boolean {
  return /无文字|无\s*UI|no text|no ui|\btext\b|ui elements?/i.test(value);
}

function extractQuotedBrandText(value: string): string[] {
  const matches = [...value.matchAll(/[‘'“"]([^’'”"]{2,80})[’'”"]/g)].map((match) => match[1].trim());
  return matches.filter((item) => /[A-Z]{2,}|\d|[\u3400-\u9fff]/.test(item));
}

function readStringList(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return unique(value.filter((item): item is string => typeof item === "string"));
    if (typeof value === "string" && value.trim()) return [value.trim()];
  }
  return [];
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(flattenText).join(" ");
  return "";
}

function issueFingerprint(value: string): string {
  const category = issueCategory(value);
  const region = /(?:bottom|top|upper|lower|left|right|center|hand|face|logo|hud|score|timer|底部|顶部|左|右|中央|手|脸|标志|分数|计时器)/i.exec(value)?.[0]?.toLowerCase() ?? "global";
  return `${category}:${region}`;
}

function issueCategory(value: string): GenerationIssueLedgerEntry["category"] {
  if (/logo|brand|text|word|spell|文字|字样|品牌|标志/i.test(value)) return "text_brand";
  if (/score|timer|hud|ui|分数|计时器|界面/i.test(value)) return "game_ui";
  if (/hand|finger|limb|anatom|手|指|肢体/i.test(value)) return "anatomy";
  if (/identity|face|character|身份|人物|脸/i.test(value)) return "identity";
  if (/layout|composition|position|构图|布局|位置/i.test(value)) return "layout";
  if (/continuity|previous|连续|上一/i.test(value)) return "continuity";
  return "artifact";
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}
