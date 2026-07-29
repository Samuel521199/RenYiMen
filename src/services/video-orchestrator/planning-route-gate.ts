import {
  resolveChronologyHookPolicy,
  validateChronologyHookPolicy,
} from "./planning-chronology-policy";
import {
  isAllowedCategoryTemplateCombination,
  resolveCategoryTemplateMapping,
  validateNonGameRouteSemantics,
} from "./planning-route-mapping";
import {
  PLANNING_ROUTE_SIMPLE_REPAIR_CODES,
  repairPlanningRouteSimpleErrors,
  type PlanningRouteSimpleRepairAction,
} from "./planning-route-deterministic-repair";
import {
  PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES,
  buildPlanningRouteSafeFallback,
  type PlanningRouteFallbackContext,
  type PlanningRouteSafeFallbackInfo,
} from "./planning-route-safe-fallback";
import type {
  VideoChronologyMode,
  VideoCreativeCategory,
  VideoCreativeTemplateId,
  VideoHookMode,
  VideoHookRevealLevel,
} from "./types";

export type PlanningRouteGateStatus =
  | "allow"
  | "allow_with_warning"
  | "deterministic_repair"
  | "model_repair"
  | "fallback";

export const PLANNING_ROUTE_GATE_ERROR_CODES = {
  JSON_INVALID: "PLANNING_ROUTE_GATE_JSON_INVALID",
  VERSION_INVALID: "PLANNING_ROUTE_GATE_VERSION_INVALID",
  REQUIRED_FIELD_MISSING: "PLANNING_ROUTE_GATE_REQUIRED_FIELD_MISSING",
  FIELD_TYPE_INVALID: "PLANNING_ROUTE_GATE_FIELD_TYPE_INVALID",
  ENUM_INVALID: "PLANNING_ROUTE_GATE_ENUM_INVALID",
  CATEGORY_TEMPLATE_MISMATCH: "PLANNING_ROUTE_GATE_CATEGORY_TEMPLATE_MISMATCH",
  CHRONOLOGY_HOOK_MISMATCH: "PLANNING_ROUTE_GATE_CHRONOLOGY_HOOK_MISMATCH",
  CONFIDENCE_INVALID: "PLANNING_ROUTE_GATE_CONFIDENCE_INVALID",
  FALLBACK_REASON_MISSING: "PLANNING_ROUTE_GATE_FALLBACK_REASON_MISSING",
  EVENT_ID_FORBIDDEN: "PLANNING_ROUTE_GATE_EVENT_ID_FORBIDDEN",
  SCOPE_FIELD_FORBIDDEN: "PLANNING_ROUTE_GATE_SCOPE_FIELD_FORBIDDEN",
  SCOPE_TEXT_SUSPECTED: "PLANNING_ROUTE_GATE_SCOPE_TEXT_SUSPECTED",
  METADATA_MISMATCH: "PLANNING_ROUTE_GATE_METADATA_MISMATCH",
  LOW_CONFIDENCE: "PLANNING_ROUTE_GATE_LOW_CONFIDENCE",
  FIELD_ALIAS_REPAIRED: "PLANNING_ROUTE_GATE_FIELD_ALIAS_REPAIRED",
  ENUM_CASE_REPAIRED: "PLANNING_ROUTE_GATE_ENUM_CASE_REPAIRED",
  UNKNOWN_FIELD_REMOVED: "PLANNING_ROUTE_GATE_UNKNOWN_FIELD_REMOVED",
  DEFAULT_APPLIED: "PLANNING_ROUTE_GATE_DEFAULT_APPLIED",
  UNREQUESTED_FLASHFORWARD_REPAIRED: "PLANNING_ROUTE_GATE_UNREQUESTED_FLASHFORWARD_REPAIRED",
  UNREQUESTED_GAME_CHRONOLOGY_REPAIRED: "PLANNING_ROUTE_GATE_UNREQUESTED_GAME_CHRONOLOGY_REPAIRED",
  AMBIGUITY_NORMALIZED: "PLANNING_ROUTE_GATE_AMBIGUITY_NORMALIZED",
  FIELD_ALIAS_CONFLICT: "PLANNING_ROUTE_GATE_FIELD_ALIAS_CONFLICT",
} as const;

export type PlanningRouteGateErrorCode =
  typeof PLANNING_ROUTE_GATE_ERROR_CODES[keyof typeof PLANNING_ROUTE_GATE_ERROR_CODES];

export type PlanningRouteGateRecoveryAction =
  | "allow"
  | "warn"
  | "overwrite_application_metadata"
  | "select_category_default_template"
  | "apply_chronology_defaults"
  | "clamp_confidence"
  | "synthesize_fallback_reason"
  | "strip_forbidden_fields"
  | "normalize_field_alias"
  | "normalize_enum_case"
  | "remove_unknown_field"
  | "apply_default"
  | "normalize_ambiguity"
  | "request_model_repair"
  | "use_safe_fallback";

export interface PlanningRouteGateIssue {
  code: PlanningRouteGateErrorCode;
  path: string;
  message: string;
  recoveryAction: PlanningRouteGateRecoveryAction;
}

export interface PlanningRouteGateRepair {
  path: string;
  sourcePath?: string;
  ruleCode?: string;
  action: PlanningRouteGateRecoveryAction;
  previousValue: unknown;
  repairedValue: unknown;
}

export interface PlanningRouteExpectedMetadata {
  version: "planning-route-v1";
  modelName: string;
  inputFingerprint: string;
  referenceFactFingerprint: string;
}

export interface PlanningRouteGateResult {
  status: PlanningRouteGateStatus;
  value: Record<string, unknown> | null;
  issues: PlanningRouteGateIssue[];
  repairs: PlanningRouteGateRepair[];
  fallbackInfo?: PlanningRouteSafeFallbackInfo;
}

export const PLANNING_ROUTE_GATE_VALIDATION_ORDER = [
  "json_parse",
  "contract_version",
  "required_fields",
  "enum_values",
  "category_template_mapping",
  "chronology_hook_policy",
  "confidence_range",
  "fallback_reason",
  "event_ids",
  "scope_fields",
] as const;

const REQUIRED_FIELDS = [
  "videoCategory",
  "templateId",
  "chronologyMode",
  "hookMode",
  "hookRevealLevel",
  "requiresReturnPoint",
  "categoryReason",
  "templateReason",
  "chronologyReason",
  "evidence",
  "categoryConfidence",
  "templateConfidence",
  "chronologyConfidence",
  "ambiguityCodes",
  "fallbackUsed",
  "fallbackReason",
  "version",
  "modelName",
  "inputFingerprint",
  "referenceFactFingerprint",
] as const;
const REQUIRED_FIELD_SET = new Set<string>(REQUIRED_FIELDS);

const APPLICATION_METADATA_FIELDS = [
  "version",
  "modelName",
  "inputFingerprint",
  "referenceFactFingerprint",
] as const;

const CATEGORIES = new Set<VideoCreativeCategory>([
  "game",
  "product",
  "ecommerce",
  "food",
  "auto",
  "short_drama",
  "brand",
  "tutorial",
  "custom",
]);
const TEMPLATES = new Set<VideoCreativeTemplateId>([
  "game_reversal",
  "game_bonus_payoff",
  "product_problem_solution",
  "ecommerce_offer_conversion",
  "food_sensory_reaction",
  "auto_performance_hero",
  "short_drama_conflict_twist",
  "generic_brand_story",
]);
const CHRONOLOGY_MODES = new Set<VideoChronologyMode>([
  "chronological",
  "flashforward_hook",
  "result_first",
  "problem_solution",
  "demonstration",
]);
const HOOK_MODES = new Set<VideoHookMode>([
  "pain_point",
  "curiosity",
  "tease",
  "payoff_preview",
]);
const REVEAL_LEVELS = new Set<VideoHookRevealLevel>(["none", "partial", "full"]);
const AMBIGUITY_CODES = new Set([
  "INPUT_TOO_SHORT",
  "INSUFFICIENT_EVIDENCE",
  "CATEGORY_CONFLICT",
  "TEMPLATE_CONFLICT",
  "CHRONOLOGY_CONFLICT",
  "HOOK_ROUTE_CONFLICT",
  "REFERENCE_FACT_CONFLICT",
  "UNSUPPORTED_CATEGORY",
  "UNSUPPORTED_TEMPLATE",
]);

const EVENT_REFERENCE_KEYS = new Set([
  "eventid",
  "eventids",
  "hookeventids",
  "conflicteventids",
  "turningpointeventids",
  "payoffeventids",
  "ctaeventids",
  "returntoeventid",
  "previouseventids",
  "sourceeventids",
  "dependsoneventids",
]);

const SCOPE_FIELD_KEYS = new Set([
  "events",
  "narrativeevents",
  "storybeats",
  "hook",
  "conflict",
  "turningpoint",
  "payoff",
  "cta",
  "logline",
  "script",
  "assets",
  "assetlibrary",
  "anchors",
  "consistencymanifest",
  "assetimagecontract",
  "segments",
  "timeline",
  "timelineblueprint",
  "shots",
  "keyframes",
  "cameragraph",
  "audiobible",
  "soundstrategy",
  "subtitlepolicy",
  "subtitles",
  "imageprompt",
  "keyframeprompt",
  "videoprompt",
]);

const EVENT_ID_VALUE_PATTERN = /\bevent[_-]?\d+\b/i;
const SCOPE_TEXT_PATTERN = /\b(?:camera graph|asset prompt|segment timeline|keyframe prompt|video prompt)\b|镜头脚本|关键帧提示词|资产图片合同|声音合同|字幕合同/i;

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function issue(params: PlanningRouteGateIssue): PlanningRouteGateIssue {
  return params;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function parseRouteJson(rawContent: string): Record<string, unknown> | null {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || trimmed.includes("```")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function simpleRepairActionToGateAction(
  action: PlanningRouteSimpleRepairAction,
): PlanningRouteGateRecoveryAction {
  switch (action) {
    case "rename_field": return "normalize_field_alias";
    case "normalize_enum": return "normalize_enum_case";
    case "remove_unknown_field": return "remove_unknown_field";
    case "normalize_array": return "normalize_ambiguity";
    case "apply_default": return "apply_default";
    case "clamp_number": return "clamp_confidence";
  }
}

function simpleRepairCodeToGateCode(
  code: string,
  sourcePath?: string,
): PlanningRouteGateErrorCode {
  switch (code) {
    case PLANNING_ROUTE_SIMPLE_REPAIR_CODES.FIELD_ALIAS:
      return PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_ALIAS_REPAIRED;
    case PLANNING_ROUTE_SIMPLE_REPAIR_CODES.ENUM_CASE:
      return PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_CASE_REPAIRED;
    case PLANNING_ROUTE_SIMPLE_REPAIR_CODES.UNKNOWN_FIELD_REMOVED:
      if (sourcePath) {
        const key = normalizedKey(sourcePath.split(".").at(-1) ?? "");
        if (EVENT_REFERENCE_KEYS.has(key)) {
          return PLANNING_ROUTE_GATE_ERROR_CODES.EVENT_ID_FORBIDDEN;
        }
        if (SCOPE_FIELD_KEYS.has(key)) {
          return PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_FIELD_FORBIDDEN;
        }
      }
      return PLANNING_ROUTE_GATE_ERROR_CODES.UNKNOWN_FIELD_REMOVED;
    case PLANNING_ROUTE_SIMPLE_REPAIR_CODES.AMBIGUITY_NORMALIZED:
      return PLANNING_ROUTE_GATE_ERROR_CODES.AMBIGUITY_NORMALIZED;
    case PLANNING_ROUTE_SIMPLE_REPAIR_CODES.CONFIDENCE_CLAMPED:
      return PLANNING_ROUTE_GATE_ERROR_CODES.CONFIDENCE_INVALID;
    default:
      return PLANNING_ROUTE_GATE_ERROR_CODES.DEFAULT_APPLIED;
  }
}

function repairField(
  value: Record<string, unknown>,
  repairs: PlanningRouteGateRepair[],
  path: string,
  field: string,
  repairedValue: unknown,
  action: PlanningRouteGateRecoveryAction,
): void {
  const previousValue = value[field];
  value[field] = repairedValue;
  repairs.push({ path, action, previousValue, repairedValue });
}

function stripForbiddenKeys(
  value: unknown,
  forbidden: Set<string>,
  path = "$",
  output: Array<{ path: string; previousValue: unknown }> = [],
): Array<{ path: string; previousValue: unknown }> {
  if (Array.isArray(value)) {
    value.forEach((item, index) => stripForbiddenKeys(item, forbidden, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (forbidden.has(normalizedKey(key))) {
      output.push({ path: childPath, previousValue: child });
      delete record[key];
      continue;
    }
    stripForbiddenKeys(child, forbidden, childPath, output);
  }
  return output;
}

function containsForbiddenString(value: unknown, pattern: RegExp): boolean {
  if (typeof value === "string") return pattern.test(value);
  if (Array.isArray(value)) return value.some((item) => containsForbiddenString(item, pattern));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .some((item) => containsForbiddenString(item, pattern));
  }
  return false;
}

function buildGateFallback(params: {
  metadata: PlanningRouteExpectedMetadata;
  issues: PlanningRouteGateIssue[];
  context?: PlanningRouteFallbackContext;
}): ReturnType<typeof buildPlanningRouteSafeFallback> {
  return buildPlanningRouteSafeFallback({
    metadata: params.metadata,
    context: {
      ...params.context,
      reasons: [
        ...(params.context?.reasons ?? []),
        PLANNING_ROUTE_FALLBACK_REASON_TEMPLATES.INVALID_MODEL_RESULT,
        ...params.issues.map((item) => `${item.code} ${item.path}: ${item.message}`),
      ],
    },
  });
}

export function evaluatePlanningRouteGate(params: {
  rawContent: string;
  expectedMetadata: PlanningRouteExpectedMetadata;
  modelRepairAvailable: boolean;
  fallbackContext?: PlanningRouteFallbackContext;
  allowFlashforwardHook?: boolean;
  enforceChronologicalForGameWhenUnspecified?: boolean;
}): PlanningRouteGateResult {
  const issues: PlanningRouteGateIssue[] = [];
  const repairs: PlanningRouteGateRepair[] = [];
  let needsModelRepair = false;
  const parsed = parseRouteJson(params.rawContent);
  if (!parsed) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.JSON_INVALID,
      path: "$",
      message: "response is not one parseable JSON object",
      recoveryAction: params.modelRepairAvailable ? "request_model_repair" : "use_safe_fallback",
    }));
    return params.modelRepairAvailable
      ? { status: "model_repair", value: null, issues, repairs }
      : (() => {
          const fallback = buildGateFallback({
            metadata: params.expectedMetadata,
            issues,
            context: params.fallbackContext,
          });
          return {
          status: "fallback",
          value: fallback.value,
          issues,
          repairs,
          fallbackInfo: fallback.info,
          } as PlanningRouteGateResult;
        })();
  }
  const simpleRepair = repairPlanningRouteSimpleErrors(parsed);
  for (const repaired of simpleRepair.repairs) {
    const action = simpleRepairActionToGateAction(repaired.action);
    issues.push(issue({
      code: simpleRepairCodeToGateCode(repaired.ruleCode, repaired.sourcePath),
      path: repaired.targetPath,
      message: `deterministic repair applied: ${repaired.ruleCode}`,
      recoveryAction: action,
    }));
    repairs.push({
      path: repaired.targetPath,
      sourcePath: repaired.sourcePath,
      ruleCode: repaired.ruleCode,
      action,
      previousValue: repaired.before,
      repairedValue: repaired.after,
    });
  }
  for (const conflict of simpleRepair.conflicts) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_ALIAS_CONFLICT,
      path: conflict.sourcePath,
      message: conflict.message,
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }

  // Re-serialize and parse so every repaired result restarts the complete Gate
  // against the same JSON boundary as an untouched model response.
  const reparsed = parseRouteJson(JSON.stringify(simpleRepair.value));
  if (!reparsed) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.JSON_INVALID,
      path: "$",
      message: "deterministically repaired result could not be serialized as one JSON object",
      recoveryAction: params.modelRepairAvailable ? "request_model_repair" : "use_safe_fallback",
    }));
    return params.modelRepairAvailable
      ? { status: "model_repair", value: null, issues, repairs }
      : (() => {
          const fallback = buildGateFallback({
            metadata: params.expectedMetadata,
            issues,
            context: params.fallbackContext,
          });
          return {
          status: "fallback",
          value: fallback.value,
          issues,
          repairs,
          fallbackInfo: fallback.info,
          } as PlanningRouteGateResult;
        })();
  }
  const value = cloneRecord(reparsed);

  // 2. Contract version and application-owned metadata.
  if (value.version !== params.expectedMetadata.version) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.VERSION_INVALID,
      path: "$.version",
      message: "contract version does not match planning-route-v1",
      recoveryAction: "overwrite_application_metadata",
    }));
    repairField(value, repairs, "$.version", "version", params.expectedMetadata.version, "overwrite_application_metadata");
  }
  for (const field of APPLICATION_METADATA_FIELDS.slice(1)) {
    if (value[field] !== params.expectedMetadata[field]) {
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.METADATA_MISMATCH,
        path: `$.${field}`,
        message: `${field} does not match application-owned metadata`,
        recoveryAction: "overwrite_application_metadata",
      }));
      repairField(
        value,
        repairs,
        `$.${field}`,
        field,
        params.expectedMetadata[field],
        "overwrite_application_metadata",
      );
    }
  }

  // 3. Required fields.
  for (const field of REQUIRED_FIELDS) {
    if (field in value) continue;
    if ((APPLICATION_METADATA_FIELDS as readonly string[]).includes(field)) continue;
    if (field === "fallbackReason") continue;
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.REQUIRED_FIELD_MISSING,
      path: `$.${field}`,
      message: `required field ${field} is missing`,
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }
  for (const field of ["categoryReason", "templateReason", "chronologyReason"] as const) {
    if (field in value && (typeof value[field] !== "string" || !value[field].trim())) {
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_TYPE_INVALID,
        path: `$.${field}`,
        message: `${field} must be a non-empty string`,
        recoveryAction: "request_model_repair",
      }));
      needsModelRepair = true;
    }
  }
  if ("evidence" in value && (!Array.isArray(value.evidence) || value.evidence.length < 1)) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_TYPE_INVALID,
      path: "$.evidence",
      message: "evidence must be a non-empty array",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }

  // 4. Enum values.
  const category = CATEGORIES.has(value.videoCategory as VideoCreativeCategory)
    ? value.videoCategory as VideoCreativeCategory
    : undefined;
  let templateId = TEMPLATES.has(value.templateId as VideoCreativeTemplateId)
    ? value.templateId as VideoCreativeTemplateId
    : undefined;
  let chronologyMode = CHRONOLOGY_MODES.has(value.chronologyMode as VideoChronologyMode)
    ? value.chronologyMode as VideoChronologyMode
    : undefined;
  let hookMode = HOOK_MODES.has(value.hookMode as VideoHookMode)
    ? value.hookMode as VideoHookMode
    : undefined;
  let revealLevel = REVEAL_LEVELS.has(value.hookRevealLevel as VideoHookRevealLevel)
    ? value.hookRevealLevel as VideoHookRevealLevel
    : undefined;

  if (!category) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
      path: "$.videoCategory",
      message: "videoCategory is not a legal enum value",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }
  if (!templateId && category) {
    const resolved = resolveCategoryTemplateMapping({ videoCategory: category });
    templateId = resolved.templateId;
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
      path: "$.templateId",
      message: "templateId is invalid; selected the category default",
      recoveryAction: "select_category_default_template",
    }));
    repairField(value, repairs, "$.templateId", "templateId", templateId, "select_category_default_template");
  } else if (!templateId) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
      path: "$.templateId",
      message: "templateId is not a legal enum value",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }
  if (!chronologyMode) {
    chronologyMode = "chronological";
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
      path: "$.chronologyMode",
      message: "chronologyMode is invalid; using chronological",
      recoveryAction: "apply_chronology_defaults",
    }));
    repairField(value, repairs, "$.chronologyMode", "chronologyMode", chronologyMode, "apply_chronology_defaults");
  }
  if (!hookMode || !revealLevel || typeof value.requiresReturnPoint !== "boolean") {
    const resolved = resolveChronologyHookPolicy({ chronologyMode });
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
      path: "$.hookMode",
      message: "Hook policy fields are invalid; applying chronology defaults",
      recoveryAction: "apply_chronology_defaults",
    }));
    if (value.hookMode !== resolved.hookMode) {
      repairField(value, repairs, "$.hookMode", "hookMode", resolved.hookMode, "apply_chronology_defaults");
    }
    if (value.hookRevealLevel !== resolved.hookRevealLevel) {
      repairField(value, repairs, "$.hookRevealLevel", "hookRevealLevel", resolved.hookRevealLevel, "apply_chronology_defaults");
    }
    if (value.requiresReturnPoint !== resolved.requiresReturnPoint) {
      repairField(value, repairs, "$.requiresReturnPoint", "requiresReturnPoint", resolved.requiresReturnPoint, "apply_chronology_defaults");
    }
    hookMode = resolved.hookMode;
    revealLevel = resolved.hookRevealLevel;
  }
  if (Array.isArray(value.ambiguityCodes)) {
    const filtered = value.ambiguityCodes
      .filter((item): item is string => typeof item === "string" && AMBIGUITY_CODES.has(item));
    if (filtered.length !== value.ambiguityCodes.length) {
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.ENUM_INVALID,
        path: "$.ambiguityCodes",
        message: "ambiguityCodes contained unsupported values",
        recoveryAction: "strip_forbidden_fields",
      }));
      repairField(value, repairs, "$.ambiguityCodes", "ambiguityCodes", filtered, "strip_forbidden_fields");
    }
  } else if ("ambiguityCodes" in value) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_TYPE_INVALID,
      path: "$.ambiguityCodes",
      message: "ambiguityCodes must be an array",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }

  // 5. Category/template mapping.
  if (category && templateId && !isAllowedCategoryTemplateCombination(category, templateId)) {
    const resolved = resolveCategoryTemplateMapping({
      videoCategory: category,
      templateId,
      semanticText: [value.categoryReason, value.templateReason].filter((item) => typeof item === "string").join(" "),
    });
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.CATEGORY_TEMPLATE_MISMATCH,
      path: "$.templateId",
      message: `templateId ${templateId} is not allowed for videoCategory ${category}`,
      recoveryAction: "select_category_default_template",
    }));
    repairField(
      value,
      repairs,
      "$.templateId",
      "templateId",
      resolved.templateId,
      "select_category_default_template",
    );
    templateId = resolved.templateId;
  }

  // 6. Chronology/Hook policy.
  if (
    category === "game"
    && chronologyMode
    && chronologyMode !== "chronological"
    && params.enforceChronologicalForGameWhenUnspecified === true
  ) {
    const resolved = resolveChronologyHookPolicy({ chronologyMode: "chronological" });
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.UNREQUESTED_GAME_CHRONOLOGY_REPAIRED,
      path: "$.chronologyMode",
      message: "game routes default to chronological when the user provides no explicit chronology or demonstration intent",
      recoveryAction: "apply_chronology_defaults",
    }));
    for (const [field, repairedValue] of [
      ["chronologyMode", "chronological"],
      ["hookMode", resolved.hookMode],
      ["hookRevealLevel", resolved.hookRevealLevel],
      ["requiresReturnPoint", resolved.requiresReturnPoint],
      ["chronologyReason", "用户未指定非线性、结果前置或玩法演示结构，因此游戏广告使用默认顺叙。"],
    ] as const) {
      if (value[field] !== repairedValue) {
        repairField(
          value,
          repairs,
          `$.${field}`,
          field,
          repairedValue,
          "apply_chronology_defaults",
        );
      }
    }
    chronologyMode = "chronological";
    hookMode = resolved.hookMode;
    revealLevel = resolved.hookRevealLevel;
  }
  if (chronologyMode === "flashforward_hook" && params.allowFlashforwardHook === false) {
    const resolved = resolveChronologyHookPolicy({ chronologyMode: "chronological" });
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.UNREQUESTED_FLASHFORWARD_REPAIRED,
      path: "$.chronologyMode",
      message: "flashforward_hook requires an explicit user request for climax/result preview and a return to earlier time",
      recoveryAction: "apply_chronology_defaults",
    }));
    for (const [field, repairedValue] of [
      ["chronologyMode", "chronological"],
      ["hookMode", resolved.hookMode],
      ["hookRevealLevel", resolved.hookRevealLevel],
      ["requiresReturnPoint", resolved.requiresReturnPoint],
      ["chronologyReason", "用户未明确要求高潮或结果前置，因此使用默认顺叙。"],
    ] as const) {
      if (value[field] !== repairedValue) {
        repairField(
          value,
          repairs,
          `$.${field}`,
          field,
          repairedValue,
          "apply_chronology_defaults",
        );
      }
    }
    chronologyMode = "chronological";
    hookMode = resolved.hookMode;
    revealLevel = resolved.hookRevealLevel;
  }
  if (chronologyMode && hookMode && revealLevel && typeof value.requiresReturnPoint === "boolean") {
    const policyIssues = validateChronologyHookPolicy({
      chronologyMode,
      hookMode,
      hookRevealLevel: revealLevel,
      requiresReturnPoint: value.requiresReturnPoint,
    });
    if (policyIssues.length) {
      const resolved = resolveChronologyHookPolicy({
        chronologyMode,
        hookMode,
        hookRevealLevel: revealLevel,
        requiresReturnPoint: value.requiresReturnPoint,
      });
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.CHRONOLOGY_HOOK_MISMATCH,
        path: "$.chronologyMode",
        message: policyIssues.map((item) => item.message).join("; "),
        recoveryAction: "apply_chronology_defaults",
      }));
      for (const [field, repairedValue] of [
        ["hookMode", resolved.hookMode],
        ["hookRevealLevel", resolved.hookRevealLevel],
        ["requiresReturnPoint", resolved.requiresReturnPoint],
      ] as const) {
        if (value[field] !== repairedValue) {
          repairField(
            value,
            repairs,
            `$.${field}`,
            field,
            repairedValue,
            "apply_chronology_defaults",
          );
        }
      }
    }
  }

  // 7. Confidence ranges.
  for (const field of ["categoryConfidence", "templateConfidence", "chronologyConfidence"] as const) {
    const confidence = value[field];
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
      if (field in value) {
        issues.push(issue({
          code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_TYPE_INVALID,
          path: `$.${field}`,
          message: `${field} must be a finite number`,
          recoveryAction: "request_model_repair",
        }));
        needsModelRepair = true;
      }
      continue;
    }
    if (confidence < 0 || confidence > 1) {
      const repaired = Math.min(1, Math.max(0, confidence));
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.CONFIDENCE_INVALID,
        path: `$.${field}`,
        message: `${field} must be between 0 and 1`,
        recoveryAction: "clamp_confidence",
      }));
      repairField(value, repairs, `$.${field}`, field, repaired, "clamp_confidence");
    } else if (confidence < 0.55) {
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.LOW_CONFIDENCE,
        path: `$.${field}`,
        message: `${field} is below the 0.55 warning threshold`,
        recoveryAction: "warn",
      }));
    }
  }

  // 8. Fallback reason consistency.
  if (typeof value.fallbackUsed !== "boolean" && "fallbackUsed" in value) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.FIELD_TYPE_INVALID,
      path: "$.fallbackUsed",
      message: "fallbackUsed must be boolean",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  } else if (value.fallbackUsed === true && (typeof value.fallbackReason !== "string" || !value.fallbackReason.trim())) {
    const reason = "模型启用了 fallback，但未提供原因；由 Route Gate 补充安全回退说明。";
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.FALLBACK_REASON_MISSING,
      path: "$.fallbackReason",
      message: "fallbackUsed=true requires a non-empty fallbackReason",
      recoveryAction: "synthesize_fallback_reason",
    }));
    repairField(value, repairs, "$.fallbackReason", "fallbackReason", reason, "synthesize_fallback_reason");
  } else if (value.fallbackUsed === false && value.fallbackReason !== null) {
    repairField(value, repairs, "$.fallbackReason", "fallbackReason", null, "synthesize_fallback_reason");
  }

  // 9. Event IDs.
  const eventFields = stripForbiddenKeys(value, EVENT_REFERENCE_KEYS);
  for (const removed of eventFields) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.EVENT_ID_FORBIDDEN,
      path: removed.path,
      message: "Route Contract must not contain event IDs or event references",
      recoveryAction: "strip_forbidden_fields",
    }));
    repairs.push({
      path: removed.path,
      action: "strip_forbidden_fields",
      previousValue: removed.previousValue,
      repairedValue: undefined,
    });
  }
  if (containsForbiddenString(value, EVENT_ID_VALUE_PATTERN)) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.EVENT_ID_FORBIDDEN,
      path: "$",
      message: "Route Contract contains an event-like ID inside an allowed field",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }

  // 10. Story/asset/timeline scope.
  const scopeFields = stripForbiddenKeys(value, SCOPE_FIELD_KEYS);
  for (const removed of scopeFields) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_FIELD_FORBIDDEN,
      path: removed.path,
      message: "Route Contract contains story, asset, timeline, audio, subtitle, or prompt fields",
      recoveryAction: "strip_forbidden_fields",
    }));
    repairs.push({
      path: removed.path,
      action: "strip_forbidden_fields",
      previousValue: removed.previousValue,
      repairedValue: undefined,
    });
  }
  for (const field of Object.keys(value).filter((key) => !REQUIRED_FIELD_SET.has(key))) {
    const path = `$.${field}`;
    const previousValue = value[field];
    delete value[field];
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_FIELD_FORBIDDEN,
      path,
      message: `Route Contract contains unexpected top-level field ${field}`,
      recoveryAction: "strip_forbidden_fields",
    }));
    repairs.push({
      path,
      action: "strip_forbidden_fields",
      previousValue,
      repairedValue: undefined,
    });
  }
  if (containsForbiddenString(value, SCOPE_TEXT_PATTERN)) {
    issues.push(issue({
      code: PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_TEXT_SUSPECTED,
      path: "$",
      message: "Route Contract text appears to contain downstream story or production instructions",
      recoveryAction: "request_model_repair",
    }));
    needsModelRepair = true;
  }
  if (category) {
    const semanticIssues = validateNonGameRouteSemantics(
      category,
      [value.categoryReason, value.templateReason, value.chronologyReason]
        .filter((item): item is string => typeof item === "string")
        .join(" "),
    );
    if (semanticIssues.length) {
      issues.push(issue({
        code: PLANNING_ROUTE_GATE_ERROR_CODES.SCOPE_TEXT_SUSPECTED,
        path: "$.templateReason",
        message: semanticIssues.map((item) => item.message).join("; "),
        recoveryAction: "request_model_repair",
      }));
      needsModelRepair = true;
    }
  }

  if (needsModelRepair) {
    return params.modelRepairAvailable
      ? { status: "model_repair", value: null, issues, repairs }
      : (() => {
          const fallbackIssues = issues.map((item) =>
            item.recoveryAction === "request_model_repair"
              ? { ...item, recoveryAction: "use_safe_fallback" as const }
              : item);
          const fallback = buildGateFallback({
            metadata: params.expectedMetadata,
            issues: fallbackIssues,
            context: params.fallbackContext,
          });
          return {
          status: "fallback",
          value: fallback.value,
          issues: fallbackIssues,
          repairs,
          fallbackInfo: fallback.info,
          } as PlanningRouteGateResult;
        })();
  }
  if (repairs.length) return { status: "deterministic_repair", value, issues, repairs };
  if (value.fallbackUsed === true) {
    const fallbackInfo = buildPlanningRouteSafeFallback({
      metadata: params.expectedMetadata,
      context: {
        reasons: typeof value.fallbackReason === "string" ? [value.fallbackReason] : [],
        inputConflicts: Array.isArray(value.ambiguityCodes)
          && value.ambiguityCodes.includes("CATEGORY_CONFLICT")
          ? ["模型报告品类输入存在冲突"]
          : [],
      },
    }).info;
    return { status: "fallback", value, issues, repairs, fallbackInfo };
  }
  if (issues.some((item) => item.recoveryAction === "warn")) {
    return { status: "allow_with_warning", value, issues, repairs };
  }
  return { status: "allow", value, issues, repairs };
}
