import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActionDraftPrompt,
  buildCombinedActionDraftPrompt,
  buildConsistencyGenerationPayload,
  buildExpressionDraftPrompt,
  buildFinalActionPrompt,
  buildArchiveImageFilename,
  buildNumberedCollageDraftPrompt,
  getNumberedCollageDraftRequestCount,
  buildSeriesActionDraftPrompt,
  buildSingleImageDraftPrompt,
  buildAssetQueryPath,
  buildAssetTagQueryPath,
  buildDefaultArchiveTags,
  buildDefaultArchiveImageTags,
  addTaskTag,
  buildExpressionTaskStats,
  collectReviewImages,
  EXPRESSION_STEP_TITLES,
  EXPRESSION_WORKFLOW_CATEGORY_VALUES,
  filterExistingAssetIds,
  getExpressionWorkflowCategoryOptions,
  getFilledActionList,
  getImageChoiceGridClasses,
  getImageArchiveTags,
  moveGeneratedImageToReviewBucket,
  moveReviewImageBackToRefine,
  directPassRefineSourceImage,
  skipRefineSourceImage,
  mergeDefaultArchiveImageTags,
  mergeUniqueNumbers,
  normalizeGeneratedImages,
  assignWorkflowImageIds,
  resolveWorkflowSessionStep,
  resolveExpressionWorkflowCategory,
  recommendExpressionModels,
  resetDraftGenerationState,
  resolveSelectedModelId,
} from "./expression-workflow.ts";
import { ASSET_CATEGORIES } from "./constants.ts";

test("filters selected asset ids to assets that still exist", () => {
  assert.deepEqual(
    filterExistingAssetIds(
      [1, 2, 3, 4],
      [
        { id: 2 },
        { id: 4 },
        { id: 4 },
      ],
    ),
    [2, 4],
  );
});

test("adds operation-oriented asset categories for expression workflows", () => {
  assert.equal(ASSET_CATEGORIES.some((category) => category.value === "game_content" && category.label === "游戏内容"), true);
  assert.equal(ASSET_CATEGORIES.some((category) => category.value === "holiday" && category.label === "节日形象"), true);
  assert.equal(ASSET_CATEGORIES.some((category) => category.value === "hot_topic" && category.label === "热点运营"), true);
});

test("limits Step 1 expression workflow categories to production categories", () => {
  const options = getExpressionWorkflowCategoryOptions(ASSET_CATEGORIES);
  assert.deepEqual(options.map((category) => category.value), EXPRESSION_WORKFLOW_CATEGORY_VALUES);
  assert.equal(options.some((category) => category.value === "bull_reference"), false);
  assert.equal(options.some((category) => category.value === "background"), false);
  assert.equal(options.some((category) => category.value === "prop"), false);
  assert.equal(options.some((category) => category.value === "hot_topic" && category.label === "热点运营"), true);
});

test("defaults expression workflow category to expression when restored value is missing or unsupported", () => {
  assert.equal(resolveExpressionWorkflowCategory("holiday"), "holiday");
  assert.equal(resolveExpressionWorkflowCategory("bull_reference"), "expression");
  assert.equal(resolveExpressionWorkflowCategory(""), "expression");
});

test("builds draft prompts from all fixed instructions plus complete extra prompt", () => {
  assert.equal(
    buildExpressionDraftPrompt(
      ["固定提示词 A", " 固定提示词 B "],
      "附加提示词第一行\n附加提示词第二行，动作完整。",
    ),
    "固定提示词 A\n\n固定提示词 B\n\n附加提示词第一行\n附加提示词第二行，动作完整。",
  );
});

test("builds archive filenames with a batch timestamp and index to avoid collisions", () => {
  assert.equal(buildArchiveImageFilename(1710000000000, 0, "png"), "expression-final-1710000000000-1.png");
  assert.equal(buildArchiveImageFilename(1710000000000, 1, "jpg"), "expression-final-1710000000000-2.jpg");
});

test("builds single-image draft prompt by removing arrangement text and appending the constraint", () => {
  const prompt = buildSingleImageDraftPrompt(
    "角色保持一致。横向一排排列，四个表情。动作是震惊张嘴。\n请做成一排展示。背景白色。",
  );

  assert.equal(
    prompt,
    "角色保持一致。\n动作是震惊张嘴。\n背景白色。\n\n只生成单张图片，图中只有一个角色，不要拼图，不要多角色排列。",
  );
  assert.equal(prompt.includes("横向一排排列"), false);
  assert.equal(prompt.includes("一排展示"), false);
});

test("keeps only filled action descriptions in order", () => {
  assert.deepEqual(
    getFilledActionList([" 双手举起欢呼 ", "", "嘴巴张开大笑", "   "]),
    ["双手举起欢呼", "嘴巴张开大笑"],
  );
});

test("builds one draft prompt per action and replaces action variables when present", () => {
  assert.equal(
    buildActionDraftPrompt(
      ["角色保持一致，动作是 {{action}}。"],
      "白色背景",
      "双手举起欢呼，嘴巴张开大笑",
    ),
    "角色保持一致，动作是 双手举起欢呼，嘴巴张开大笑。\n白色背景\n\n只生成单张图片，图中只有一个角色，不要拼图，不要多角色排列。",
  );

  assert.equal(
    buildActionDraftPrompt(["角色保持一致。"], "白色背景", "叉腰微笑"),
    "角色保持一致。\n白色背景\n动作：叉腰微笑\n\n只生成单张图片，图中只有一个角色，不要拼图，不要多角色排列。",
  );
});

test("builds a combined draft prompt for all action descriptions", () => {
  assert.equal(
    buildCombinedActionDraftPrompt(
      ["角色保持一致，动作参考 {{action}}。"],
      "白色背景",
      ["双手举起欢呼，嘴巴张开大笑", "叉腰微笑"],
    ),
    "角色保持一致，动作参考 见下方动作列表。\n白色背景\n\n请生成 2 张图，每张一只牛，动作各不相同，按以下描述分别生成：\n第1张动作：双手举起欢呼，嘴巴张开大笑\n第2张动作：叉腰微笑\n\n只生成单张图片规格，不要拼图，每张图只有一个角色。",
  );
});

test("builds a numbered collage draft prompt for all actions", () => {
  assert.equal(
    buildNumberedCollageDraftPrompt(
      ["角色保持一致，动作参考 {{action}}。"],
      "白色背景",
      ["惊讶张嘴", "双手欢呼"],
    ),
    "角色保持一致，动作参考 见下方编号动作表。\n白色背景\n\n请生成一张包含 2 格的拼图草稿，每格一只牛，动作各不相同，按以下描述分别生成：\n第1格：惊讶张嘴\n第2格：双手欢呼\n\n请在每格图的左上角或底部标注数字编号（1、2、3...），编号对应以下动作序号：\n第1格：惊讶张嘴\n第2格：双手欢呼\n每格只有一只牛，编号清晰可见。",
  );
});

test("uses filled action count for numbered collage draft requests", () => {
  assert.equal(getNumberedCollageDraftRequestCount(["惊讶张嘴", "双手欢呼", "叉腰微笑"]), 3);
  assert.equal(getNumberedCollageDraftRequestCount(["", "   "]), 0);
});

test("builds a final prompt for one selected action", () => {
  const prompt = buildFinalActionPrompt("保持角色一致，提升质感", "惊讶张嘴");

  assert.match(prompt, /动作：惊讶张嘴/);
  assert.match(prompt, /必须是卡通牛角色/);
  assert.match(prompt, /牛角/);
  assert.match(prompt, /牛脸/);
  assert.match(prompt, /不要变成熊/);
  assert.match(prompt, /只生成单张图片，一只牛，不要拼图。/);
});

test("replaces final action placeholders without appending a duplicate action line", () => {
  const prompt = buildFinalActionPrompt("保持角色一致，当前动作：{{action}}。", "叉腰微笑");

  assert.match(prompt, /当前动作：叉腰微笑。/);
  assert.equal(prompt.includes("{{action}}"), false);
  assert.equal(prompt.includes("动作：叉腰微笑\n"), false);
  assert.match(prompt, /必须是卡通牛角色/);
  assert.match(prompt, /只生成单张图片，一只牛，不要拼图。/);
});

test("builds a series-context draft prompt for one action", () => {
  assert.equal(
    buildSeriesActionDraftPrompt(
      ["角色保持一致，当前动作是 {{action}}。"],
      "白色背景",
      ["双手举起欢呼", "叉腰微笑"],
      1,
    ),
    "角色保持一致，当前动作是 叉腰微笑。\n白色背景\n\n你正在生成一个系列的第2张，共2张，每张动作各不相同。\n整个系列的动作规划：\n第1张：双手举起欢呼\n第2张：叉腰微笑\n\n现在请生成第2张，动作为：叉腰微笑\n只生成一只牛，单张图片，不要拼图，不要多角色。\n只生成单张图片，图中只有一个角色，不要拼图，不要多角色排列。",
  );
});

test("clears stale draft images before a new draft generation starts", () => {
  assert.deepEqual(
    resetDraftGenerationState({
      draftImages: [{ id: 1, url: "/old.png", type: "draft" }],
      selectedDraftImageIds: [1],
      finalImages: [{ id: 2, url: "/final.png", type: "final" }],
      actionList: ["挥手"],
    }),
    {
      draftImages: [],
      selectedDraftImageIds: [],
      finalImages: [{ id: 2, url: "/final.png", type: "final" }],
      actionList: ["挥手"],
    },
  );
});

test("recommends the cheapest available model for drafts and the highest priced available model for finals", () => {
  const recommendation = recommendExpressionModels([
    {
      id: 1,
      name: "Balanced",
      provider: "openai",
      model_name: "balanced-image",
      active: true,
      price_per_image: "0.0500",
      daily_limit: "100",
      used_today: "12",
    },
    {
      id: 2,
      name: "Premium",
      provider: "openai",
      model_name: "premium-image",
      active: true,
      price_per_image: "0.2000",
      daily_limit: "100",
      used_today: "1",
    },
    {
      id: 3,
      name: "Draft Cheap",
      provider: "google",
      model_name: "cheap-image",
      active: true,
      price_per_image: "0.0100",
      daily_limit: "100",
      used_today: "0",
    },
  ]);

  assert.equal(recommendation.draftModelId, "3");
  assert.equal(recommendation.finalModelId, "2");
  assert.equal(recommendation.draftRecommendedId, 3);
  assert.equal(recommendation.finalRecommendedId, 2);
});

test("recommends models from matching usage types", () => {
  const recommendation = recommendExpressionModels([
    {
      id: 1,
      name: "Final Only",
      provider: "openai",
      model_name: "final-image",
      usage_type: "final",
      active: true,
      price_per_image: "0.0300",
      daily_limit: "100",
      used_today: "0",
    },
    {
      id: 2,
      name: "Draft Only",
      provider: "google",
      model_name: "draft-image",
      usage_type: "draft",
      active: true,
      price_per_image: "0.2000",
      daily_limit: "100",
      used_today: "0",
    },
    {
      id: 3,
      name: "Both",
      provider: "openai",
      model_name: "both-image",
      usage_type: "both",
      active: true,
      price_per_image: "0.1000",
      daily_limit: "100",
      used_today: "0",
    },
  ]);

  assert.equal(recommendation.draftModelId, "3");
  assert.equal(recommendation.finalModelId, "3");
});

test("resolves an empty restored model id to the first available model option", () => {
  assert.equal(
    resolveSelectedModelId(
      [
        {
          id: 8,
          name: "High Final",
          provider: "openai",
          model_name: "gpt-image-2-all",
        },
        {
          id: 9,
          name: "Backup Final",
          provider: "openai",
          model_name: "gpt-image-2",
        },
      ],
      "",
    ),
    "8",
  );
  assert.equal(
    resolveSelectedModelId(
      [
        {
          id: 8,
          name: "High Final",
          provider: "openai",
          model_name: "gpt-image-2-all",
        },
      ],
      "999",
    ),
    "8",
  );
});

test("keeps a valid restored model id when resolving selection", () => {
  assert.equal(
    resolveSelectedModelId(
      [
        {
          id: 8,
          name: "High Final",
          provider: "openai",
          model_name: "gpt-image-2-all",
        },
        {
          id: 9,
          name: "Backup Final",
          provider: "openai",
          model_name: "gpt-image-2",
        },
      ],
      "9",
    ),
    "9",
  );
});

test("ignores inactive or exhausted models when recommending", () => {
  const recommendation = recommendExpressionModels([
    {
      id: 1,
      name: "Inactive",
      provider: "openai",
      model_name: "inactive-image",
      active: false,
      price_per_image: "0.0010",
      daily_limit: "0",
      used_today: "0",
    },
    {
      id: 2,
      name: "Exhausted",
      provider: "openai",
      model_name: "exhausted-image",
      active: true,
      price_per_image: "0.0020",
      daily_limit: "5",
      used_today: "5",
    },
    {
      id: 3,
      name: "Usable",
      provider: "google",
      model_name: "usable-image",
      active: true,
      price_per_image: "0.0100",
      daily_limit: "5",
      used_today: "2",
    },
  ]);

  assert.equal(recommendation.draftModelId, "3");
  assert.equal(recommendation.finalModelId, "3");
});

test("normalizes generated images from supported backend response fields", () => {
  const images = normalizeGeneratedImages(
    {
      task_id: 9,
      model_provider: "openai",
      model_name: "image-model",
      token_used: 0,
      cost_usd: 0,
      images: [
        { image_id: 11, image_url: "/static/generated/a.png" },
        { id: 12, url: "/static/generated/b.png" },
        { id: 13 },
      ],
    },
    "draft",
    1000,
  );

  assert.deepEqual(images, [
    { id: 11, url: "/static/generated/a.png", type: "draft" },
    { id: 12, url: "/static/generated/b.png", type: "draft" },
  ]);
});

test("assigns unique workflow-local ids even when provider image ids repeat", () => {
  assert.deepEqual(
    assignWorkflowImageIds(
      [
        { id: 7, url: "/generated/a.png", type: "final" },
        { id: 7, url: "/generated/b.png", type: "final" },
      ],
      9000,
    ),
    [
      { id: 9000, url: "/generated/a.png", type: "final" },
      { id: 9001, url: "/generated/b.png", type: "final" },
    ],
  );
});

test("merges numeric ids without duplicates", () => {
  assert.deepEqual(mergeUniqueNumbers([1, 2], [2, 3, 3]), [1, 2, 3]);
});

test("builds Step 3 asset query paths for all categories and tag filters", () => {
  assert.equal(buildAssetTagQueryPath("all"), "/api/assets/tags");
  assert.equal(buildAssetTagQueryPath("expression"), "/api/assets/tags?category=expression");
  assert.equal(
    buildAssetQueryPath("all", ["高兴", "哭泣"]),
    "/api/assets?tags=%E9%AB%98%E5%85%B4%2C%E5%93%AD%E6%B3%A3",
  );
  assert.equal(
    buildAssetQueryPath("bull_reference", ["标准 图"]),
    "/api/assets?category=bull_reference&tags=%E6%A0%87%E5%87%86%20%E5%9B%BE",
  );
});

test("defines the expression workflow as 9 ordered steps with consistency refinement before review", () => {
  assert.equal(EXPRESSION_STEP_TITLES.length, 9);
  assert.equal(EXPRESSION_STEP_TITLES[5], "精修成品");
  assert.equal(EXPRESSION_STEP_TITLES[6], "一致性精修");
  assert.equal(EXPRESSION_STEP_TITLES[7], "审核对比");
  assert.equal(EXPRESSION_STEP_TITLES[8], "归档");
});

test("resolves a requested workflow step from the URL when it is valid", () => {
  assert.equal(resolveWorkflowSessionStep(4, "full", "9", 9), 9);
  assert.equal(resolveWorkflowSessionStep(6, "refine", "7", 9), 7);
});

test("falls back to the saved workflow step when the requested URL step is invalid", () => {
  assert.equal(resolveWorkflowSessionStep(4, "full", "12", 9), 4);
  assert.equal(resolveWorkflowSessionStep(4, "full", "abc", 9), 4);
  assert.equal(resolveWorkflowSessionStep(0, "refine", "", 9), 6);
});

test("collects Step 6 and Step 7 images for review without duplicates", () => {
  assert.deepEqual(
    collectReviewImages(
      [
        { id: 1, url: "/final-a.png", type: "final" },
        { id: 2, url: "/final-b.png", type: "final" },
      ],
      [
        { id: 2, url: "/consistency-duplicate.png", type: "consistency" },
        { id: 3, url: "/consistency-c.png", type: "consistency" },
      ],
    ),
    [
      { id: 1, url: "/final-a.png", type: "final" },
      { id: 2, url: "/final-b.png", type: "final" },
      { id: 3, url: "/consistency-c.png", type: "consistency" },
    ],
  );
});

test("moves a Step 6 final image into direct archive or refinement buckets", () => {
  const finalImages = [
    { id: 1, url: "/final-a.png", type: "final" as const },
    { id: 2, url: "/final-b.png", type: "final" as const },
  ];

  assert.deepEqual(
    moveGeneratedImageToReviewBucket(finalImages, [], [], 1, "confirmed"),
    {
      remainingImages: [{ id: 2, url: "/final-b.png", type: "final" }],
      confirmedImages: [{ id: 1, url: "/final-a.png", type: "final" }],
      toRefineImages: [],
    },
  );

  assert.deepEqual(
    moveGeneratedImageToReviewBucket(finalImages, [], [], 2, "refine"),
    {
      remainingImages: [{ id: 1, url: "/final-a.png", type: "final" }],
      confirmedImages: [],
      toRefineImages: [{ id: 2, url: "/final-b.png", type: "final" }],
    },
  );
});

test("returns a confirmed review image back to the refinement bucket", () => {
  const confirmedImages = [
    { id: 3, url: "/archive-a.png", type: "consistency" as const },
    { id: 4, url: "/archive-b.png", type: "final" as const },
  ];

  assert.deepEqual(
    moveReviewImageBackToRefine(confirmedImages, [], 3),
    {
      confirmedImages: [{ id: 4, url: "/archive-b.png", type: "final" }],
      toRefineImages: [{ id: 3, url: "/archive-a.png", type: "consistency" }],
    },
  );
});

test("directly passes a Step 7 source image into confirmed images", () => {
  assert.deepEqual(
    directPassRefineSourceImage(
      [{ id: 10, url: "/confirmed.png", type: "final" }],
      [
        { id: 1, url: "/needs-refine-a.png", type: "final" },
        { id: 2, url: "/needs-refine-b.png", type: "final" },
      ],
      [
        { id: 20, url: "/result-a.png", type: "consistency", sourceImageId: 1 },
        { id: 21, url: "/result-b.png", type: "consistency", sourceImageId: 2 },
      ],
      1,
    ),
    {
      confirmedImages: [
        { id: 10, url: "/confirmed.png", type: "final" },
        { id: 1, url: "/needs-refine-a.png", type: "final" },
      ],
      toRefineImages: [{ id: 2, url: "/needs-refine-b.png", type: "final" }],
      consistencyImages: [{ id: 21, url: "/result-b.png", type: "consistency", sourceImageId: 2 }],
    },
  );
});

test("skips a Step 7 source image without promoting it to confirmed images", () => {
  assert.deepEqual(
    skipRefineSourceImage(
      [{ id: 10, url: "/confirmed.png", type: "final" }],
      [
        { id: 1, url: "/needs-refine-a.png", type: "final" },
        { id: 2, url: "/needs-refine-b.png", type: "final" },
      ],
      [
        { id: 20, url: "/result-a.png", type: "consistency", sourceImageId: 1 },
        { id: 21, url: "/result-b.png", type: "consistency", sourceImageId: 2 },
      ],
      1,
    ),
    {
      confirmedImages: [{ id: 10, url: "/confirmed.png", type: "final" }],
      toRefineImages: [{ id: 2, url: "/needs-refine-b.png", type: "final" }],
      consistencyImages: [{ id: 21, url: "/result-b.png", type: "consistency", sourceImageId: 2 }],
    },
  );
});

test("builds Step 7 consistency payload without sending local image ids as draft ids", () => {
  const payload = buildConsistencyGenerationPayload({
    taskId: 33,
    modelConfigId: 8,
    modelProvider: "openai",
    modelName: "gpt-image-2",
    prompt: "保持角色一致性重新生成",
    size: "1024x1024",
    referenceAssetIds: [1, 2],
    sourceAssetId: 99,
    sourceImageId: 1777608371901,
  });

  assert.deepEqual(payload.reference_asset_ids, [99, 1, 2]);
  assert.equal(Object.hasOwn(payload, "draft_image_id"), false);
});

test("uses larger image grid classes for Step 6 draft previews and final results", () => {
  assert.match(getImageChoiceGridClasses("step6Draft").container, /minmax\(200px,1fr\)/);
  assert.match(getImageChoiceGridClasses("step6Final").container, /minmax\(240px,1fr\)/);
  assert.match(getImageChoiceGridClasses("step6Draft").image, /min-h-\[200px\]/);
  assert.match(getImageChoiceGridClasses("step6Final").image, /min-h-\[240px\]/);
});

test("defaults archive tags from Step 1 task tags when entering archive", () => {
  assert.deepEqual(
    buildDefaultArchiveTags(["表情", "开心", " 牛 "]),
    ["表情", "开心", "牛"],
  );
});

test("adds custom Step 1 task tags with trimming and de-duplication", () => {
  assert.deepEqual(addTaskTag(["开心"], " 牛 "), ["开心", "牛"]);
  assert.deepEqual(addTaskTag(["开心", "牛"], "牛"), ["开心", "牛"]);
  assert.deepEqual(addTaskTag(["开心"], "   "), ["开心"]);
});

test("initializes per-image archive tags from Step 1 task tags", () => {
  assert.deepEqual(
    buildDefaultArchiveImageTags([11, 12], ["表情", "开心", "开心"]),
    {
      11: ["表情", "开心"],
      12: ["表情", "开心"],
    },
  );
});

test("fills missing per-image archive tags without replacing edited image tags", () => {
  assert.deepEqual(
    mergeDefaultArchiveImageTags(
      [11, 12, 13],
      ["表情", "开心"],
      {
        11: ["泰语"],
        12: [],
      },
    ),
    {
      11: ["泰语"],
      12: [],
      13: ["表情", "开心"],
    },
  );
});

test("resolves per-image archive tags with explicit image overrides", () => {
  const archiveImageTags = {
    11: ["表情", "开心"],
    12: ["泰语"],
    13: [],
  };

  assert.deepEqual(getImageArchiveTags(11, archiveImageTags, ["默认"]), ["表情", "开心"]);
  assert.deepEqual(getImageArchiveTags(12, archiveImageTags, ["默认"]), ["泰语"]);
  assert.deepEqual(getImageArchiveTags(13, archiveImageTags, ["默认"]), []);
  assert.deepEqual(getImageArchiveTags(14, archiveImageTags, ["默认"]), ["默认"]);
});

test("builds Step 9 task status stats with fallbacks from workflow queues", () => {
  assert.deepEqual(
    buildExpressionTaskStats({
      actionList: ["挥手", "", "大笑"],
      draftImages: [
        { id: 1, url: "/draft.png", type: "draft" },
      ],
      finalGeneratedCount: 0,
      finalImages: [
        { id: 2, url: "/final-pending.png", type: "final" },
      ],
      confirmedImages: [
        { id: 3, url: "/final-confirmed.png", type: "final" },
        { id: 4, url: "/refined-confirmed.png", type: "consistency" },
      ],
      toRefineImages: [
        { id: 5, url: "/needs-refine.png", type: "final" },
      ],
      consistencyImages: [
        { id: 6, url: "/refined-pending.png", type: "consistency" },
      ],
      refinedImageCount: 0,
      archivedImageCount: 2,
    }),
    {
      actionCount: 2,
      draftCount: 1,
      finalGeneratedCount: 3,
      refinedImageCount: 2,
      archivedImageCount: 2,
    },
  );
});
