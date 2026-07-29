import { createHash } from "node:crypto";
import { z, type ZodIssue, type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type StructuredContractIssueKind = "syntax" | "shape" | "semantic";

export interface StructuredContractIssue {
  path: string;
  code: string;
  kind: StructuredContractIssueKind;
  message: string;
}

export type StructuredStageResult<T> =
  | { status: "valid"; value: T }
  | { status: "repairable"; issues: StructuredContractIssue[]; raw: unknown }
  | { status: "fatal"; error: Error };

export interface StructuredStageContract<T> {
  name: string;
  version: string;
  schema: ZodType<T>;
  example: T;
  normalize?: (raw: unknown) => unknown;
}

export interface StructuredFailureIdentity {
  stage: string;
  segment?: number;
  schemaVersion: string;
  issueFingerprint: string;
}

export interface StructuredFailureState extends StructuredFailureIdentity {
  count: number;
  lastSeenAt: string;
  issues?: StructuredContractIssue[];
  candidatePreview?: unknown;
  systemic?: boolean;
  affectedSegments?: number[];
}

export function structuredStageJsonSchema<T>(
  contract: StructuredStageContract<T>,
): Record<string, unknown> {
  return zodToJsonSchema(contract.schema, {
    name: contract.name,
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function validateStructuredStageValue<T>(
  contract: StructuredStageContract<T>,
  raw: unknown,
): StructuredStageResult<T> {
  let normalized: unknown;
  try {
    normalized = contract.normalize ? contract.normalize(raw) : raw;
  } catch (error) {
    return {
      status: "fatal",
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const parsed = contract.schema.safeParse(normalized);
  if (parsed.success) return { status: "valid", value: parsed.data };
  return {
    status: "repairable",
    raw,
    issues: parsed.error.issues.map((issue) => ({
      path: zodIssuePath(issue.path),
      code: issue.code,
      kind: classifyZodIssue(issue),
      message: issue.message,
    })),
  };
}

export function structuredContractIssueFingerprint(
  identity: Omit<StructuredFailureIdentity, "issueFingerprint">,
  issues: StructuredContractIssue[],
): StructuredFailureIdentity {
  const stableIssues = issues
    .map((issue) => ({
      path: issue.path,
      code: issue.code,
      kind: issue.kind,
      message: issue.message,
    }))
    .sort((left, right) =>
      `${left.path}:${left.code}:${left.message}`.localeCompare(`${right.path}:${right.code}:${right.message}`)
    );
  return {
    ...identity,
    issueFingerprint: createHash("sha256")
      .update(JSON.stringify(stableIssues))
      .digest("hex"),
  };
}

export function advanceStructuredFailureState(
  previous: StructuredFailureState | undefined,
  identity: StructuredFailureIdentity,
): StructuredFailureState {
  const sameFailure = previous?.stage === identity.stage
    && previous.segment === identity.segment
    && previous.schemaVersion === identity.schemaVersion
    && previous.issueFingerprint === identity.issueFingerprint;
  return {
    ...identity,
    count: sameFailure ? previous.count + 1 : 1,
    lastSeenAt: new Date().toISOString(),
  };
}

export function shouldStopStructuredFailureRetry(
  state: StructuredFailureState,
  threshold = 2,
): boolean {
  return state.count >= Math.max(1, threshold);
}

export function systemicStructuredFailureSegments(
  failures: Iterable<StructuredFailureState>,
  current: StructuredFailureState,
): number[] {
  return [...new Set(
    [...failures].flatMap((failure) =>
      failure.schemaVersion === current.schemaVersion
      && failure.issueFingerprint === current.issueFingerprint
      && failure.segment !== undefined
        ? [failure.segment]
        : []
    ),
  )].sort((left, right) => left - right);
}

export function formatStructuredContractIssues(issues: StructuredContractIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
}

export function sanitizeStructuredCandidate(raw: unknown): unknown {
  return sanitizeValue(raw, 0);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth >= 6) return "[depth-limited]";
  if (typeof value === "string") {
    if (/^data:/i.test(value)) return "[data-url-redacted]";
    return value.length > 500 ? `${value.slice(0, 500)}…[truncated]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 80)) {
    if (/authorization|api[_-]?key|token|secret|cookie/i.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeValue(item, depth + 1);
  }
  return output;
}

function zodIssuePath(path: Array<string | number>): string {
  return path.reduce<string>((result, part) =>
    typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`, "$");
}

function classifyZodIssue(issue: ZodIssue): StructuredContractIssueKind {
  return issue.code === "invalid_type"
    || issue.code === "unrecognized_keys"
    || issue.code === "invalid_union"
    ? "shape"
    : "semantic";
}

export { z };
