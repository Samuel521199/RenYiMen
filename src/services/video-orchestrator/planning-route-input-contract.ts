import {
  PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP,
} from "./planning-route-mapping";
import type {
  VideoChronologyMode,
  VideoCreativeCategory,
  VideoCreativeTemplateId,
  VideoHookMode,
  VideoHookRevealLevel,
} from "./types";

export const PLANNING_ROUTE_INPUT_VERSION = "planning-route-v1-input" as const;

export const PLANNING_ROUTE_INPUT_BUDGET = {
  totalSerializedChars: 10_000,
  userCreativeChars: 4_000,
  stylePresetChars: 120,
  userConstraintCount: 12,
  userConstraintCharsEach: 300,
  userConstraintsTotalChars: 2_000,
  referenceFactsSerializedChars: 800,
} as const;

export const PLANNING_ROUTE_INPUT_ERROR_CODES = {
  UNKNOWN_FIELD: "PLANNING_ROUTE_INPUT_UNKNOWN_FIELD",
  FORBIDDEN_FIELD: "PLANNING_ROUTE_INPUT_FORBIDDEN_FIELD",
  INVALID_FIELD: "PLANNING_ROUTE_INPUT_INVALID_FIELD",
  FIELD_BUDGET_EXCEEDED: "PLANNING_ROUTE_INPUT_FIELD_BUDGET_EXCEEDED",
  TOTAL_BUDGET_EXCEEDED: "PLANNING_ROUTE_INPUT_TOTAL_BUDGET_EXCEEDED",
} as const;

export type PlanningRouteInputErrorCode =
  typeof PLANNING_ROUTE_INPUT_ERROR_CODES[keyof typeof PLANNING_ROUTE_INPUT_ERROR_CODES];

export class PlanningRouteInputContractError extends Error {
  readonly code: PlanningRouteInputErrorCode;
  readonly paths: string[];

  constructor(code: PlanningRouteInputErrorCode, message: string, paths: string[] = []) {
    super(message);
    this.name = "PlanningRouteInputContractError";
    this.code = code;
    this.paths = paths;
  }
}

export const PLANNING_ROUTE_INPUT_FORBIDDEN_FIELDS = [
  "assetLibrary",
  "assetDescription",
  "assetDescriptions",
  "consistencyManifest",
  "referenceAnalysis",
  "fullReferenceAnalysis",
  "referenceImages",
  "referenceImageUrls",
  "assetImageContract",
  "assetImagePrompt",
  "imagePrompt",
  "cameraGraph",
  "segments",
  "timeline",
  "timelineBlueprint",
  "audioBible",
  "audioContract",
  "soundContract",
  "subtitlePolicy",
  "subtitleContract",
  "keyframes",
  "keyframeRequirements",
  "provider",
  "providerCapabilities",
  "shotDecomposerContract",
  "storyboardBrief",
  "storyBeats",
  "narrativeEvents",
] as const;

const ROUTE_INPUT_SOURCE_FIELDS = new Set([
  "userCreative",
  "durationSeconds",
  "aspectRatio",
  "stylePreset",
  "hasReferenceImage",
  "referenceFacts",
  "userConstraints",
]);

const VIDEO_CATEGORIES = [
  "game",
  "product",
  "ecommerce",
  "food",
  "auto",
  "short_drama",
  "brand",
  "tutorial",
  "custom",
] as const satisfies readonly VideoCreativeCategory[];

const TEMPLATE_IDS = [
  "game_reversal",
  "game_bonus_payoff",
  "product_problem_solution",
  "ecommerce_offer_conversion",
  "food_sensory_reaction",
  "auto_performance_hero",
  "short_drama_conflict_twist",
  "generic_brand_story",
] as const satisfies readonly VideoCreativeTemplateId[];

const CHRONOLOGY_MODES = [
  "chronological",
  "flashforward_hook",
  "result_first",
  "problem_solution",
  "demonstration",
] as const satisfies readonly VideoChronologyMode[];

const HOOK_MODES = [
  "pain_point",
  "curiosity",
  "tease",
  "payoff_preview",
] as const satisfies readonly VideoHookMode[];

const HOOK_REVEAL_LEVELS = [
  "none",
  "partial",
  "full",
] as const satisfies readonly VideoHookRevealLevel[];

export const PLANNING_ROUTE_REFERENCE_SUBJECT_TYPES = [
  "person",
  "game_ui",
  "product",
  "food",
  "vehicle",
  "scene",
  "brand_mark",
  "other",
] as const;

export type PlanningRouteReferenceSubjectType =
  typeof PLANNING_ROUTE_REFERENCE_SUBJECT_TYPES[number];

export const PLANNING_ROUTE_REFERENCE_CATEGORY_SIGNALS = [
  "game",
  "product",
  "food",
  "auto",
  "ecommerce",
  "brand",
  "tutorial",
  "unknown",
] as const;

export type PlanningRouteReferenceCategorySignal =
  typeof PLANNING_ROUTE_REFERENCE_CATEGORY_SIGNALS[number];

export interface PlanningRouteReferenceFacts {
  subjectTypes: PlanningRouteReferenceSubjectType[];
  categorySignals: PlanningRouteReferenceCategorySignal[];
  containsUi: boolean;
  containsBrandElements: boolean;
  containsPeople: boolean;
  hasExplicitAdCategorySignals: boolean;
}

export interface PlanningRouteInput {
  version: typeof PLANNING_ROUTE_INPUT_VERSION;
  userCreative: string;
  durationSeconds: number | null;
  aspectRatio: string | null;
  stylePreset: string | null;
  hasReferenceImage: boolean;
  referenceFacts: PlanningRouteReferenceFacts;
  userConstraints: string[];
  allowedValues: {
    videoCategories: VideoCreativeCategory[];
    templateIds: VideoCreativeTemplateId[];
    chronologyModes: VideoChronologyMode[];
    hookModes: VideoHookMode[];
    hookRevealLevels: VideoHookRevealLevel[];
  };
  categoryTemplateMap: Record<VideoCreativeCategory, VideoCreativeTemplateId[]>;
}

function normalizedFieldKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

const FORBIDDEN_NORMALIZED_KEYS = new Set(
  PLANNING_ROUTE_INPUT_FORBIDDEN_FIELDS.map(normalizedFieldKey),
);

export function findForbiddenPlanningRouteInputFields(
  value: unknown,
  path = "$",
  output: string[] = [],
): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenPlanningRouteInputFields(item, `${path}[${index}]`, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_NORMALIZED_KEYS.has(normalizedFieldKey(key))) output.push(childPath);
    findForbiddenPlanningRouteInputFields(child, childPath, output);
  }
  return output;
}

function normalizeEnumList<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set<string>(allowed);
  return [...new Set(value.filter((item): item is T => typeof item === "string" && allowedSet.has(item)))];
}

export function compressPlanningRouteReferenceFacts(
  source: unknown,
  hasReferenceImage: boolean,
): PlanningRouteReferenceFacts {
  if (!hasReferenceImage) {
    return {
      subjectTypes: [],
      categorySignals: [],
      containsUi: false,
      containsBrandElements: false,
      containsPeople: false,
      hasExplicitAdCategorySignals: false,
    };
  }
  const raw = source && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
  const subjectTypes = normalizeEnumList(raw.subjectTypes, PLANNING_ROUTE_REFERENCE_SUBJECT_TYPES);
  const categorySignals = normalizeEnumList(raw.categorySignals, PLANNING_ROUTE_REFERENCE_CATEGORY_SIGNALS);
  const facts: PlanningRouteReferenceFacts = {
    subjectTypes,
    categorySignals,
    containsUi: raw.containsUi === true || subjectTypes.includes("game_ui"),
    containsBrandElements: raw.containsBrandElements === true || subjectTypes.includes("brand_mark"),
    containsPeople: raw.containsPeople === true || subjectTypes.includes("person"),
    hasExplicitAdCategorySignals: raw.hasExplicitAdCategorySignals === true,
  };
  const serializedChars = JSON.stringify(facts).length;
  if (serializedChars > PLANNING_ROUTE_INPUT_BUDGET.referenceFactsSerializedChars) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `referenceFacts exceeds ${PLANNING_ROUTE_INPUT_BUDGET.referenceFactsSerializedChars} serialized characters`,
      ["$.referenceFacts"],
    );
  }
  return facts;
}

function requiredNonEmptyString(value: unknown, field: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      `${field} must be a non-empty string`,
      [`$.${field}`],
    );
  }
  const normalized = value.trim();
  if (normalized.length > maxChars) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `${field} exceeds ${maxChars} characters`,
      [`$.${field}`],
    );
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxChars: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      `${field} must be a string or null`,
      [`$.${field}`],
    );
  }
  const normalized = value.trim();
  if (normalized.length > maxChars) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `${field} exceeds ${maxChars} characters`,
      [`$.${field}`],
    );
  }
  return normalized || null;
}

function normalizeUserConstraints(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      "userConstraints must be an array of strings",
      ["$.userConstraints"],
    );
  }
  const constraints = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  if (constraints.length > PLANNING_ROUTE_INPUT_BUDGET.userConstraintCount) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `userConstraints exceeds ${PLANNING_ROUTE_INPUT_BUDGET.userConstraintCount} items`,
      ["$.userConstraints"],
    );
  }
  if (constraints.some((item) => item.length > PLANNING_ROUTE_INPUT_BUDGET.userConstraintCharsEach)) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `a user constraint exceeds ${PLANNING_ROUTE_INPUT_BUDGET.userConstraintCharsEach} characters`,
      ["$.userConstraints"],
    );
  }
  if (constraints.reduce((sum, item) => sum + item.length, 0) > PLANNING_ROUTE_INPUT_BUDGET.userConstraintsTotalChars) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FIELD_BUDGET_EXCEEDED,
      `userConstraints exceeds ${PLANNING_ROUTE_INPUT_BUDGET.userConstraintsTotalChars} total characters`,
      ["$.userConstraints"],
    );
  }
  return constraints;
}

export function buildPlanningRouteInput(source: Record<string, unknown>): PlanningRouteInput {
  const forbiddenPaths = findForbiddenPlanningRouteInputFields(source);
  if (forbiddenPaths.length) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.FORBIDDEN_FIELD,
      `forbidden route input fields: ${forbiddenPaths.join(", ")}`,
      forbiddenPaths,
    );
  }
  const unknownFields = Object.keys(source)
    .filter((field) => !ROUTE_INPUT_SOURCE_FIELDS.has(field))
    .map((field) => `$.${field}`);
  if (unknownFields.length) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.UNKNOWN_FIELD,
      `unknown route input fields: ${unknownFields.join(", ")}`,
      unknownFields,
    );
  }

  if (typeof source.hasReferenceImage !== "boolean") {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      "hasReferenceImage must be a boolean",
      ["$.hasReferenceImage"],
    );
  }
  const durationSeconds = source.durationSeconds === undefined || source.durationSeconds === null
    ? null
    : Number(source.durationSeconds);
  if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600)) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      "durationSeconds must be greater than 0 and at most 3600",
      ["$.durationSeconds"],
    );
  }
  const aspectRatio = optionalString(source.aspectRatio, "aspectRatio", 20);
  if (aspectRatio && !/^[1-9][0-9]*:[1-9][0-9]*$/.test(aspectRatio)) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.INVALID_FIELD,
      "aspectRatio must use W:H format",
      ["$.aspectRatio"],
    );
  }

  const result: PlanningRouteInput = {
    version: PLANNING_ROUTE_INPUT_VERSION,
    userCreative: requiredNonEmptyString(
      source.userCreative,
      "userCreative",
      PLANNING_ROUTE_INPUT_BUDGET.userCreativeChars,
    ),
    durationSeconds,
    aspectRatio,
    stylePreset: optionalString(
      source.stylePreset,
      "stylePreset",
      PLANNING_ROUTE_INPUT_BUDGET.stylePresetChars,
    ),
    hasReferenceImage: source.hasReferenceImage,
    referenceFacts: compressPlanningRouteReferenceFacts(
      source.referenceFacts,
      source.hasReferenceImage,
    ),
    userConstraints: normalizeUserConstraints(source.userConstraints),
    allowedValues: {
      videoCategories: [...VIDEO_CATEGORIES],
      templateIds: [...TEMPLATE_IDS],
      chronologyModes: [...CHRONOLOGY_MODES],
      hookModes: [...HOOK_MODES],
      hookRevealLevels: [...HOOK_REVEAL_LEVELS],
    },
    categoryTemplateMap: Object.fromEntries(
      Object.entries(PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP)
        .map(([category, templates]) => [category, [...templates]]),
    ) as Record<VideoCreativeCategory, VideoCreativeTemplateId[]>,
  };

  const serializedChars = JSON.stringify(result).length;
  if (serializedChars > PLANNING_ROUTE_INPUT_BUDGET.totalSerializedChars) {
    throw new PlanningRouteInputContractError(
      PLANNING_ROUTE_INPUT_ERROR_CODES.TOTAL_BUDGET_EXCEEDED,
      `planning route input exceeds ${PLANNING_ROUTE_INPUT_BUDGET.totalSerializedChars} serialized characters`,
      ["$"],
    );
  }
  return result;
}
