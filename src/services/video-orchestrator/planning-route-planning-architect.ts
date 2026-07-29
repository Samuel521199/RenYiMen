import type {
  OnePromptVideoPlan,
  VideoChronologyMode,
  VideoCreativeCategory,
  VideoCreativeTemplateId,
  VideoCreativeStrategy,
  VideoHookMode,
  VideoHookRevealLevel,
} from "./types";

export interface ApprovedPlanningRouteContract extends Record<string, unknown> {
  videoCategory: VideoCreativeCategory;
  templateId: VideoCreativeTemplateId;
  chronologyMode: VideoChronologyMode;
  hookMode: VideoHookMode;
  hookRevealLevel: VideoHookRevealLevel;
  requiresReturnPoint: boolean;
  categoryReason: string;
  templateReason: string;
  chronologyReason: string;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  version: "planning-route-v1";
}

export const PLANNING_ARCHITECT_ROUTE_LOCK_RULES = `
APPROVED ROUTE CONTRACT — IMMUTABLE
- approved_route_contract has already passed the independent Route Gate and is the only authority for video_category, template_id, chronology_mode, hook_mode, hook_reveal_level, and requires_return_point.
- Do not classify the video again. Do not choose or suggest another category, template, chronology, or Hook policy.
- Do not modify approved_route_contract. Do not silently fall back to another template.
- Generate only downstream narrative_events, creative event bindings/copy, consistency anchors, anchor state changes, timeline, audio, and subtitle strategy from the approved route.
- classification in the final response must mirror approved_route_contract exactly. It is not a new model decision.
- If approved_route_contract genuinely conflicts with immutable user/reference input, return only:
  {"route_contract_error":{"code":"PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT","message":"","conflicting_input_fields":[],"conflicting_route_fields":[]}}
- Never resolve a route/input conflict by changing classification or using another template.
`;

export class PlanningArchitectRouteConflictError extends Error {
  readonly code:
    | "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT"
    | "PLANNING_ARCHITECT_ROUTE_MUTATION";
  readonly conflictingInputFields: string[];
  readonly conflictingRouteFields: string[];

  constructor(params: {
    code: PlanningArchitectRouteConflictError["code"];
    message: string;
    conflictingInputFields?: string[];
    conflictingRouteFields?: string[];
  }) {
    super(params.message);
    this.name = "PlanningArchitectRouteConflictError";
    this.code = params.code;
    this.conflictingInputFields = params.conflictingInputFields ?? [];
    this.conflictingRouteFields = params.conflictingRouteFields ?? [];
  }
}

export function approvedRouteContractForPlanningArchitect(
  route: ApprovedPlanningRouteContract,
): Record<string, unknown> {
  return structuredClone(route);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readLoose(record: Record<string, unknown>, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

function assertMirroredField(params: {
  record: Record<string, unknown>;
  camel: string;
  snake: string;
  expected: unknown;
  source: string;
}): void {
  const actual = readLoose(params.record, params.camel, params.snake);
  if (actual === undefined || actual === null || actual === "") return;
  if (actual === params.expected) return;
  throw new PlanningArchitectRouteConflictError({
    code: "PLANNING_ARCHITECT_ROUTE_MUTATION",
    message: `${params.source}.${params.snake} attempted to change approved Route Contract`,
    conflictingRouteFields: [params.camel],
  });
}

export function applyApprovedRouteToPlanningArchitectOutput(
  planningRaw: unknown,
  route: ApprovedPlanningRouteContract,
): Record<string, unknown> {
  if (!isRecord(planningRaw)) {
    throw new PlanningArchitectRouteConflictError({
      code: "PLANNING_ARCHITECT_ROUTE_MUTATION",
      message: "Planning Architect did not return a JSON object",
    });
  }
  const routeError = readLoose(planningRaw, "routeContractError", "route_contract_error");
  if (isRecord(routeError)) {
    throw new PlanningArchitectRouteConflictError({
      code: "PLANNING_ARCHITECT_ROUTE_INPUT_CONFLICT",
      message: typeof routeError.message === "string" && routeError.message.trim()
        ? routeError.message
        : "Planning Architect reported a conflict between approved Route Contract and immutable input",
      conflictingInputFields: Array.isArray(routeError.conflicting_input_fields)
        ? routeError.conflicting_input_fields.filter((item): item is string => typeof item === "string")
        : [],
      conflictingRouteFields: Array.isArray(routeError.conflicting_route_fields)
        ? routeError.conflicting_route_fields.filter((item): item is string => typeof item === "string")
        : [],
    });
  }

  const output = structuredClone(planningRaw);
  const classification = isRecord(output.classification) ? output.classification : {};
  for (const [camel, snake, expected] of [
    ["videoCategory", "video_category", route.videoCategory],
    ["templateId", "template_id", route.templateId],
    ["chronologyMode", "chronology_mode", route.chronologyMode],
  ] as const) {
    assertMirroredField({ record: classification, camel, snake, expected, source: "classification" });
  }

  const strategy = isRecord(output.creative_strategy)
    ? output.creative_strategy
    : isRecord(output.creativeStrategy)
      ? output.creativeStrategy
      : {};
  for (const [camel, snake, expected] of [
    ["videoCategory", "video_category", route.videoCategory],
    ["templateId", "template_id", route.templateId],
    ["chronologyMode", "chronology_mode", route.chronologyMode],
    ["hookMode", "hook_mode", route.hookMode],
    ["hookRevealLevel", "hook_reveal_level", route.hookRevealLevel],
  ] as const) {
    assertMirroredField({ record: strategy, camel, snake, expected, source: "creative_strategy" });
  }

  output.classification = {
    ...classification,
    video_category: route.videoCategory,
    template_id: route.templateId,
    template_reason_zh: route.templateReason,
    chronology_mode: route.chronologyMode,
    fallback_reason_zh: route.fallbackReason ?? "",
  };
  output.creative_strategy = {
    ...strategy,
    video_category: route.videoCategory,
    template_id: route.templateId,
    chronology_mode: route.chronologyMode,
    hook_mode: route.hookMode,
    hook_reveal_level: route.hookRevealLevel,
  };
  delete output.creativeStrategy;
  return output;
}

export function mirrorApprovedRouteToFinalPlan(
  plan: OnePromptVideoPlan,
  route: ApprovedPlanningRouteContract,
): OnePromptVideoPlan {
  const creativeStrategy = mirrorApprovedRouteToCreativeStrategy(
    plan.creativeStrategy ?? {},
    route,
  );
  return {
    ...plan,
    approvedRouteContract: approvedRouteContractForPlanningArchitect(route),
    creativeStrategy,
    plannerWarnings: route.fallbackUsed && route.fallbackReason
      ? [...new Set([...(plan.plannerWarnings ?? []), `Route fallback: ${route.fallbackReason}`])]
      : plan.plannerWarnings,
  };
}

export function mirrorApprovedRouteToCreativeStrategy(
  current: VideoCreativeStrategy,
  route: ApprovedPlanningRouteContract,
): VideoCreativeStrategy {
  for (const [field, expected] of [
    ["videoCategory", route.videoCategory],
    ["templateId", route.templateId],
    ["chronologyMode", route.chronologyMode],
    ["hookMode", route.hookMode],
    ["hookRevealLevel", route.hookRevealLevel],
  ] as const) {
    const actual = current[field];
    if (actual !== undefined && actual !== expected) {
      throw new PlanningArchitectRouteConflictError({
        code: "PLANNING_ARCHITECT_ROUTE_MUTATION",
        message: `final creativeStrategy.${field} drifted from approved Route Contract`,
        conflictingRouteFields: [field],
      });
    }
  }
  return {
    ...current,
    videoCategory: route.videoCategory,
    templateId: route.templateId,
    chronologyMode: route.chronologyMode,
    hookMode: route.hookMode,
    hookRevealLevel: route.hookRevealLevel,
    returnToEventId: route.requiresReturnPoint ? current.returnToEventId : "",
    templateReason: route.templateReason,
    templateReasonZh: route.templateReason,
    fallbackReason: route.fallbackReason ?? "",
    fallbackReasonZh: route.fallbackReason ?? "",
  };
}
