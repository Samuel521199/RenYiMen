type JsonRecord = Record<string, unknown>;

const LEGACY_KEYS = new Set([
  "image_prompt",
  "image_prompt_zh",
  "image_prompt_en",
  "video_prompt",
  "video_prompt_zh",
  "video_prompt_en",
  "consistency_manifest",
  "planning_manifest",
  "segment_render_descriptions",
  "media_conditioned_segment_plans",
  "segment_no",
  "shotNo",
  "shot_no",
  "sequence",
]);

export class NonCanonicalPlanFieldError extends Error {
  readonly code = "NON_CANONICAL_PLAN_FIELD";
  readonly recoveryAction = "MIGRATE_PLAN_FIELDS";

  constructor(readonly paths: string[]) {
    super(`Legacy plan fields are not accepted after the Phase 8 cutover: ${paths.join(", ")}`);
    this.name = "NonCanonicalPlanFieldError";
  }
}

/**
 * Runtime accepts one canonical field vocabulary only. Historical alias
 * conversion belonged to the completed one-time migration and is not a
 * production read path.
 */
export function assertCanonicalPlanContract(value: unknown): JsonRecord {
  const cloned = structuredClone(record(value));
  const legacyPaths: string[] = [];
  visit(cloned, "$", legacyPaths);
  if (legacyPaths.length) throw new NonCanonicalPlanFieldError(legacyPaths);
  return cloned;
}

export function nonCanonicalPlanErrorDetails(error: unknown): {
  errorCode: "NON_CANONICAL_PLAN_FIELD";
  recoveryAction: "MIGRATE_PLAN_FIELDS";
  paths: string[];
} | null {
  if (!(error instanceof NonCanonicalPlanFieldError)) return null;
  return {
    errorCode: error.code,
    recoveryAction: error.recoveryAction,
    paths: error.paths,
  };
}

function visit(value: unknown, path: string, legacyPaths: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, legacyPaths));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) legacyPaths.push(`${path}.${key}`);
    // Planner checkpoints are versioned, opaque recovery payloads. Their raw
    // model-stage outputs intentionally preserve the schema accepted by the
    // stage that produced them and are never consumed as provider execution
    // fields. Canonical enforcement resumes at the executable plan root.
    if (path === "$" && key === "plannerCheckpoint") continue;
    visit(child, `${path}.${key}`, legacyPaths);
  }
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
