import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const workspaceRoot = process.cwd();
const fixtureRoot = path.join(workspaceRoot, "src", "services", "video-orchestrator", "__fixtures__", "phase0");

type JsonRecord = Record<string, unknown>;

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(path.join(fixtureRoot, relativePath), "utf8")) as JsonRecord;
}

function readSource(relativePath: string): string {
  return readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

function asRecord(value: unknown): JsonRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as JsonRecord;
}

function asArray(value: unknown): unknown[] {
  assert.equal(Array.isArray(value), true);
  return value as unknown[];
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

const manifest = readJson("baseline-manifest.json");
const fixtureNames = asArray(manifest.fixtures) as string[];

test("phase 0 records the current plan, planner, prompt, and compiler versions", () => {
  assert.equal(manifest.schemaVersion, "plan-json");
  assert.equal(manifest.plannerArchitecture, "v2");
  assert.equal(manifest.plannerVersion, "v2");
  assert.equal(manifest.promptVersion, "v2");
  assert.equal(manifest.compilerVersion, "prompt-compiler-v1");
  assert.deepEqual(manifest.assetViews, ["front", "side", "back"]);
  assert.equal(manifest.mediaRevisionLimitPerArtifact, 10);
  assert.ok(fixtureNames.length >= 5);
  const storyBaseline = asRecord(manifest.storyBaseline);
  assert.deepEqual(asArray(storyBaseline.minimumCategories), ["game", "product", "ecommerce", "food", "short_drama"]);
  assert.ok(asArray(storyBaseline.knownLegacyFailureExamples).length > 0);
});

test("phase 0 freezes the required pre-story-gate story categories", () => {
  const categories = new Set(fixtureNames.map((fixtureName) => String(asRecord(readJson(fixtureName).storyBaseline).videoCategory)));

  for (const category of ["game", "product", "ecommerce", "food", "short_drama"]) {
    assert.ok(categories.has(category), `missing phase 0 story baseline fixture category: ${category}`);
  }
});

for (const fixtureName of fixtureNames) {
  test(`${fixtureName} preserves a complete synthetic regression project`, () => {
    const fixture = readJson(fixtureName);
    const baseline = asRecord(fixture.storyBaseline);
    const project = asRecord(fixture.project);
    const input = asRecord(project.input);
    const plan = asRecord(project.planJson);
    const assetLibrary = asRecord(plan.assetLibrary);
    const items = asArray(assetLibrary.items).map(asRecord);
    const personViews = items
      .filter((item) => item.category === "person")
      .map((item) => item.view)
      .sort();
    const keyframes = asArray(plan.keyframes).map(asRecord);
    const segments = asArray(plan.segments).map(asRecord);

    assert.equal(typeof input.userPrompt, "string");
    assert.ok((input.userPrompt as string).length > 0);
    assert.equal(typeof baseline.videoCategory, "string");
    assert.equal(baseline.legacyPlannerBehavior, "pre-story-gate");
    assert.equal(baseline.capturedForStep, "16.1-phase0-freeze-current-baseline");
    assert.ok(asArray(baseline.knownCurrentFailurePoints).length > 0);
    assert.equal(typeof baseline.comparisonGoal, "string");
    assert.deepEqual(personViews, ["back", "front", "side"]);
    assert.ok(keyframes.length >= 3, "boundary keyframes must be present");
    assert.ok(keyframes.every((keyframe) => typeof keyframe.imageUrl === "string"));
    assert.ok(segments.length >= 2, "video segments must be present");
    assert.ok(segments.every((segment) => typeof segment.clipUrl === "string"));
    assert.ok(segments.every((segment) => asArray(segment.microShots).some((shot) => typeof asRecord(shot).imageUrl === "string")));
    assert.ok(asArray(plan.referenceSelectionOutputs).length > 0);
    assert.ok(Object.keys(asRecord(plan.promptDebugArtifacts)).length > 0);
    assert.ok(asArray(plan.generationQualityReports).length > 0);
    assert.ok(Object.keys(asRecord(plan.mediaRevisionHistory)).length > 0);
    assert.match(String(project.finalVideoUrl), /^fixture:\/\//);
  });

  test(`${fixtureName} contains no credentials, personal identifiers, or signed media URLs`, () => {
    const fixture = readJson(fixtureName);
    const serialized = JSON.stringify(fixture);
    const strings = collectStrings(fixture);
    const urlLikeStrings = strings.filter((value) => /^(?:https?|fixture):\/\//i.test(value));

    assert.doesNotMatch(serialized, /(?:api[_-]?key|secret[_-]?key|authorization|bearer\s|access[_-]?token|session[_-]?token|x-amz-signature)/i);
    assert.doesNotMatch(serialized, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    assert.doesNotMatch(serialized, /(?:\+?86[- ]?)?1[3-9]\d{9}/);
    assert.ok(urlLikeStrings.length > 0);
    assert.ok(urlLikeStrings.every((value) => value.startsWith("fixture://")));
  });
}

test("person assets remain front, side, and back views", () => {
  const source = readSource("src/services/video-orchestrator/project-service.ts");
  assert.match(source, /if \(category === "person"\) return \["front", "side", "back"\];/);
});

test("the latest persisted user image prompt remains authoritative", () => {
  const source = readSource("src/services/video-orchestrator/project-service.ts");
  assert.match(source, /const sourceImagePrompt = sanitizeGameVisualPromptText\(stripNonStandardPromptSymbols\(keyframe\.imagePrompt\), stylePreset, \{ brandVisual: brandVisualAsset \}\);/);
  assert.match(source, /source_image_prompt is authoritative for subject count, pose, framing, and background/);
  assert.match(source, /Localized plan fields may[\s\S]*only be fallbacks/);
});

test("story design contract fields are optional and visible in plan debug", () => {
  const typesSource = readSource("src/services/video-orchestrator/types.ts");
  const serviceSource = readSource("src/services/video-orchestrator/project-service.ts");

  for (const typeName of [
    "VideoCreativeStrategy",
    "VideoStoryBeat",
    "VideoNarrativeMicroRules",
    "VideoShotGroupingPass",
    "VideoStoryQualityReport",
  ]) {
    assert.match(typesSource, new RegExp(`export interface ${typeName}`));
  }

  for (const fieldName of [
    "creativeStrategy",
    "storyBeats",
    "narrativeMicroRules",
    "shotGroupingPass",
    "storyQualityReport",
  ]) {
    assert.match(typesSource, new RegExp(`${fieldName}\\?`));
    assert.match(serviceSource, new RegExp(`${fieldName}:`));
  }

  assert.match(serviceSource, /creative_strategy/);
  assert.match(serviceSource, /story_beats/);
  assert.match(serviceSource, /narrative_micro_rules/);
  assert.match(serviceSource, /shot_grouping_pass/);
  assert.match(serviceSource, /story_quality_report/);
});

test("planner emits story design structures as non-blocking trace metadata", () => {
  const typesSource = readSource("src/services/video-orchestrator/types.ts");
  const plannerSource = readSource("src/services/video-orchestrator/three-stage-planner.ts");

  for (const fieldName of [
    "linkedBeatIds",
    "storyFunction",
    "emotionalBeat",
    "cause",
    "effect",
    "informationUnit",
    "keyEvidenceIds",
    "actionContinuity",
    "reactionBeat",
    "powerShift",
  ]) {
    assert.match(typesSource, new RegExp(`${fieldName}\\?`));
  }

  assert.match(plannerSource, /First output creative_strategy before narrative_events/);
  assert.match(plannerSource, /Create story_beats before or alongside storyboard_brief/);
  assert.match(plannerSource, /Every segment must include linked_beat_ids/);
  assert.match(plannerSource, /normalizeCreativeStrategy/);
  assert.match(plannerSource, /normalizeStoryBeats/);
  assert.match(plannerSource, /normalizeSegmentStoryTrace/);
  assert.match(plannerSource, /storyDesign storyBeats missing; derived fallback beats/);
  assert.match(plannerSource, /当前阶段只记录 warning，不阻断生成/);
  assert.doesNotMatch(plannerSource, /throw new Error\([^)]*storyDesign/);
});

test("planner routes video categories to template-specific minimum beat structures", () => {
  const typesSource = readSource("src/services/video-orchestrator/types.ts");
  const plannerSource = readSource("src/services/video-orchestrator/three-stage-planner.ts");

  for (const templateId of [
    "game_reversal",
    "game_bonus_payoff",
    "product_problem_solution",
    "ecommerce_offer_conversion",
    "food_sensory_reaction",
    "auto_performance_hero",
    "short_drama_conflict_twist",
    "generic_brand_story",
  ]) {
    assert.match(typesSource, new RegExp(`"${templateId}"`));
    assert.match(plannerSource, new RegExp(`${templateId}:`));
  }

  assert.match(typesSource, /videoCategory\?: VideoCreativeCategory/);
  assert.match(typesSource, /templateId\?: VideoCreativeTemplateId/);
  assert.match(typesSource, /templateReason\?: string/);
  assert.match(typesSource, /conversionGoal\?: string/);
  assert.match(plannerSource, /Route the task to exactly one initial template_id/);
  assert.match(plannerSource, /fallback_reason_zh/);
  assert.match(plannerSource, /classifyVideoCategoryFromText/);
  assert.match(plannerSource, /templateForCategory/);
  assert.match(plannerSource, /fallbackStoryBeatRecordsForTemplate/);

  const productTemplate = plannerSource.slice(
    plannerSource.indexOf("product_problem_solution:"),
    plannerSource.indexOf("ecommerce_offer_conversion:"),
  );
  assert.doesNotMatch(productTemplate, /bonus|jackpot|opponent|leaderboard|对手震惊|金币|排行榜/i);
  assert.match(productTemplate, /真实痛点/);
  assert.match(productTemplate, /产品介入/);
  assert.match(productTemplate, /效果证明/);

  const foodTemplate = plannerSource.slice(
    plannerSource.indexOf("food_sensory_reaction:"),
    plannerSource.indexOf("auto_performance_hero:"),
  );
  assert.match(foodTemplate, /食材\/出餐吸引/);
  assert.match(foodTemplate, /感官证明/);
  assert.match(foodTemplate, /顾客第一口反应/);
  assert.match(foodTemplate, /门店\/套餐 CTA/);

  const genericTemplate = plannerSource.slice(
    plannerSource.indexOf("generic_brand_story:"),
    plannerSource.indexOf("};", plannerSource.indexOf("generic_brand_story:")),
  );
  for (const storyFunction of ["hook", "conflict", "proof", "payoff", "cta"]) {
    assert.match(genericTemplate, new RegExp(`storyFunction: "${storyFunction}"`));
  }
});

test("story quality auto rewrite is wired before plan review persistence", () => {
  const plannerSource = readSource("src/services/video-orchestrator/three-stage-planner.ts");
  const serviceSource = readSource("src/services/video-orchestrator/project-service.ts");

  assert.match(plannerSource, /const MAX_STORY_QUALITY_REWRITES = 2;/);
  assert.match(plannerSource, /readStoryRolloutConfig/);
  assert.match(plannerSource, /shouldAttemptStoryRewrite/);
  assert.match(plannerSource, /shouldRequireStoryQualityReview/);
  assert.match(plannerSource, /STORY_QUALITY_REWRITE_SYSTEM_PROMPT/);
  assert.match(plannerSource, /rewriteStoryPlanUntilQualityPass/);
  assert.match(plannerSource, /story_quality_rewrite\.decision/);
  assert.match(plannerSource, /markStoryRewriteRequired/);
  assert.match(serviceSource, /storyGateMode: storyRolloutConfig\.storyGateMode/);
  assert.match(serviceSource, /rewriteRequired: plan\.storyQualityReport\?\.rewriteRequired/);
  assert.match(serviceSource, /autoRewriteAttempts: plan\.storyQualityReport\?\.autoRewriteAttempts/);
});

test("prompt compiler injects narrative contracts into boundary images and segment videos", () => {
  const source = readSource("src/services/video-orchestrator/project-service.ts");

  assert.match(source, /function narrativePromptContextForKeyframe/);
  assert.match(source, /function narrativePromptContextForSegment/);
  assert.match(source, /Narrative boundary contract \(must be visible in this still image\)/);
  for (const field of [
    "linkedBeatId",
    "storyMoment",
    "requiredVisibleEvidence",
    "forbiddenEvidence",
    "narrativeStateBefore",
    "narrativeStateAfter",
  ]) {
    assert.match(source, new RegExp(`${field}:`));
  }
  assert.match(source, /Narrative execution contract for this segment/);
  for (const field of ["storyFunction", "cause", "effect", "actionContinuity", "reactionBeat", "keyEvidenceIds"]) {
    assert.match(source, new RegExp(`${field}`));
  }
  assert.match(source, /the video model must ONLY animate the visible transition/);
  assert.match(source, /Do not invent missing plot events/);
  assert.match(source, /narrative_boundary_contract_injected/);
  assert.match(source, /narrative_contract_injected/);
  assert.match(source, /model_must_not_invent_story/);
});

test("plan review no longer blocks asset workflow with narrative skeleton UI", () => {
  const pageSource = readSource("src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");
  const serviceSource = readSource("src/services/video-orchestrator/project-service.ts");

  assert.doesNotMatch(pageSource, /<NarrativeSkeletonReview/);
  assert.doesNotMatch(pageSource, /storyQualityBlocksPlan/);
  assert.match(pageSource, /function NarrativeSkeletonReview/);
  assert.match(pageSource, /Story Quality Report/);
  assert.match(serviceSource, /patch\.creativeStrategy/);
  assert.match(serviceSource, /patch\.storyBeats/);
  assert.match(serviceSource, /planning:creative_strategy/);
  assert.match(serviceSource, /planning:story_beats/);
});

test("the editor keeps undo support for keyframes, segments, checkpoints, and debug sections", () => {
  const source = readSource("src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");
  assert.match(source, /function undoKeyframeField\(field: "purpose" \| "imagePrompt" \| "negativePrompt"\)/);
  assert.match(source, /function undoShotField\(field: "durationSeconds" \| "purpose" \| "action" \| "camera" \| "subtitle" \| "videoPrompt"\)/);
  assert.match(source, /function undoDraftMicroShot\(index: number\)/);
  assert.match(source, /function undoDebugSection\(section: EditableDebugSection\)/);
});

test("media rollback remains available for every generated media class", () => {
  const typesSource = readSource("src/services/video-orchestrator/types.ts");
  const serviceSource = readSource("src/services/video-orchestrator/project-service.ts");
  const pageSource = readSource("src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx");

  for (const kind of ["keyframe_image", "micro_shot_image", "segment_clip", "final_video"]) {
    assert.match(typesSource, new RegExp(`"${kind}"`));
  }
  assert.match(serviceSource, /export async function rollbackVideoMedia/);
  assert.match(serviceSource, /const MAX_MEDIA_REVISIONS_PER_TARGET = 10;/);
  assert.match(serviceSource, /revisions\.slice\(-MAX_MEDIA_REVISIONS_PER_TARGET\)/);
  for (const kind of ["keyframe_image", "micro_shot_image", "segment_clip", "final_video"]) {
    assert.match(pageSource, new RegExp(`rollbackMedia\\(\"${kind}\"`));
  }
});

test("boundary image generation remains gated on approved consistency assets", () => {
  const source = readSource("src/services/video-orchestrator/project-service.ts");
  assert.match(source, /const unapprovedConsistencyReferences = consistencyReferences\.filter/);
  assert.match(source, /Hard consistency reference images are ready\. Lock or approve them before generating boundary keyframes\./);
  assert.match(source, /waitingForConsistencyReferences\s*\? \[\]/);
  assert.match(source, /assetLibraryFirst/);
  assert.match(source, /asset_library\.batch/);
  assert.match(source, /Boundary keyframes start only after asset approval/);
});
