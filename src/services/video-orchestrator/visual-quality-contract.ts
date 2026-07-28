import type {
  AtomicVisualRequirement,
  AtomicVisualRequirementDomain,
  GenerationCorrectionAction,
  GenerationIssueLedgerEntry,
  GenerationQualityReport,
  VisualEvidenceObservation,
} from "./types";

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
  const isolationMode = textField(input.targetContract, ["isolationMode", "isolation_mode"]);
  const isolatedAsset = isolationMode === "single_asset";
  const requiredText = unique([
    ...readStringList(input.targetContract, ["requiredText", "required_text", "requiredBrandText", "required_brand_text"]),
    ...extractQuotedBrandText(anchorText),
  ]);
  const explicitForbiddenText = readStringList(input.targetContract, ["forbiddenText", "forbidden_text"]);
  const verifiedConflicts = requiredText
    .filter((required) => explicitForbiddenText.some((forbidden) => normalize(required) === normalize(forbidden)))
    .map((text) => `The structured contract both requires and forbids exact text: ${text}`);
  const allowGameUi = !isolatedAsset
    && /game[_\s-]?interface|game ui|hud|计时器|得分|分数|游戏界面/i.test(combined);
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

/**
 * Converts the heterogeneous planner/frame contract into a bounded list of
 * stable, independently judgeable visual requirements. The visual evaluator
 * receives this packet instead of the full generation prompt and planner JSON.
 */
export function compileAtomicVisualRequirements(input: {
  targetContract: Record<string, unknown>;
  visualContract?: AuthoritativeVisualContract;
  purpose: "anchor_reference_image" | "boundary_keyframe" | "motion_checkpoint_image" | "transition_reference_frame" | "video_segment" | "generated_bridge";
}): AtomicVisualRequirement[] {
  const requirements = new Map<string, AtomicVisualRequirement>();
  const mediaStage = input.visualContract?.mediaStage ?? (input.purpose === "video_segment" || input.purpose === "generated_bridge" ? "video" : "static_image");
  const add = (requirement: AtomicVisualRequirement) => {
    if (!requirement.target.trim() || requirements.has(requirement.requirementId)) return;
    requirements.set(requirement.requirementId, requirement);
  };

  for (const [index, value] of (input.visualContract?.requiredText ?? []).entries()) {
    add({
      requirementId: `brand_text.required.${stableHash(`${index}:${normalize(value)}`)}`,
      domain: "brand_text",
      target: `The current output visibly contains the exact authorized text: ${value}`,
      severity: "hard",
      authority: input.visualContract?.exactTextAuthority === "approved_reference" ? "approved_reference" : "structured_contract",
      appliesTo: mediaStage,
      tolerance: "Exact character sequence; decorative font variation is allowed only when every character remains legible.",
    });
  }

  const targetAnchorId = textField(input.targetContract, ["targetAnchorId", "target_anchor_id"]);
  const isolatedSelfAnchor = textField(input.targetContract, ["isolationMode", "isolation_mode"]) === "single_asset"
    ? targetAnchorId
    : "";
  const renderingStyleValue = input.targetContract.renderingStyle ?? input.targetContract.rendering_style;
  const identityReferenceRequired =
    input.targetContract.identityReferenceRequired === true
    || input.targetContract.identity_reference_required === true;
  if (identityReferenceRequired && targetAnchorId) {
    add({
      requirementId: `identity.user_reference.${stableHash(normalize(targetAnchorId))}`,
      domain: "identity",
      target: `The isolated target character ${targetAnchorId} must directly match the same character visible in the approved user reference: face design, head and horn geometry, body proportions, clothing, colors, and accessories.`,
      severity: "hard",
      authority: "approved_reference",
      appliesTo: mediaStage,
      tolerance: "Pose, crop, isolated background, and conservatively completed unseen body regions may vary. Visible identity-defining character features may not be redesigned.",
      referenceAnchorIds: [targetAnchorId],
    });
  }
  if (renderingStyleValue && typeof renderingStyleValue === "object") {
    const renderingStyleText = JSON.stringify(renderingStyleValue);
    add({
      requirementId: `style.reference_lock.${stableHash(normalize(renderingStyleText))}`,
      domain: "style",
      target: `Rendering style must match the approved user reference and this hard style contract: ${renderingStyleText}`,
      severity: "hard",
      authority: "approved_reference",
      appliesTo: mediaStage,
      tolerance: "Pose, crop, and isolated background may change. Rendering medium, 2D/3D dimensionality, shading, edge treatment, surface language, and depth treatment may not drift.",
      referenceAnchorIds: targetAnchorId ? [targetAnchorId] : undefined,
    });
  }
  const anchorIds = unique(readStringList(input.targetContract, [
    "effectiveRequiredAnchorIds",
    "effective_required_anchor_ids",
    "requiredAnchorIds",
    "required_anchor_ids",
    "usesConsistencyAnchors",
    "uses_consistency_anchors",
  ])).filter((anchorId) => anchorId !== isolatedSelfAnchor);
  for (const anchorId of anchorIds) {
    add({
      requirementId: `identity.anchor.${stableHash(normalize(anchorId))}`,
      domain: "identity",
      target: `Identity and locked appearance match approved anchor ${anchorId}`,
      severity: "hard",
      authority: "approved_reference",
      appliesTo: "both",
      tolerance: "Pose, crop, and lighting may vary; identity-defining shape, product, or brand features may not drift.",
      referenceAnchorIds: [anchorId],
    });
  }

  for (const [path, value] of collectAtomicContractStatements(input.targetContract)) {
    if (isolatedSelfAnchor && /(?:effective|required)[_.]?anchor[_]?ids/i.test(path)) continue;
    const domain = atomicRequirementDomain(`${path} ${value}`);
    const explicitHard = /(?:required|must|lock|exact|visibleevidence|identity|brand|logo|product|subjectcount|personcount|renderingstyle|rendering_style|stylereferencerequired|style_reference_required|必须|必需|锁定|精确|身份|品牌|主体数量|渲染风格)/i.test(path);
    add({
      requirementId: `contract.${normalizeRequirementPath(path)}.${stableHash(normalize(value))}`,
      domain,
      target: value,
      severity: explicitHard ? "hard" : "soft",
      authority: explicitHard ? "structured_contract" : "frame_contract",
      appliesTo: mediaStage,
      tolerance: explicitHard
        ? "Judge the stated visible target only; do not invent stricter geometry, wording, or styling."
        : "Minor decorative, pose, crop, and lighting variation is acceptable when the intended visible meaning remains clear.",
    });
  }

  if (isolatedSelfAnchor) {
    const descriptor = [
      textField(input.targetContract, ["purpose", "purposeZh", "purpose_zh"]),
      textField(input.targetContract, ["productState", "product_state"]),
      textField(input.targetContract, ["characterState", "character_state"]),
      textField(input.targetContract, ["scene"]),
    ].filter(Boolean).join("; ");
    const forbiddenAnchors = readStringList(input.targetContract, ["forbiddenAnchorIds", "forbidden_anchor_ids"]);
    add({
      requirementId: `identity.isolated_target.${stableHash(normalize(isolatedSelfAnchor))}`,
      domain: "identity",
      target: `The current output is the isolated asset ${isolatedSelfAnchor} described by the target contract${descriptor ? `: ${descriptor}` : ""}. The anchor ID is a label for this new asset, not an instruction to copy unrelated content from a project reference.${forbiddenAnchors.length ? ` It must not contain forbidden project anchors: ${forbiddenAnchors.join(", ")}.` : ""}`,
      severity: "hard",
      authority: "structured_contract",
      appliesTo: mediaStage,
      tolerance: "Judge the requested isolated asset against its own target contract and stated reference role only.",
    });
  }

  for (const [index, value] of (input.visualContract?.staticRequirements ?? []).entries()) {
    add({
      requirementId: `static_proxy.${index}.${stableHash(normalize(value))}`,
      domain: atomicRequirementDomain(value),
      target: value,
      severity: "soft",
      authority: "frame_contract",
      appliesTo: "static_image",
      tolerance: "A representative still state is sufficient; motion itself is not required in a static image.",
    });
  }

  return [...requirements.values()].slice(0, 12);
}

export function stableVisualIssueFingerprint(input: {
  requirementId?: string;
  category: GenerationIssueLedgerEntry["category"];
  region?: string;
  defectType?: string;
  summary: string;
}): string {
  if (!input.requirementId) return issueFingerprint(`${input.region ?? ""}|${input.summary}`);
  return [
    normalize(input.requirementId),
    input.category,
    normalizedRegionBucket(input.region),
    normalize(input.defectType ?? "requirement_violation"),
  ].join(":");
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
  evidenceObservations?: VisualEvidenceObservation[];
  invalidIssueTexts?: string[];
}): GenerationIssueLedgerEntry[] {
  const previous = input.previous?.issueLedger ?? [];
  const invalid = new Set((input.invalidIssueTexts ?? []).map(issueFingerprint));
  const current = new Map<string, GenerationIssueLedgerEntry>();
  for (const action of input.correctionActions) {
    const requirementId = /^requirement:(.+)$/i.exec(action.sourceConstraint?.trim() ?? "")?.[1];
    const category = issueCategory(requirementId ? action.element : `${action.element} ${action.observed}`);
    const fingerprint = stableVisualIssueFingerprint({
      requirementId,
      category,
      region: action.region,
      defectType: "requirement_violation",
      summary: action.observed,
    });
    const prior = previous.find((item) => item.fingerprint === fingerprint);
    current.set(fingerprint, {
      issueId: prior?.issueId ?? `issue_${stableHash(fingerprint)}`,
      fingerprint,
      requirementId,
      defectType: "requirement_violation",
      category,
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

function textField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(flattenText).join(" ");
  return "";
}

function collectAtomicContractStatements(
  value: unknown,
  path = "target",
  depth = 0,
): Array<[path: string, value: string]> {
  if (depth > 4) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !atomicContractPathRelevant(path)) return [];
    return [[path, trimmed.slice(0, 420)]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectAtomicContractStatements(item, `${path}.${index}`, depth + 1));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, item]) => collectAtomicContractStatements(item, `${path}.${key}`, depth + 1))
    .slice(0, 24);
}

function atomicContractPathRelevant(path: string): boolean {
  return /required|visible|identity|character|person|product|brand|logo|text|title|ui|score|timer|layout|composition|position|scene|pose|gaze|camera|evidence|subject|appearance|clothing|accessor|rendering|style|medium|dimensionality|shading|edge|surface|depth|构图|人物|角色|产品|品牌|文字|界面|分数|计时|场景|姿态|视线|服装|配饰|渲染|风格|维度|明暗|边缘|材质|深度/i.test(path);
}

function normalizeRequirementPath(path: string): string {
  const normalized = path
    .replace(/^target\./, "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .toLowerCase();
  return normalized.slice(0, 80) || "visible_requirement";
}

function atomicRequirementDomain(value: string): AtomicVisualRequirementDomain {
  if (/logo|brand|text|word|spell|title|文字|字样|品牌|标志/i.test(value)) return "brand_text";
  if (/score|timer|hud|ui|button|分数|计时器|界面|按钮/i.test(value)) return "game_ui";
  if (/hand|finger|limb|anatom|手|指|肢体/i.test(value)) return "anatomy";
  if (/rendering|visual style|style|medium|dimensionality|shading|edge treatment|surface treatment|depth treatment|2d|3d|cgi|vector|cel[- ]?shad|渲染|风格|维度|明暗|边缘|表面|深度/i.test(value)) return "style";
  if (/identity|face|character|person|product|clothing|accessor|身份|人物|角色|脸|产品|服装|配饰/i.test(value)) return "identity";
  if (/layout|composition|position|camera|scene|构图|布局|位置|镜头|场景/i.test(value)) return "layout";
  if (/continuity|previous|boundary|连续|上一|边界/i.test(value)) return "continuity";
  if (/narrative|meaning|evidence|story|叙事|含义|证据|故事/i.test(value)) return "narrative";
  return "artifact";
}

function normalizedRegionBucket(region?: string): string {
  const value = region?.toLowerCase() ?? "";
  if (/top|upper|顶部|上方/.test(value)) return "top";
  if (/bottom|lower|底部|下方/.test(value)) return "bottom";
  if (/left|左/.test(value)) return "left";
  if (/right|右/.test(value)) return "right";
  if (/center|middle|中央|中间/.test(value)) return "center";
  if (/face|head|脸|头/.test(value)) return "face";
  if (/hand|手/.test(value)) return "hand";
  return "global";
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
  if (/rendering|visual style|style|medium|dimensionality|shading|edge treatment|surface treatment|depth treatment|2d|3d|cgi|vector|cel[- ]?shad|渲染|风格|维度|明暗|边缘|表面|深度/i.test(value)) return "style";
  if (/identity|face|character|product|package|身份|人物|脸|产品|包装/i.test(value)) return "identity";
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
