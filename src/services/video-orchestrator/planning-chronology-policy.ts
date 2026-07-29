import type {
  VideoChronologyMode,
  VideoHookMode,
  VideoHookRevealLevel,
} from "./types";

export const PLANNING_CHRONOLOGY_ERROR_CODES = {
  HOOK_MODE_MISMATCH: "PLANNING_ROUTE_CHRONOLOGY_HOOK_MODE_MISMATCH",
  REVEAL_LEVEL_MISMATCH: "PLANNING_ROUTE_CHRONOLOGY_REVEAL_LEVEL_MISMATCH",
  PAYOFF_REVEAL_FORBIDDEN: "PLANNING_ROUTE_CHRONOLOGICAL_PAYOFF_REVEAL_FORBIDDEN",
  RETURN_POINT_REQUIRED: "PLANNING_ROUTE_CHRONOLOGY_RETURN_POINT_REQUIRED",
  RETURN_POINT_FORBIDDEN: "PLANNING_ROUTE_CHRONOLOGY_RETURN_POINT_FORBIDDEN",
} as const;

export type PlanningChronologyErrorCode =
  typeof PLANNING_CHRONOLOGY_ERROR_CODES[keyof typeof PLANNING_CHRONOLOGY_ERROR_CODES];

export interface PlanningChronologyIssue {
  code: PlanningChronologyErrorCode;
  message: string;
  chronologyMode: VideoChronologyMode;
}

interface ChronologyHookPolicy {
  allowedHookModes: readonly VideoHookMode[];
  allowedRevealLevels: readonly VideoHookRevealLevel[];
  requiresReturnPoint: boolean;
  defaultHookMode: VideoHookMode;
  defaultRevealLevel: VideoHookRevealLevel;
}

export const PLANNING_CHRONOLOGY_HOOK_POLICY = {
  chronological: {
    allowedHookModes: ["pain_point", "curiosity", "tease", "payoff_preview"],
    allowedRevealLevels: ["none", "partial"],
    requiresReturnPoint: false,
    defaultHookMode: "curiosity",
    defaultRevealLevel: "partial",
  },
  flashforward_hook: {
    allowedHookModes: ["payoff_preview"],
    allowedRevealLevels: ["partial", "full"],
    requiresReturnPoint: true,
    defaultHookMode: "payoff_preview",
    defaultRevealLevel: "partial",
  },
  result_first: {
    allowedHookModes: ["payoff_preview"],
    allowedRevealLevels: ["full"],
    requiresReturnPoint: true,
    defaultHookMode: "payoff_preview",
    defaultRevealLevel: "full",
  },
  problem_solution: {
    allowedHookModes: ["pain_point"],
    allowedRevealLevels: ["none", "partial"],
    requiresReturnPoint: false,
    defaultHookMode: "pain_point",
    defaultRevealLevel: "partial",
  },
  demonstration: {
    allowedHookModes: ["curiosity", "tease"],
    allowedRevealLevels: ["none", "partial"],
    requiresReturnPoint: false,
    defaultHookMode: "curiosity",
    defaultRevealLevel: "partial",
  },
} as const satisfies Record<VideoChronologyMode, ChronologyHookPolicy>;

export interface ChronologyDecisionSignals {
  explicitMode?: VideoChronologyMode;
  explicitlyRequestsFinalResultFirst?: boolean;
  explicitlyRequestsClimaxPreview?: boolean;
  payoffPreviewImprovesHook?: boolean;
  willReturnToEarlierTime?: boolean;
  hasProblemSolutionStructure?: boolean;
  isDemonstration?: boolean;
}

export interface PlanningChronologyResolution {
  chronologyMode: VideoChronologyMode;
  hookMode: VideoHookMode;
  hookRevealLevel: VideoHookRevealLevel;
  requiresReturnPoint: boolean;
  corrected: boolean;
  issues: PlanningChronologyIssue[];
}

export function selectChronologyMode(
  signals: ChronologyDecisionSignals,
): VideoChronologyMode {
  if (signals.explicitMode) return signals.explicitMode;
  if (signals.explicitlyRequestsFinalResultFirst) return "result_first";
  if (
    signals.explicitlyRequestsClimaxPreview
    && signals.payoffPreviewImprovesHook
    && signals.willReturnToEarlierTime
  ) {
    return "flashforward_hook";
  }
  if (signals.isDemonstration) return "demonstration";
  if (signals.hasProblemSolutionStructure) return "problem_solution";
  return "chronological";
}

export function validateChronologyHookPolicy(params: {
  chronologyMode: VideoChronologyMode;
  hookMode: VideoHookMode;
  hookRevealLevel: VideoHookRevealLevel;
  requiresReturnPoint: boolean;
}): PlanningChronologyIssue[] {
  const policy = PLANNING_CHRONOLOGY_HOOK_POLICY[params.chronologyMode];
  const issues: PlanningChronologyIssue[] = [];

  if (!policy.allowedHookModes.some((mode) => mode === params.hookMode)) {
    issues.push({
      code: PLANNING_CHRONOLOGY_ERROR_CODES.HOOK_MODE_MISMATCH,
      message: `hookMode ${params.hookMode} is not allowed for chronologyMode ${params.chronologyMode}`,
      chronologyMode: params.chronologyMode,
    });
  }

  if (!policy.allowedRevealLevels.some((level) => level === params.hookRevealLevel)) {
    issues.push({
      code: params.chronologyMode === "chronological" && params.hookRevealLevel === "full"
        ? PLANNING_CHRONOLOGY_ERROR_CODES.PAYOFF_REVEAL_FORBIDDEN
        : PLANNING_CHRONOLOGY_ERROR_CODES.REVEAL_LEVEL_MISMATCH,
      message: `hookRevealLevel ${params.hookRevealLevel} is not allowed for chronologyMode ${params.chronologyMode}`,
      chronologyMode: params.chronologyMode,
    });
  }

  if (policy.requiresReturnPoint && !params.requiresReturnPoint) {
    issues.push({
      code: PLANNING_CHRONOLOGY_ERROR_CODES.RETURN_POINT_REQUIRED,
      message: `chronologyMode ${params.chronologyMode} requires a return point`,
      chronologyMode: params.chronologyMode,
    });
  } else if (!policy.requiresReturnPoint && params.requiresReturnPoint) {
    issues.push({
      code: PLANNING_CHRONOLOGY_ERROR_CODES.RETURN_POINT_FORBIDDEN,
      message: `chronologyMode ${params.chronologyMode} must not require a return point`,
      chronologyMode: params.chronologyMode,
    });
  }

  return issues;
}

export function resolveChronologyHookPolicy(params: {
  chronologyMode: VideoChronologyMode;
  hookMode?: VideoHookMode;
  hookRevealLevel?: VideoHookRevealLevel;
  requiresReturnPoint?: boolean;
}): PlanningChronologyResolution {
  const policy = PLANNING_CHRONOLOGY_HOOK_POLICY[params.chronologyMode];
  const requested = {
    chronologyMode: params.chronologyMode,
    hookMode: params.hookMode ?? policy.defaultHookMode,
    hookRevealLevel: params.hookRevealLevel ?? policy.defaultRevealLevel,
    requiresReturnPoint: params.requiresReturnPoint ?? policy.requiresReturnPoint,
  };
  const issues = validateChronologyHookPolicy(requested);
  if (!issues.length) {
    return {
      ...requested,
      corrected: false,
      issues,
    };
  }
  return {
    chronologyMode: params.chronologyMode,
    hookMode: policy.defaultHookMode,
    hookRevealLevel: policy.defaultRevealLevel,
    requiresReturnPoint: policy.requiresReturnPoint,
    corrected: true,
    issues,
  };
}
