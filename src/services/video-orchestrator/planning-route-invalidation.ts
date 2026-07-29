import { isDeepStrictEqual } from "node:util";
import type { ApprovedPlanningRouteContract } from "./planning-route-planning-architect";

export const ROUTE_PRODUCTION_FIELDS = [
  "videoCategory",
  "templateId",
  "chronologyMode",
  "hookMode",
  "hookRevealLevel",
  "requiresReturnPoint",
] as const;

export const ROUTE_DISPLAY_ONLY_FIELDS = [
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
  "modelName",
  "inputFingerprint",
  "referenceFactFingerprint",
] as const;

export type RouteProductionField = typeof ROUTE_PRODUCTION_FIELDS[number];
export type RouteDisplayOnlyField = typeof ROUTE_DISPLAY_ONLY_FIELDS[number];

export type RouteSemanticInvalidationScope =
  | "none"
  | "planning_after_route"
  | "narrative_and_downstream"
  | "narrative_event_order_and_downstream"
  | "narrative_events_and_downstream";

export interface RouteContractChangeComparison {
  changedFields: string[];
  productionChangedFields: RouteProductionField[];
  displayOnlyChangedFields: RouteDisplayOnlyField[];
  unknownChangedFields: string[];
  invalidateProductionContent: boolean;
  checkpointBoundary: "none" | "story_architect";
  semanticScopes: RouteSemanticInvalidationScope[];
}

const PRODUCTION_FIELD_SET = new Set<string>(ROUTE_PRODUCTION_FIELDS);
const DISPLAY_ONLY_FIELD_SET = new Set<string>(ROUTE_DISPLAY_ONLY_FIELDS);

function equal(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

export function comparePlanningRouteContracts(
  previous: ApprovedPlanningRouteContract | undefined,
  next: ApprovedPlanningRouteContract,
): RouteContractChangeComparison {
  if (!previous) {
    return {
      changedFields: [...ROUTE_PRODUCTION_FIELDS],
      productionChangedFields: [...ROUTE_PRODUCTION_FIELDS],
      displayOnlyChangedFields: [],
      unknownChangedFields: [],
      invalidateProductionContent: true,
      checkpointBoundary: "story_architect",
      semanticScopes: ["planning_after_route"],
    };
  }

  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changedFields = [...keys]
    .filter((field) => !equal(previous[field], next[field]))
    .sort();
  const productionChangedFields = changedFields
    .filter((field): field is RouteProductionField => PRODUCTION_FIELD_SET.has(field));
  const displayOnlyChangedFields = changedFields
    .filter((field): field is RouteDisplayOnlyField => DISPLAY_ONLY_FIELD_SET.has(field));
  const unknownChangedFields = changedFields.filter((field) =>
    !PRODUCTION_FIELD_SET.has(field) && !DISPLAY_ONLY_FIELD_SET.has(field));

  const semanticScopes = new Set<RouteSemanticInvalidationScope>();
  if (productionChangedFields.includes("videoCategory") || unknownChangedFields.length) {
    semanticScopes.add("planning_after_route");
  }
  if (productionChangedFields.includes("templateId")) {
    semanticScopes.add("narrative_and_downstream");
  }
  if (productionChangedFields.includes("chronologyMode")) {
    semanticScopes.add("narrative_event_order_and_downstream");
  }
  if (
    productionChangedFields.includes("hookMode")
    || productionChangedFields.includes("hookRevealLevel")
    || productionChangedFields.includes("requiresReturnPoint")
  ) {
    semanticScopes.add("narrative_events_and_downstream");
  }
  if (!semanticScopes.size) semanticScopes.add("none");

  const invalidateProductionContent =
    productionChangedFields.length > 0 || unknownChangedFields.length > 0;
  return {
    changedFields,
    productionChangedFields,
    displayOnlyChangedFields,
    unknownChangedFields,
    invalidateProductionContent,
    checkpointBoundary: invalidateProductionContent ? "story_architect" : "none",
    semanticScopes: [...semanticScopes],
  };
}
