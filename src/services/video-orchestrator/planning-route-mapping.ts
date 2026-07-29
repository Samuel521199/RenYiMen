import type {
  VideoCreativeCategory,
  VideoCreativeTemplateId,
} from "./types";

export const PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP = {
  game: ["game_reversal", "game_bonus_payoff"],
  product: ["product_problem_solution"],
  ecommerce: ["ecommerce_offer_conversion"],
  food: ["food_sensory_reaction"],
  auto: ["auto_performance_hero"],
  short_drama: ["short_drama_conflict_twist"],
  brand: ["generic_brand_story"],
  tutorial: ["generic_brand_story"],
  custom: ["generic_brand_story"],
} as const satisfies Record<VideoCreativeCategory, readonly VideoCreativeTemplateId[]>;

export const PLANNING_ROUTE_MAPPING_ERROR_CODES = {
  CATEGORY_MISSING: "PLANNING_ROUTE_CATEGORY_MISSING",
  TEMPLATE_MISSING: "PLANNING_ROUTE_TEMPLATE_MISSING",
  CATEGORY_TEMPLATE_MISMATCH: "PLANNING_ROUTE_CATEGORY_TEMPLATE_MISMATCH",
  GAME_SEMANTICS_FORBIDDEN: "PLANNING_ROUTE_GAME_SEMANTICS_FORBIDDEN",
} as const;

export type PlanningRouteMappingErrorCode =
  typeof PLANNING_ROUTE_MAPPING_ERROR_CODES[keyof typeof PLANNING_ROUTE_MAPPING_ERROR_CODES];

export interface PlanningRouteMappingIssue {
  code: PlanningRouteMappingErrorCode;
  message: string;
  videoCategory: VideoCreativeCategory;
  templateId?: VideoCreativeTemplateId;
  matchedTerms?: string[];
}

export interface PlanningRouteMappingResolution {
  videoCategory: VideoCreativeCategory;
  templateId: VideoCreativeTemplateId;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  issues: PlanningRouteMappingIssue[];
}

const DEFAULT_TEMPLATE_BY_CATEGORY = {
  game: "game_reversal",
  product: "product_problem_solution",
  ecommerce: "ecommerce_offer_conversion",
  food: "food_sensory_reaction",
  auto: "auto_performance_hero",
  short_drama: "short_drama_conflict_twist",
  brand: "generic_brand_story",
  tutorial: "generic_brand_story",
  custom: "generic_brand_story",
} as const satisfies Record<VideoCreativeCategory, VideoCreativeTemplateId>;

const DEFAULT_CATEGORY_BY_TEMPLATE = {
  game_reversal: "game",
  game_bonus_payoff: "game",
  product_problem_solution: "product",
  ecommerce_offer_conversion: "ecommerce",
  food_sensory_reaction: "food",
  auto_performance_hero: "auto",
  short_drama_conflict_twist: "short_drama",
  generic_brand_story: "brand",
} as const satisfies Record<VideoCreativeTemplateId, VideoCreativeCategory>;

const GAME_ONLY_SEMANTIC_PATTERNS = [
  { term: "jackpot", pattern: /\bjackpot\b/i },
  { term: "bonus", pattern: /\bbonus\b/i },
  { term: "leaderboard", pattern: /\bleaderboard\b/i },
  { term: "爆奖", pattern: /爆奖/ },
  { term: "奖池", pattern: /奖池/ },
  { term: "排行榜", pattern: /排行榜/ },
  { term: "连胜", pattern: /连胜/ },
  { term: "金币倍率", pattern: /金币倍率/ },
] as const;

const GAME_BONUS_ROUTE_PATTERN = /\b(?:bonus|jackpot|reward|multiplier)\b|金币|倍率|奖励|爆奖|奖池/i;

export function allowedTemplatesForCategory(
  videoCategory: VideoCreativeCategory,
): readonly VideoCreativeTemplateId[] {
  return PLANNING_ROUTE_CATEGORY_TEMPLATE_MAP[videoCategory];
}

export function isAllowedCategoryTemplateCombination(
  videoCategory: VideoCreativeCategory,
  templateId: VideoCreativeTemplateId,
): boolean {
  return allowedTemplatesForCategory(videoCategory).some((allowed) => allowed === templateId);
}

export function defaultCategoryForTemplate(
  templateId: VideoCreativeTemplateId,
): VideoCreativeCategory {
  return DEFAULT_CATEGORY_BY_TEMPLATE[templateId];
}

export function deterministicTemplateForCategory(
  videoCategory: VideoCreativeCategory,
  semanticText = "",
): VideoCreativeTemplateId {
  if (videoCategory === "game" && GAME_BONUS_ROUTE_PATTERN.test(semanticText)) {
    return "game_bonus_payoff";
  }
  return DEFAULT_TEMPLATE_BY_CATEGORY[videoCategory];
}

export function validateCategoryTemplateCombination(
  videoCategory: VideoCreativeCategory,
  templateId: VideoCreativeTemplateId,
): PlanningRouteMappingIssue[] {
  if (isAllowedCategoryTemplateCombination(videoCategory, templateId)) return [];
  return [{
    code: PLANNING_ROUTE_MAPPING_ERROR_CODES.CATEGORY_TEMPLATE_MISMATCH,
    message: `templateId ${templateId} is not allowed for videoCategory ${videoCategory}`,
    videoCategory,
    templateId,
  }];
}

export function validateNonGameRouteSemantics(
  videoCategory: VideoCreativeCategory,
  generatedRouteText: string,
): PlanningRouteMappingIssue[] {
  if (videoCategory === "game") return [];
  const matchedTerms = GAME_ONLY_SEMANTIC_PATTERNS
    .filter(({ pattern }) => pattern.test(generatedRouteText))
    .map(({ term }) => term);
  if (!matchedTerms.length) return [];
  return [{
    code: PLANNING_ROUTE_MAPPING_ERROR_CODES.GAME_SEMANTICS_FORBIDDEN,
    message: `non-game category ${videoCategory} contains game-only semantics: ${matchedTerms.join(", ")}`,
    videoCategory,
    matchedTerms,
  }];
}

export function resolveCategoryTemplateMapping(params: {
  videoCategory?: VideoCreativeCategory;
  templateId?: VideoCreativeTemplateId;
  semanticText?: string;
}): PlanningRouteMappingResolution {
  const issues: PlanningRouteMappingIssue[] = [];
  const videoCategory = params.videoCategory
    ?? (params.templateId ? defaultCategoryForTemplate(params.templateId) : "custom");

  if (!params.videoCategory) {
    issues.push({
      code: PLANNING_ROUTE_MAPPING_ERROR_CODES.CATEGORY_MISSING,
      message: params.templateId
        ? `videoCategory missing; derived ${videoCategory} from templateId ${params.templateId}`
        : "videoCategory missing; using custom as the deterministic safe category",
      videoCategory,
      templateId: params.templateId,
    });
  }

  let templateId = params.templateId;
  if (!templateId) {
    templateId = deterministicTemplateForCategory(videoCategory, params.semanticText);
    issues.push({
      code: PLANNING_ROUTE_MAPPING_ERROR_CODES.TEMPLATE_MISSING,
      message: `templateId missing; using deterministic template ${templateId} for videoCategory ${videoCategory}`,
      videoCategory,
      templateId,
    });
  } else {
    const combinationIssues = validateCategoryTemplateCombination(videoCategory, templateId);
    if (combinationIssues.length) {
      issues.push(...combinationIssues);
      templateId = deterministicTemplateForCategory(videoCategory, params.semanticText);
    }
  }

  const fallbackUsed = issues.length > 0;
  return {
    videoCategory,
    templateId,
    fallbackUsed,
    fallbackReason: fallbackUsed ? issues.map((issue) => issue.message).join("; ") : null,
    issues,
  };
}
