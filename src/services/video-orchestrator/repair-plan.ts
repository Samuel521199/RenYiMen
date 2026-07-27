export type RepairOperationAction = "add" | "update" | "delete" | "move";

export interface RepairOperation {
  operationId: string;
  action: RepairOperationAction;
  path: string;
  sourceIssueCode: string;
  sourceIssueId: string;
  currentValue?: unknown;
  desiredChange: string;
  reason: string;
  preservePaths: string[];
  acceptanceCriteria: string[];
}

export interface ModelRepairPlan {
  version: "model-repair-plan-v1";
  repairPlanId: string;
  targetStage: string;
  targetScope: {
    kind: "document" | "segments" | "anchors" | "json";
    segmentNos?: number[];
    anchorIds?: string[];
  };
  generatedBy: "deterministic_audit_mapper";
  operations: RepairOperation[];
  globalPreserveRules: string[];
}

export interface RepairPlanIssue {
  code?: unknown;
  reasonCode?: unknown;
  path?: unknown;
  sourcePath?: unknown;
  reason?: unknown;
  message?: unknown;
  messageZh?: unknown;
  repairHint?: unknown;
  segmentNo?: unknown;
  anchorId?: unknown;
  artifactId?: unknown;
  repairable?: unknown;
  repairScope?: unknown;
}

export interface DeterministicChangeRecord {
  version: "deterministic-change-v1";
  action: RepairOperationAction;
  path: string;
  before?: unknown;
  after?: unknown;
  reasonCode: string;
  acceptanceCriteria: string[];
}

export function buildModelRepairPlan(params: {
  targetStage: string;
  issues: RepairPlanIssue[];
  scope?: ModelRepairPlan["targetScope"];
  preserveRules?: string[];
  defaultPath?: string;
}): ModelRepairPlan {
  const operations = params.issues.map((issue, index) =>
    issueToOperation(issue, index, params.defaultPath ?? "$"));
  if (!operations.length) {
    throw new Error(`Cannot build ${params.targetStage} repair plan without audit issues.`);
  }
  const scope = params.scope ?? inferScope(params.issues);
  const stableSeed = JSON.stringify({
    targetStage: params.targetStage,
    scope,
    operations: operations.map((operation) => ({
      action: operation.action,
      path: operation.path,
      sourceIssueCode: operation.sourceIssueCode,
      desiredChange: operation.desiredChange,
    })),
  });
  return {
    version: "model-repair-plan-v1",
    repairPlanId: `${sanitizeId(params.targetStage)}_${hashText(stableSeed)}`,
    targetStage: params.targetStage,
    targetScope: scope,
    generatedBy: "deterministic_audit_mapper",
    operations,
    globalPreserveRules: uniqueStrings([
      "Modify only paths authorized by operations.",
      "Preserve all fields and approved artifacts outside targetScope.",
      "Do not change identifiers, ordering, timing, or hard contracts unless an operation explicitly authorizes it.",
      ...(params.preserveRules ?? []),
    ]),
  };
}

export function validateModelRepairPlan(plan: ModelRepairPlan): string[] {
  const issues: string[] = [];
  if (plan.version !== "model-repair-plan-v1") issues.push("version");
  if (!plan.repairPlanId.trim()) issues.push("repairPlanId");
  if (!plan.targetStage.trim()) issues.push("targetStage");
  if (!plan.operations.length) issues.push("operations");
  const operationIds = new Set<string>();
  for (const operation of plan.operations) {
    if (!operation.operationId.trim() || operationIds.has(operation.operationId)) {
      issues.push(`operationId:${operation.operationId || "missing"}`);
    }
    operationIds.add(operation.operationId);
    if (!["add", "update", "delete", "move"].includes(operation.action)) {
      issues.push(`action:${operation.operationId}`);
    }
    if (!operation.path.trim()) issues.push(`path:${operation.operationId}`);
    if (!operation.desiredChange.trim()) issues.push(`desiredChange:${operation.operationId}`);
    if (!operation.acceptanceCriteria.length) issues.push(`acceptanceCriteria:${operation.operationId}`);
  }
  return issues;
}

export function assertModelRepairPlan(plan: ModelRepairPlan): ModelRepairPlan {
  const issues = validateModelRepairPlan(plan);
  if (issues.length) {
    throw new Error(`Invalid model repair plan: ${issues.join(", ")}`);
  }
  return plan;
}

export function recordDeterministicChange(params: {
  action: RepairOperationAction;
  path: string;
  before?: unknown;
  after?: unknown;
  reasonCode: string;
  acceptanceCriteria: string[];
}): DeterministicChangeRecord {
  if (!params.path.trim()) throw new Error("Deterministic change path is required.");
  if (!params.acceptanceCriteria.length) {
    throw new Error("Deterministic change acceptance criteria are required.");
  }
  return {
    version: "deterministic-change-v1",
    ...params,
  };
}

export function diffDeterministicChanges(params: {
  before: unknown;
  after: unknown;
  reasonCode: string;
  acceptanceCriteria: string[];
  rootPath?: string;
  maxChanges?: number;
}): DeterministicChangeRecord[] {
  const changes: DeterministicChangeRecord[] = [];
  collectChanges(
    params.before,
    params.after,
    params.rootPath ?? "$",
    changes,
    params.maxChanges ?? 100,
    params.reasonCode,
    params.acceptanceCriteria,
  );
  return changes;
}

function issueToOperation(
  issue: RepairPlanIssue,
  index: number,
  defaultPath: string,
): RepairOperation {
  const code = text(issue.code) || text(issue.reasonCode) || "UNSPECIFIED_REPAIR_ISSUE";
  const segmentNo = positiveInteger(issue.segmentNo);
  const anchorId = text(issue.anchorId);
  const suppliedPath = text(issue.path) || text(issue.sourcePath);
  const path = suppliedPath
    || pathFromReason(text(issue.reason))
    || pathForIssue(code, segmentNo, anchorId)
    || defaultPath;
  const action = actionForIssue(code);
  const reason = text(issue.message)
    || text(issue.messageZh)
    || text(issue.reason)
    || code;
  const repairHint = text(issue.repairHint);
  return {
    operationId: `op_${index + 1}`,
    action,
    path,
    sourceIssueCode: code,
    sourceIssueId: `${code}:${segmentNo ?? anchorId ?? index + 1}`,
    desiredChange: repairHint || desiredChangeForIssue(code, action),
    reason,
    preservePaths: preservePathsForIssue(code, segmentNo),
    acceptanceCriteria: acceptanceCriteriaForIssue(code, path),
  };
}

function inferScope(issues: RepairPlanIssue[]): ModelRepairPlan["targetScope"] {
  const segmentNos = uniqueNumbers(issues.map((issue) => positiveInteger(issue.segmentNo)));
  const anchorIds = uniqueStrings(issues.map((issue) => text(issue.anchorId)));
  if (segmentNos.length) return { kind: "segments", segmentNos };
  if (anchorIds.length) return { kind: "anchors", anchorIds };
  return { kind: "document" };
}

function actionForIssue(code: string): RepairOperationAction {
  if (/(MISSING|REQUIRED.*MISSING)$/.test(code)) return "add";
  if (/(DUPLICATE|FORBIDDEN|UNEXPECTED|EXTRA)/.test(code)) return "delete";
  return "update";
}

function pathForIssue(
  code: string,
  segmentNo: number | undefined,
  anchorId: string,
): string | undefined {
  if (segmentNo) {
    const segmentRoot = `segments[segment_no=${segmentNo}]`;
    const renderRoot = `segment_render_descriptions[segment_no=${segmentNo}]`;
    if (code === "START_FRAME_CONTRACT_MISSING") return `${renderRoot}.start_frame_contract`;
    if (code === "END_FRAME_CONTRACT_MISSING") return `${renderRoot}.end_frame_contract`;
    if (code === "MOTION_CONTRACT_MISSING") return `${renderRoot}.motion_contract`;
    if (code === "SINGLE_TAKE_CONTRACT_MISSING") return `${renderRoot}.single_take_contract`;
    if (code.startsWith("SINGLE_TAKE_")) return `${renderRoot}.single_take_contract`;
    if (code.includes("MOTION_CHECKPOINT")) return `${renderRoot}.motion_checkpoints`;
    if (code.includes("CUT_LANGUAGE")) return `${segmentRoot}.motion`;
    return segmentRoot;
  }
  if (anchorId) return `consistency_manifest.anchors[id=${anchorId}].asset_image_contract`;
  return undefined;
}

function pathFromReason(reason: string): string | undefined {
  const separator = reason.indexOf(":");
  if (separator < 0) return undefined;
  const candidate = reason.slice(separator + 1).trim();
  return candidate && /^[a-zA-Z_$][a-zA-Z0-9_$.[\]=:-]*$/.test(candidate)
    ? candidate
    : undefined;
}

function desiredChangeForIssue(code: string, action: RepairOperationAction): string {
  if (code.includes("CUT") || code.includes("DISSOLVE")) {
    return "Remove the cut, dissolve, transition, or camera-switch instruction and replace it with a continuous physically reachable action.";
  }
  if (code.includes("PHYSICALLY_UNREACHABLE") || code.includes("HIGH_RISK")) {
    return "Simplify the action and camera path so every intermediate state is visible and physically reachable in one continuous take.";
  }
  if (code.includes("REFERENCE_INVALID")) {
    return "Remove invalid references and bind only identifiers that exist in the supplied authoritative registry.";
  }
  if (code.includes("DURATION") || code.includes("TIMELINE")) {
    return "Reallocate deliberate executable timing while preserving event order, total duration, and unaffected timeline meaning.";
  }
  if (action === "add") return "Add the missing required structure using authoritative upstream contracts.";
  if (action === "delete") return "Delete only the invalid or duplicate value; preserve valid neighboring content.";
  return "Update the targeted field to satisfy the reported contract without changing unrelated content.";
}

function preservePathsForIssue(code: string, segmentNo: number | undefined): string[] {
  const common = [
    "classification",
    "consistency_manifest",
    "planning_manifest.timeline_blueprint",
    "narrative_events",
  ];
  if (segmentNo) {
    common.push(`segments[segment_no!=${segmentNo}]`);
    common.push(`segment_render_descriptions[segment_no!=${segmentNo}]`);
  }
  if (code.includes("DURATION")) {
    return ["classification", "consistency_manifest", "narrative_events", "creative_strategy"];
  }
  return common;
}

function acceptanceCriteriaForIssue(code: string, path: string): string[] {
  const criteria = [
    `${path} no longer triggers ${code}.`,
    "All deterministic contract validators pass after applying the repair.",
  ];
  if (code.includes("CUT") || code.includes("SINGLE_TAKE")) {
    criteria.push("The segment remains one continuous physically plausible take without hidden edits.");
  }
  return criteria;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => value !== undefined))].sort((a, b) => a - b);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "repair";
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function collectChanges(
  before: unknown,
  after: unknown,
  path: string,
  changes: DeterministicChangeRecord[],
  maxChanges: number,
  reasonCode: string,
  acceptanceCriteria: string[],
): void {
  if (changes.length >= maxChanges || Object.is(before, after)) return;
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (changes.length >= maxChanges) break;
      collectChanges(
        before[key],
        after[key],
        `${path}.${key}`,
        changes,
        maxChanges,
        reasonCode,
        acceptanceCriteria,
      );
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length && changes.length < maxChanges; index += 1) {
      collectChanges(
        before[index],
        after[index],
        `${path}[${index}]`,
        changes,
        maxChanges,
        reasonCode,
        acceptanceCriteria,
      );
    }
    return;
  }
  const action: RepairOperationAction = before === undefined
    ? "add"
    : after === undefined
      ? "delete"
      : "update";
  changes.push(recordDeterministicChange({
    action,
    path,
    before,
    after,
    reasonCode,
    acceptanceCriteria,
  }));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
