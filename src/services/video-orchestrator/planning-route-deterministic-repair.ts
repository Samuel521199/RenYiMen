import { allowedTemplatesForCategory } from "./planning-route-mapping";
import type {
  VideoCreativeCategory,
  VideoCreativeTemplateId,
} from "./types";

export const PLANNING_ROUTE_SIMPLE_REPAIR_CODES = {
  FIELD_ALIAS: "PLANNING_ROUTE_REPAIR_FIELD_ALIAS",
  ENUM_CASE: "PLANNING_ROUTE_REPAIR_ENUM_CASE",
  UNKNOWN_FIELD_REMOVED: "PLANNING_ROUTE_REPAIR_UNKNOWN_FIELD_REMOVED",
  DEFAULT_CHRONOLOGY: "PLANNING_ROUTE_REPAIR_DEFAULT_CHRONOLOGY",
  UNIQUE_TEMPLATE: "PLANNING_ROUTE_REPAIR_UNIQUE_TEMPLATE",
  DEFAULT_HOOK_POLICY: "PLANNING_ROUTE_REPAIR_DEFAULT_HOOK_POLICY",
  CONFIDENCE_CLAMPED: "PLANNING_ROUTE_REPAIR_CONFIDENCE_CLAMPED",
  AMBIGUITY_NORMALIZED: "PLANNING_ROUTE_REPAIR_AMBIGUITY_NORMALIZED",
  ALIAS_CONFLICT: "PLANNING_ROUTE_REPAIR_ALIAS_CONFLICT",
} as const;

export type PlanningRouteSimpleRepairCode =
  typeof PLANNING_ROUTE_SIMPLE_REPAIR_CODES[keyof typeof PLANNING_ROUTE_SIMPLE_REPAIR_CODES];

export type PlanningRouteSimpleRepairAction =
  | "rename_field"
  | "normalize_enum"
  | "remove_unknown_field"
  | "apply_default"
  | "clamp_number"
  | "normalize_array";

export interface PlanningRouteSimpleRepairRecord {
  ruleCode: Exclude<PlanningRouteSimpleRepairCode, "PLANNING_ROUTE_REPAIR_ALIAS_CONFLICT">;
  sourcePath: string;
  targetPath: string;
  action: PlanningRouteSimpleRepairAction;
  before: unknown;
  after: unknown;
}

export interface PlanningRouteSimpleRepairConflict {
  code: typeof PLANNING_ROUTE_SIMPLE_REPAIR_CODES.ALIAS_CONFLICT;
  sourcePath: string;
  targetPath: string;
  message: string;
}

export interface PlanningRouteSimpleRepairResult {
  value: Record<string, unknown>;
  repairs: PlanningRouteSimpleRepairRecord[];
  conflicts: PlanningRouteSimpleRepairConflict[];
}

const CONTRACT_FIELDS = new Set([
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
]);

const FIELD_ALIASES: Readonly<Record<string, string>> = {
  video_category: "videoCategory",
  template_id: "templateId",
  chronology_mode: "chronologyMode",
  hook_mode: "hookMode",
  hook_reveal_level: "hookRevealLevel",
  requires_return_point: "requiresReturnPoint",
  category_reason: "categoryReason",
  template_reason: "templateReason",
  chronology_reason: "chronologyReason",
  category_confidence: "categoryConfidence",
  template_confidence: "templateConfidence",
  chronology_confidence: "chronologyConfidence",
  ambiguity_codes: "ambiguityCodes",
  fallback_used: "fallbackUsed",
  fallback_reason: "fallbackReason",
  model_name: "modelName",
  input_fingerprint: "inputFingerprint",
  reference_fact_fingerprint: "referenceFactFingerprint",
};

const EVIDENCE_FIELDS = new Set([
  "sourceType",
  "sourceField",
  "summary",
  "referenceFactField",
]);

const EVIDENCE_ALIASES: Readonly<Record<string, string>> = {
  source_type: "sourceType",
  source_field: "sourceField",
  reference_fact_field: "referenceFactField",
};

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

const ENUM_FIELDS = [
  "videoCategory",
  "templateId",
  "chronologyMode",
  "hookMode",
  "hookRevealLevel",
] as const;

const CONFIDENCE_FIELDS = [
  "categoryConfidence",
  "templateConfidence",
  "chronologyConfidence",
] as const;

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canonicalEnum(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function canonicalAmbiguityCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function addRepair(
  repairs: PlanningRouteSimpleRepairRecord[],
  repair: PlanningRouteSimpleRepairRecord,
): void {
  repairs.push(repair);
}

function applyAliases(
  value: Record<string, unknown>,
  aliases: Readonly<Record<string, string>>,
  path: string,
  repairs: PlanningRouteSimpleRepairRecord[],
  conflicts: PlanningRouteSimpleRepairConflict[],
): void {
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (!(alias in value)) continue;
    const sourcePath = `${path}.${alias}`;
    const targetPath = `${path}.${canonical}`;
    const aliasValue = value[alias];
    if (canonical in value && !equalJson(value[canonical], aliasValue)) {
      conflicts.push({
        code: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.ALIAS_CONFLICT,
        sourcePath,
        targetPath,
        message: `${alias} and ${canonical} contain different values`,
      });
      continue;
    }
    const before = canonical in value ? value[canonical] : undefined;
    value[canonical] = aliasValue;
    delete value[alias];
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.FIELD_ALIAS,
      sourcePath,
      targetPath,
      action: "rename_field",
      before: { alias: aliasValue, canonical: before },
      after: aliasValue,
    });
  }
}

function removeUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  repairs: PlanningRouteSimpleRepairRecord[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    const before = value[key];
    delete value[key];
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.UNKNOWN_FIELD_REMOVED,
      sourcePath: `${path}.${key}`,
      targetPath: `${path}.${key}`,
      action: "remove_unknown_field",
      before,
      after: undefined,
    });
  }
}

export function repairPlanningRouteSimpleErrors(
  input: Record<string, unknown>,
): PlanningRouteSimpleRepairResult {
  const value = cloneRecord(input);
  const repairs: PlanningRouteSimpleRepairRecord[] = [];
  const conflicts: PlanningRouteSimpleRepairConflict[] = [];

  applyAliases(value, FIELD_ALIASES, "$", repairs, conflicts);
  removeUnknownFields(value, CONTRACT_FIELDS, "$", repairs);

  if (Array.isArray(value.evidence)) {
    value.evidence.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return;
      const record = item as Record<string, unknown>;
      const path = `$.evidence[${index}]`;
      applyAliases(record, EVIDENCE_ALIASES, path, repairs, conflicts);
      removeUnknownFields(record, EVIDENCE_FIELDS, path, repairs);
    });
  }

  for (const field of ENUM_FIELDS) {
    if (typeof value[field] !== "string") continue;
    const normalized = canonicalEnum(value[field]);
    if (normalized === value[field]) continue;
    const before = value[field];
    value[field] = normalized;
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.ENUM_CASE,
      sourcePath: `$.${field}`,
      targetPath: `$.${field}`,
      action: "normalize_enum",
      before,
      after: normalized,
    });
  }

  if (!("chronologyMode" in value)) {
    value.chronologyMode = "chronological";
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.DEFAULT_CHRONOLOGY,
      sourcePath: "$.chronologyMode",
      targetPath: "$.chronologyMode",
      action: "apply_default",
      before: undefined,
      after: "chronological",
    });
  }

  if (
    !("templateId" in value)
    && CATEGORIES.has(value.videoCategory as VideoCreativeCategory)
  ) {
    const templates = allowedTemplatesForCategory(value.videoCategory as VideoCreativeCategory);
    if (templates.length === 1) {
      value.templateId = templates[0] as VideoCreativeTemplateId;
      addRepair(repairs, {
        ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.UNIQUE_TEMPLATE,
        sourcePath: "$.templateId",
        targetPath: "$.templateId",
        action: "apply_default",
        before: undefined,
        after: templates[0],
      });
    }
  }

  if (value.chronologyMode === "chronological") {
    for (const [field, defaultValue] of [
      ["hookMode", "curiosity"],
      ["hookRevealLevel", "partial"],
      ["requiresReturnPoint", false],
    ] as const) {
      if (field in value) continue;
      value[field] = defaultValue;
      addRepair(repairs, {
        ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.DEFAULT_HOOK_POLICY,
        sourcePath: `$.${field}`,
        targetPath: `$.${field}`,
        action: "apply_default",
        before: undefined,
        after: defaultValue,
      });
    }
  }

  for (const field of CONFIDENCE_FIELDS) {
    const before = value[field];
    if (typeof before !== "number" || !Number.isFinite(before) || (before >= 0 && before <= 1)) {
      continue;
    }
    const after = Math.min(1, Math.max(0, before));
    value[field] = after;
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.CONFIDENCE_CLAMPED,
      sourcePath: `$.${field}`,
      targetPath: `$.${field}`,
      action: "clamp_number",
      before,
      after,
    });
  }

  if (!("ambiguityCodes" in value) || value.ambiguityCodes === null) {
    const before = value.ambiguityCodes;
    value.ambiguityCodes = [];
    addRepair(repairs, {
      ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.AMBIGUITY_NORMALIZED,
      sourcePath: "$.ambiguityCodes",
      targetPath: "$.ambiguityCodes",
      action: "normalize_array",
      before,
      after: [],
    });
  } else if (Array.isArray(value.ambiguityCodes)) {
    const normalized = Array.from(new Set(value.ambiguityCodes
      .filter((item): item is string => typeof item === "string")
      .map(canonicalAmbiguityCode)
      .filter(Boolean)));
    if (!equalJson(value.ambiguityCodes, normalized)) {
      const before = value.ambiguityCodes;
      value.ambiguityCodes = normalized;
      addRepair(repairs, {
        ruleCode: PLANNING_ROUTE_SIMPLE_REPAIR_CODES.AMBIGUITY_NORMALIZED,
        sourcePath: "$.ambiguityCodes",
        targetPath: "$.ambiguityCodes",
        action: "normalize_array",
        before,
        after: normalized,
      });
    }
  }

  return { value, repairs, conflicts };
}
