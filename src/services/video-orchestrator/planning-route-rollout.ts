import { createHash } from "node:crypto";

export const PLANNING_ROUTE_ROLLOUT_STAGES = [
  "local_fixed_samples",
  "test_live_model",
  "shadow_compare",
  "nonbillable_canary",
  "internal_new_projects",
  "percent_10",
  "percent_50",
  "percent_100",
] as const;

export type PlanningRouteRolloutStage = typeof PLANNING_ROUTE_ROLLOUT_STAGES[number];

export interface PlanningRouteRolloutDecision {
  stage: PlanningRouteRolloutStage;
  projectBucket: number;
  selected: boolean;
  executeRouteModel: boolean;
  affectFormalPlanning: boolean;
  authority: "legacy_planning_architect" | "route_contract";
  comparisonMode: "none" | "classification_only";
  reason: string;
}

const STAGE_PERCENTAGE: Record<PlanningRouteRolloutStage, number> = {
  local_fixed_samples: 0,
  test_live_model: 0,
  shadow_compare: 0,
  nonbillable_canary: 0,
  internal_new_projects: 0,
  percent_10: 10,
  percent_50: 50,
  percent_100: 100,
};

export function planningRouteProjectBucket(projectId: string): number {
  const prefix = createHash("sha256").update(projectId).digest("hex").slice(0, 8);
  return Number.parseInt(prefix, 16) % 100;
}

export function decidePlanningRouteRollout(params: {
  stage: PlanningRouteRolloutStage;
  projectId: string;
  internalProject?: boolean;
  nonbillableCanary?: boolean;
}): PlanningRouteRolloutDecision {
  const projectBucket = planningRouteProjectBucket(params.projectId);
  if (params.stage === "local_fixed_samples") {
    return {
      stage: params.stage,
      projectBucket,
      selected: false,
      executeRouteModel: false,
      affectFormalPlanning: false,
      authority: "legacy_planning_architect",
      comparisonMode: "none",
      reason: "local fixed samples only",
    };
  }
  if (params.stage === "test_live_model" || params.stage === "shadow_compare") {
    return {
      stage: params.stage,
      projectBucket,
      selected: false,
      executeRouteModel: true,
      affectFormalPlanning: false,
      authority: "legacy_planning_architect",
      comparisonMode: "classification_only",
      reason: "Route runs in shadow and cannot affect formal Planning",
    };
  }
  if (params.stage === "nonbillable_canary") {
    const selected = params.nonbillableCanary === true;
    return {
      stage: params.stage,
      projectBucket,
      selected,
      executeRouteModel: selected,
      affectFormalPlanning: selected,
      authority: selected ? "route_contract" : "legacy_planning_architect",
      comparisonMode: "none",
      reason: selected ? "selected nonbillable canary" : "not a nonbillable canary",
    };
  }
  if (params.stage === "internal_new_projects") {
    const selected = params.internalProject === true;
    return {
      stage: params.stage,
      projectBucket,
      selected,
      executeRouteModel: selected,
      affectFormalPlanning: selected,
      authority: selected ? "route_contract" : "legacy_planning_architect",
      comparisonMode: "none",
      reason: selected ? "internal new project cohort" : "external project not selected",
    };
  }

  const percentage = STAGE_PERCENTAGE[params.stage];
  const selected = projectBucket < percentage;
  return {
    stage: params.stage,
    projectBucket,
    selected,
    executeRouteModel: selected,
    affectFormalPlanning: selected,
    authority: selected ? "route_contract" : "legacy_planning_architect",
    comparisonMode: "none",
    reason: selected
      ? `project is inside deterministic ${percentage}% cohort`
      : `project is outside deterministic ${percentage}% cohort`,
  };
}

export interface PlanningRouteShadowComparison {
  fields: ["videoCategory", "templateId", "chronologyMode"];
  matches: boolean;
  mismatches: Array<{
    field: "videoCategory" | "templateId" | "chronologyMode";
    routeValue: unknown;
    legacyValue: unknown;
  }>;
  affectsFormalPlanning: false;
}

export function comparePlanningRouteShadow(params: {
  routeContract: Record<string, unknown>;
  legacyClassification: Record<string, unknown>;
}): PlanningRouteShadowComparison {
  const fields = ["videoCategory", "templateId", "chronologyMode"] as const;
  const legacyAliases = {
    videoCategory: ["videoCategory", "video_category"],
    templateId: ["templateId", "template_id"],
    chronologyMode: ["chronologyMode", "chronology_mode"],
  } as const;
  const mismatches = fields.flatMap((field) => {
    const legacyValue = legacyAliases[field]
      .map((alias) => params.legacyClassification[alias])
      .find((value) => value !== undefined);
    return params.routeContract[field] === legacyValue
      ? []
      : [{ field, routeValue: params.routeContract[field], legacyValue }];
  });
  return {
    fields: [...fields],
    matches: mismatches.length === 0,
    mismatches,
    affectsFormalPlanning: false,
  };
}

export function assertRouteContractIsSoleAuthority(params: {
  rolloutDecision: PlanningRouteRolloutDecision;
  approvedRouteContractPresent: boolean;
  planningArchitectClassificationEnabled: boolean;
}): void {
  if (params.rolloutDecision.stage !== "percent_100") return;
  if (
    params.rolloutDecision.authority !== "route_contract"
    || !params.approvedRouteContractPresent
    || params.planningArchitectClassificationEnabled
  ) {
    throw new Error(
      "PLANNING_ROUTE_DUAL_AUTHORITY_FORBIDDEN: percent_100 requires Route Contract as the sole classification authority",
    );
  }
}
