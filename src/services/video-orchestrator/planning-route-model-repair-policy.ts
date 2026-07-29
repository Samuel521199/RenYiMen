import type { PlanningRouteInput } from "./planning-route-input-contract";
import { repairPlanningRouteSimpleErrors } from "./planning-route-deterministic-repair";

export const PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS = {
  GAME_TEMPLATE_AMBIGUOUS: "PLANNING_ROUTE_REPAIR_GAME_TEMPLATE_AMBIGUOUS",
  PRODUCT_BRAND_AMBIGUOUS: "PLANNING_ROUTE_REPAIR_PRODUCT_BRAND_AMBIGUOUS",
  PRODUCT_ECOMMERCE_AMBIGUOUS: "PLANNING_ROUTE_REPAIR_PRODUCT_ECOMMERCE_AMBIGUOUS",
  NONLINEAR_CHRONOLOGY_CONFLICT: "PLANNING_ROUTE_REPAIR_NONLINEAR_CHRONOLOGY_CONFLICT",
  REFERENCE_TEXT_CATEGORY_CONFLICT: "PLANNING_ROUTE_REPAIR_REFERENCE_TEXT_CATEGORY_CONFLICT",
  LOW_CONFIDENCE: "PLANNING_ROUTE_REPAIR_LOW_CONFIDENCE",
} as const;

export type PlanningRouteModelRepairTrigger =
  typeof PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS[keyof typeof PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS];

export const PLANNING_ROUTE_MODEL_REPAIR_MUTABLE_FIELDS = [
  "videoCategory",
  "templateId",
  "chronologyMode",
  "hookMode",
  "hookRevealLevel",
  "requiresReturnPoint",
  "categoryReason",
  "templateReason",
  "chronologyReason",
  "categoryConfidence",
  "templateConfidence",
  "chronologyConfidence",
  "ambiguityCodes",
] as const;

export const PLANNING_ROUTE_MODEL_REPAIR_PROTECTED_FIELDS = [
  "evidence",
  "fallbackUsed",
  "fallbackReason",
  "version",
  "modelName",
  "inputFingerprint",
  "referenceFactFingerprint",
] as const;

const INPUT_FACT_FIELDS = new Set<string>([
  "userCreative",
  "durationSeconds",
  "aspectRatio",
  "stylePreset",
  "hasReferenceImage",
  "referenceFacts",
  "userConstraints",
  "allowedValues",
  "categoryTemplateMap",
]);

const ROUTE_OUTPUT_FIELDS = new Set<string>([
  ...PLANNING_ROUTE_MODEL_REPAIR_MUTABLE_FIELDS,
  ...PLANNING_ROUTE_MODEL_REPAIR_PROTECTED_FIELDS,
]);

const CATEGORY_PATTERNS = {
  game: /\bgame|gameplay|jackpot|bonus\b|游戏|关卡|抽奖|奖励/,
  product: /\bproduct|demo|feature\b|产品|商品|功能|演示/,
  ecommerce: /\be-?commerce|shopping|shop|offer|checkout|buy now\b|电商|购物|下单|购买|促销|优惠/,
  brand: /\bbrand|branding|brand story\b|品牌|品牌故事|形象片/,
} as const;

const NONLINEAR_PATTERN =
  /\bnon[- ]?linear|flashforward|result first|climax first|open with (?:the )?(?:result|climax)\b|非线性|倒叙|高潮前置|结果前置|先展示(?:最终)?结果/;

function parseCanonicalOutput(rawContent: string): Record<string, unknown> | null {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || trimmed.includes("```")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return repairPlanningRouteSimpleErrors(parsed as Record<string, unknown>).value;
  } catch {
    return null;
  }
}

function parseRawOutput(rawContent: string): Record<string, unknown> | null {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || trimmed.includes("```")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function inputText(input: PlanningRouteInput): string {
  return [
    input.userCreative,
    input.stylePreset ?? "",
    ...input.userConstraints,
  ].join(" ").toLowerCase();
}

function textCategorySignals(input: PlanningRouteInput): Set<string> {
  const text = inputText(input);
  return new Set(Object.entries(CATEGORY_PATTERNS)
    .filter(([, pattern]) => pattern.test(text))
    .map(([category]) => category));
}

function ambiguityCodes(output: Record<string, unknown>): Set<string> {
  return new Set(Array.isArray(output.ambiguityCodes)
    ? output.ambiguityCodes.filter((item): item is string => typeof item === "string")
    : []);
}

export interface PlanningRouteModelRepairAssessment {
  allowed: boolean;
  trigger: PlanningRouteModelRepairTrigger | null;
  reason: string;
  baseline: Record<string, unknown> | null;
}

export function assessPlanningRouteModelRepair(params: {
  input: PlanningRouteInput;
  previousOutput: string;
}): PlanningRouteModelRepairAssessment {
  const baseline = parseCanonicalOutput(params.previousOutput);
  if (!baseline) {
    return {
      allowed: false,
      trigger: null,
      reason: "previous output is not a parseable Route Contract, so no approved semantic ambiguity can be established",
      baseline: null,
    };
  }

  const textSignals = textCategorySignals(params.input);
  const referenceSignals = new Set(
    params.input.referenceFacts.categorySignals.filter((item) => item !== "unknown"),
  );
  const ambiguities = ambiguityCodes(baseline);
  const category = baseline.videoCategory;
  const template = baseline.templateId;

  if (
    category === "game"
    && (
      ambiguities.has("TEMPLATE_CONFLICT")
      || template === undefined
      || (template !== "game_reversal" && template !== "game_bonus_payoff")
    )
  ) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.GAME_TEMPLATE_AMBIGUOUS,
      reason: "game route cannot deterministically choose between game_reversal and game_bonus_payoff",
      baseline,
    };
  }

  const combinedSignals = new Set([...textSignals, ...referenceSignals]);
  if (
    ambiguities.has("CATEGORY_CONFLICT")
    && combinedSignals.has("product")
    && combinedSignals.has("brand")
    && (category === "product" || category === "brand")
  ) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.PRODUCT_BRAND_AMBIGUOUS,
      reason: "input evidence leaves the product/brand boundary unresolved",
      baseline,
    };
  }

  if (
    ambiguities.has("CATEGORY_CONFLICT")
    && combinedSignals.has("product")
    && combinedSignals.has("ecommerce")
    && (category === "product" || category === "ecommerce")
  ) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.PRODUCT_ECOMMERCE_AMBIGUOUS,
      reason: "input evidence leaves the product/ecommerce boundary unresolved",
      baseline,
    };
  }

  if (
    NONLINEAR_PATTERN.test(inputText(params.input))
    && (
      ambiguities.has("CHRONOLOGY_CONFLICT")
      || baseline.chronologyMode === "chronological"
    )
  ) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.NONLINEAR_CHRONOLOGY_CONFLICT,
      reason: "the user explicitly requested nonlinear narration but chronology remains conflicting",
      baseline,
    };
  }

  const comparableReferenceSignals = new Set<string>([...referenceSignals]
    .filter((item) => ["game", "product", "ecommerce", "brand"].includes(item)));
  if (
    textSignals.size > 0
    && comparableReferenceSignals.size > 0
    && [...textSignals].every((item) => !comparableReferenceSignals.has(item))
  ) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.REFERENCE_TEXT_CATEGORY_CONFLICT,
      reason: "reference facts and user text provide opposing category evidence",
      baseline,
    };
  }

  const lowConfidenceFields = [
    "categoryConfidence",
    "templateConfidence",
    "chronologyConfidence",
  ].filter((field) => {
    const confidence = baseline[field];
    return typeof confidence === "number" && confidence < 0.55;
  });
  if (lowConfidenceFields.length) {
    return {
      allowed: true,
      trigger: PLANNING_ROUTE_MODEL_REPAIR_TRIGGERS.LOW_CONFIDENCE,
      reason: `route confidence is below 0.55 for ${lowConfidenceFields.join(", ")}`,
      baseline,
    };
  }

  return {
    allowed: false,
    trigger: null,
    reason: "the result does not match any approved model-repair trigger",
    baseline,
  };
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validatePlanningRouteModelRepairMutation(params: {
  previousBaseline: Record<string, unknown>;
  repairedOutput: string;
  expectedMetadata: Record<string, unknown>;
}): string[] {
  const raw = parseRawOutput(params.repairedOutput);
  if (!raw) return ["repair output is not one parseable Route Contract JSON object"];
  const repaired = parseCanonicalOutput(params.repairedOutput);
  if (!repaired) return ["repair output could not be normalized as a Route Contract"];
  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (INPUT_FACT_FIELDS.has(key)) {
      errors.push(`repair output attempted to include or modify input fact field ${key}`);
    } else if (!ROUTE_OUTPUT_FIELDS.has(key)) {
      errors.push(`repair output contains non-whitelisted field ${key}`);
    }
  }
  for (const field of PLANNING_ROUTE_MODEL_REPAIR_PROTECTED_FIELDS) {
    const expected = field in params.expectedMetadata
      ? params.expectedMetadata[field]
      : params.previousBaseline[field];
    if (!equalJson(repaired[field], expected)) {
      errors.push(`repair changed protected field ${field}`);
    }
  }
  return errors;
}
