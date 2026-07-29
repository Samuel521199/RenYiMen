import { createHash } from "node:crypto";
import type {
  NarrativeEvent,
  VideoCreativeStrategy,
  VideoStoryFunction,
} from "./types";
import type {
  PlanningNarrativeContractIssue,
  PlanningNarrativeContractResult,
} from "./story-contract-gate";

export const CORE_EVENT_STORY_FUNCTIONS = [
  "hook",
  "conflict",
  "turning_point",
  "payoff",
  "cta",
] as const satisfies readonly VideoStoryFunction[];

type CoreEventStoryFunction = typeof CORE_EVENT_STORY_FUNCTIONS[number];
type BindingField =
  | "hookEventIds"
  | "conflictEventIds"
  | "turningPointEventIds"
  | "payoffEventIds"
  | "ctaEventIds";

const FUNCTION_TO_FIELD: Record<CoreEventStoryFunction, BindingField> = {
  hook: "hookEventIds",
  conflict: "conflictEventIds",
  turning_point: "turningPointEventIds",
  payoff: "payoffEventIds",
  cta: "ctaEventIds",
};

const PATCH_PATH_TO_FIELD: Record<string, keyof VideoCreativeStrategy> = {
  "/hook_event_ids": "hookEventIds",
  "/conflict_event_ids": "conflictEventIds",
  "/turning_point_event_ids": "turningPointEventIds",
  "/payoff_event_ids": "payoffEventIds",
  "/cta_event_ids": "ctaEventIds",
  "/return_to_event_id": "returnToEventId",
  "/hook_reveal_level": "hookRevealLevel",
  "/chronology_mode": "chronologyMode",
  "/hook": "hook",
  "/hook_zh": "hookZh",
  "/hook_en": "hookEn",
  "/conflict": "conflict",
  "/conflict_zh": "conflictZh",
  "/conflict_en": "conflictEn",
  "/turning_point": "turningPoint",
  "/turning_point_zh": "turningPointZh",
  "/turning_point_en": "turningPointEn",
  "/payoff": "payoff",
  "/payoff_zh": "payoffZh",
  "/payoff_en": "payoffEn",
  "/cta": "cta",
  "/cta_zh": "ctaZh",
  "/cta_en": "ctaEn",
};

export interface CreativeStrategyPatch {
  op: "replace";
  path: string;
  value: unknown;
}

export interface EventStoryFunctionPatch {
  eventId: string;
  storyFunctions: VideoStoryFunction[];
}

export interface PlanningContractRepairAttempt {
  attempt: number;
  mode: "binding_patch" | "event_role_replan" | "deterministic_fallback";
  issueFingerprint: string;
  bindingFingerprintBefore: string;
  bindingFingerprintAfter?: string;
  issueCountBefore: number;
  issueCountAfter?: number;
  changedPaths: string[];
  issues: PlanningNarrativeContractIssue[];
  createdAt: string;
}

export function materializeNarrativeEventStoryFunctions(
  events: NarrativeEvent[],
  strategy: VideoCreativeStrategy,
): { events: NarrativeEvent[]; authority: "event" | "legacy_migrated" } {
  const hasDeclaredAuthority = events.some((event) => (event.storyFunctions ?? []).length > 0);
  if (hasDeclaredAuthority) {
    return {
      authority: "event",
      events: events.map((event) => ({
        ...event,
        storyFunctions: uniqueStoryFunctions(event.storyFunctions ?? []),
      })),
    };
  }
  const functionsByEventId = new Map<string, VideoStoryFunction[]>();
  for (const storyFunction of CORE_EVENT_STORY_FUNCTIONS) {
    for (const eventId of strategy[FUNCTION_TO_FIELD[storyFunction]] ?? []) {
      functionsByEventId.set(eventId, uniqueStoryFunctions([
        ...(functionsByEventId.get(eventId) ?? []),
        storyFunction,
      ]));
    }
  }
  return {
    authority: "legacy_migrated",
    events: events.map((event) => ({
      ...event,
      storyFunctions: functionsByEventId.get(event.eventId) ?? [],
    })),
  };
}

export function deriveCreativeStrategyEventBindings(
  events: NarrativeEvent[],
): Pick<
  VideoCreativeStrategy,
  "hookEventIds" | "conflictEventIds" | "turningPointEventIds" | "payoffEventIds" | "ctaEventIds"
> {
  const result = {
    hookEventIds: [] as string[],
    conflictEventIds: [] as string[],
    turningPointEventIds: [] as string[],
    payoffEventIds: [] as string[],
    ctaEventIds: [] as string[],
  };
  for (const event of events) {
    for (const storyFunction of event.storyFunctions ?? []) {
      if (!isCoreStoryFunction(storyFunction)) continue;
      result[FUNCTION_TO_FIELD[storyFunction]].push(event.eventId);
    }
  }
  return result;
}

export function applyEventAuthorityToCreativeStrategy(
  strategy: VideoCreativeStrategy,
  events: NarrativeEvent[],
): VideoCreativeStrategy {
  return {
    ...strategy,
    ...deriveCreativeStrategyEventBindings(events),
  };
}

export function applyCreativeStrategyPatches(params: {
  strategy: VideoCreativeStrategy;
  patches: CreativeStrategyPatch[];
  validEventIds: Iterable<string>;
}): { strategy: VideoCreativeStrategy; changedPaths: string[]; rejectedPaths: string[] } {
  const validEventIds = new Set(params.validEventIds);
  const next = { ...params.strategy };
  const changedPaths: string[] = [];
  const rejectedPaths: string[] = [];
  for (const patch of params.patches) {
    const field = PATCH_PATH_TO_FIELD[patch.path];
    if (patch.op !== "replace" || !field || !validPatchValue(field, patch.value, validEventIds)) {
      rejectedPaths.push(patch.path);
      continue;
    }
    (next as Record<string, unknown>)[field] = Array.isArray(patch.value)
      ? uniqueStrings(patch.value)
      : patch.value;
    changedPaths.push(patch.path);
  }
  return { strategy: next, changedPaths: uniqueStrings(changedPaths), rejectedPaths: uniqueStrings(rejectedPaths) };
}

export function applyEventStoryFunctionPatches(params: {
  events: NarrativeEvent[];
  patches: EventStoryFunctionPatch[];
}): { events: NarrativeEvent[]; changedEventIds: string[]; rejectedEventIds: string[] } {
  const patchById = new Map(params.patches.map((patch) => [patch.eventId, patch]));
  const known = new Set(params.events.map((event) => event.eventId));
  const rejectedEventIds = params.patches
    .map((patch) => patch.eventId)
    .filter((eventId) => !known.has(eventId));
  const changedEventIds: string[] = [];
  const events = params.events.map((event) => {
    const patch = patchById.get(event.eventId);
    if (!patch) return event;
    const storyFunctions = uniqueStoryFunctions(patch.storyFunctions);
    if (JSON.stringify(storyFunctions) === JSON.stringify(event.storyFunctions ?? [])) return event;
    changedEventIds.push(event.eventId);
    return { ...event, storyFunctions };
  });
  return { events, changedEventIds, rejectedEventIds: uniqueStrings(rejectedEventIds) };
}

export function deterministicLegacyOrderFallback(
  strategy: VideoCreativeStrategy,
  events: NarrativeEvent[],
  issues: PlanningNarrativeContractIssue[],
): { strategy: VideoCreativeStrategy; changedPaths: string[] } | undefined {
  if (!issues.length || issues.some((issue) => issue.code !== "STRATEGY_FUNCTION_ORDER_INVALID")) return undefined;
  const order = new Map(events.map((event, index) => [event.eventId, index]));
  const next = { ...strategy };
  const changedPaths: string[] = [];
  for (const issue of issues) {
    const match = /^creative_strategy\.(hook|conflict|turning_point|payoff)_event_ids$/.exec(issue.path);
    if (!match) return undefined;
    const earlier = match[1] as Exclude<CoreEventStoryFunction, "cta">;
    const later = laterFunctionFor(earlier);
    const earlierField = FUNCTION_TO_FIELD[earlier];
    const laterField = FUNCTION_TO_FIELD[later];
    const union = uniqueStrings([...(next[earlierField] ?? []), ...(next[laterField] ?? [])])
      .filter((eventId) => order.has(eventId))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (union.length < 2) return undefined;
    next[earlierField] = [union[0]];
    next[laterField] = [union[union.length - 1]];
    changedPaths.push(`/${snakeFunction(earlier)}_event_ids`, `/${snakeFunction(later)}_event_ids`);
  }
  return { strategy: next, changedPaths: uniqueStrings(changedPaths) };
}

export function planningContractIssueFingerprint(report: PlanningNarrativeContractResult): string {
  return hash(report.issues.map((issue) => ({
    code: issue.code,
    path: issue.path,
    repairHint: issue.repairHint,
  })));
}

export function creativeStrategyBindingFingerprint(strategy: VideoCreativeStrategy): string {
  return hash({
    chronologyMode: strategy.chronologyMode,
    hookRevealLevel: strategy.hookRevealLevel,
    hookEventIds: strategy.hookEventIds ?? [],
    conflictEventIds: strategy.conflictEventIds ?? [],
    turningPointEventIds: strategy.turningPointEventIds ?? [],
    payoffEventIds: strategy.payoffEventIds ?? [],
    ctaEventIds: strategy.ctaEventIds ?? [],
    returnToEventId: strategy.returnToEventId ?? "",
  });
}

export function shouldEscalatePlanningContractRepair(
  previous: PlanningContractRepairAttempt | undefined,
  report: PlanningNarrativeContractResult,
  strategy: VideoCreativeStrategy,
): boolean {
  if (!previous) return false;
  const issueUnchanged = previous.issueFingerprint === planningContractIssueFingerprint(report);
  const bindingUnchanged = previous.bindingFingerprintAfter === creativeStrategyBindingFingerprint(strategy);
  const noIssueImprovement = (previous.issueCountAfter ?? previous.issueCountBefore) >= previous.issueCountBefore;
  return (issueUnchanged && bindingUnchanged) || (issueUnchanged && noIssueImprovement);
}

function validPatchValue(
  field: keyof VideoCreativeStrategy,
  value: unknown,
  validEventIds: Set<string>,
): boolean {
  if (field.endsWith("EventIds")) {
    return Array.isArray(value)
      && value.every((item) => typeof item === "string" && validEventIds.has(item));
  }
  if (field === "returnToEventId") return typeof value === "string" && (!value || validEventIds.has(value));
  if (field === "hookRevealLevel") return value === "none" || value === "partial" || value === "full";
  if (field === "chronologyMode") {
    return value === "chronological"
      || value === "flashforward_hook"
      || value === "result_first"
      || value === "problem_solution"
      || value === "demonstration";
  }
  return typeof value === "string";
}

function laterFunctionFor(
  storyFunction: Exclude<CoreEventStoryFunction, "cta">,
): CoreEventStoryFunction {
  if (storyFunction === "hook" || storyFunction === "conflict") return "turning_point";
  if (storyFunction === "turning_point") return "payoff";
  return "cta";
}

function snakeFunction(value: CoreEventStoryFunction): string {
  return value;
}

function isCoreStoryFunction(value: VideoStoryFunction): value is CoreEventStoryFunction {
  return (CORE_EVENT_STORY_FUNCTIONS as readonly string[]).includes(value);
}

function uniqueStoryFunctions(values: VideoStoryFunction[]): VideoStoryFunction[] {
  return [...new Set(values.filter(Boolean))];
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
