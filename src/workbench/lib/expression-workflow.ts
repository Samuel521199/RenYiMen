export interface AvailableExpressionModel {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  usage_type?: "draft" | "final" | "both" | string | null;
  active?: boolean;
  price_per_image?: string | number | null;
  daily_limit?: string | number | null;
  used_today?: string | number | null;
}

export interface GeneratedImageLike {
  id: number;
  url: string;
  type: "draft" | "final" | "upload" | "consistency";
}

export type ImageChoiceGridVariant = "compact" | "step6Draft" | "step6Final";

interface GenerateResponseLike {
  task_id?: number;
  model_provider?: string;
  model_name?: string;
  token_used?: number;
  cost_usd?: number;
  images?: Array<{
    image_id?: number;
    id?: number;
    url?: string;
    image_url?: string;
    type?: string;
  }>;
}

function numericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const EXPRESSION_STEP_TITLES = [
  "任务基础信息",
  "提示词配置",
  "参考素材选择",
  "规格设置",
  "草稿生成",
  "精修成品",
  "一致性精修",
  "审核对比",
  "归档",
];

export const EXPRESSION_WORKFLOW_CATEGORY_VALUES = ["expression", "action", "game_content", "holiday", "hot_topic"];
export const SINGLE_IMAGE_DRAFT_CONSTRAINT = "只生成单张图片，图中只有一个角色，不要拼图，不要多角色排列。";
export const FINAL_COW_CHARACTER_LOCK =
  "角色锁定：必须是卡通牛角色，反复保持牛角、牛脸、牛鼻子、牛耳朵、牛的身体比例和参考图服饰特征；不要变成熊、狗、鹿或其他动物。";
export const DEFAULT_ACTION_LIST = ["", "", "", ""];

const VIDEO_MODEL_KEYWORDS = ["kling", "video", "wan", "vidu", "runway", "sora", "minimax-video", "hailuo", "veo"];

export function isImageGenerationModel(model: AvailableExpressionModel) {
  const provider = String(model.provider || "").toLowerCase();
  if (provider === "kling_video" || provider === "veo" || provider === "runway") {
    return false;
  }
  const haystacks = [
    String(model.model_name || "").toLowerCase(),
    String(model.name || "").toLowerCase(),
  ];
  return !VIDEO_MODEL_KEYWORDS.some((keyword) =>
    haystacks.some((value) => value.includes(keyword)),
  );
}

export function getExpressionWorkflowCategoryOptions<T extends { value: string; label: string }>(categories: T[]) {
  return (Array.isArray(categories) ? categories : []).filter((category) =>
    EXPRESSION_WORKFLOW_CATEGORY_VALUES.includes(category.value),
  );
}

export function resolveExpressionWorkflowCategory(category: string | null | undefined) {
  const value = String(category || "");
  return EXPRESSION_WORKFLOW_CATEGORY_VALUES.includes(value) ? value : "expression";
}

function hasAvailableQuota(model: AvailableExpressionModel) {
  const limit = numericValue(model.daily_limit);
  if (limit <= 0) return true;
  return numericValue(model.used_today) < limit;
}

function matchesModelPurpose(model: AvailableExpressionModel, purpose: "draft" | "final") {
  const usageType = model.usage_type || "both";
  return usageType === purpose || usageType === "both";
}

export function filterExpressionModelsForPurpose(
  models: AvailableExpressionModel[],
  purpose: "draft" | "final",
) {
  return (Array.isArray(models) ? models : []).filter(
    (model) =>
      model.active !== false &&
      hasAvailableQuota(model) &&
      matchesModelPurpose(model, purpose) &&
      isImageGenerationModel(model),
  );
}

function sortedByPrice(models: AvailableExpressionModel[], direction: "asc" | "desc") {
  return [...models].sort((left, right) => {
    const diff = numericValue(left.price_per_image) - numericValue(right.price_per_image);
    if (diff !== 0) return direction === "asc" ? diff : -diff;
    return right.id - left.id;
  });
}

export function recommendExpressionModels(models: AvailableExpressionModel[]) {
  const draftModels = filterExpressionModelsForPurpose(models, "draft");
  const finalModels = filterExpressionModelsForPurpose(models, "final");
  const draftModel = sortedByPrice(draftModels, "asc")[0] || null;
  const finalModel = sortedByPrice(finalModels, "desc")[0] || draftModel;

  return {
    draftModelId: draftModel ? String(draftModel.id) : "",
    finalModelId: finalModel ? String(finalModel.id) : "",
    draftRecommendedId: draftModel?.id || null,
    finalRecommendedId: finalModel?.id || null,
  };
}

export function resolveSelectedModelId(models: AvailableExpressionModel[], selectedModelId: string | number | null | undefined) {
  const safeModels = Array.isArray(models) ? models : [];
  const selected = String(selectedModelId || "");
  if (selected && safeModels.some((model) => model.id === Number(selected))) {
    return selected;
  }
  return safeModels[0] ? String(safeModels[0].id) : "";
}

export function resolveWorkflowSessionStep(
  savedStep: number | string | null | undefined,
  mode: "full" | "refine" | string | null | undefined,
  requestedStep: string | number | null | undefined,
  totalSteps: number,
) {
  const fallbackStep = mode === "refine" ? 6 : 1;
  const safeTotalSteps = Math.max(Number(totalSteps) || 1, 1);
  const parsedSavedStep = Number(savedStep || fallbackStep);
  const normalizedSavedStep = Math.min(Math.max(Number.isFinite(parsedSavedStep) ? parsedSavedStep : fallbackStep, 1), safeTotalSteps);
  const parsedRequestedStep = Number(requestedStep || "");
  if (Number.isFinite(parsedRequestedStep) && parsedRequestedStep >= 1 && parsedRequestedStep <= safeTotalSteps) {
    return parsedRequestedStep;
  }
  return normalizedSavedStep;
}

export function buildArchiveImageFilename(batchTimestamp: number, index: number, extension: string) {
  const safeTimestamp = Number.isFinite(batchTimestamp) ? batchTimestamp : Date.now();
  const safeIndex = Math.max(0, Number(index) || 0) + 1;
  const safeExtension = String(extension || "png").replace(/^\.+/, "") || "png";
  return `expression-final-${safeTimestamp}-${safeIndex}.${safeExtension}`;
}

export function normalizeGeneratedImages(
  response: GenerateResponseLike | null | undefined,
  type: "draft" | "final" | "consistency",
  fallbackBase = Date.now(),
): GeneratedImageLike[] {
  const images = Array.isArray(response?.images) ? response.images : [];
  return images.reduce<GeneratedImageLike[]>((items, image, index) => {
    const url = image.url || image.image_url;
    if (!url) return items;
    items.push({
      id: Number(image.image_id || image.id || fallbackBase + index),
      url,
      type,
    });
    return items;
  }, []);
}

export function assignWorkflowImageIds<T extends GeneratedImageLike>(images: T[], base = Date.now()) {
  return (Array.isArray(images) ? images : []).map((image, index) => ({
    ...image,
    id: base + index,
  }));
}

export function buildExpressionTaskStats({
  actionList,
  draftImages,
  finalGeneratedCount,
  finalImages,
  confirmedImages,
  toRefineImages,
  consistencyImages,
  refinedImageCount,
  archivedImageCount,
}: {
  actionList: string[];
  draftImages: GeneratedImageLike[];
  finalGeneratedCount?: number | null;
  finalImages: GeneratedImageLike[];
  confirmedImages: GeneratedImageLike[];
  toRefineImages: GeneratedImageLike[];
  consistencyImages: GeneratedImageLike[];
  refinedImageCount?: number | null;
  archivedImageCount?: number | null;
}) {
  const safeFinalImages = Array.isArray(finalImages) ? finalImages : [];
  const safeConfirmedImages = Array.isArray(confirmedImages) ? confirmedImages : [];
  const safeToRefineImages = Array.isArray(toRefineImages) ? toRefineImages : [];
  const safeConsistencyImages = Array.isArray(consistencyImages) ? consistencyImages : [];
  const finalFallbackCount =
    safeFinalImages.length +
    safeConfirmedImages.filter((image) => image.type === "final").length +
    safeToRefineImages.filter((image) => image.type === "final").length;
  const refinedFallbackCount =
    safeConsistencyImages.length +
    safeConfirmedImages.filter((image) => image.type === "consistency").length;

  return {
    actionCount: getFilledActionList(actionList).length,
    draftCount: Array.isArray(draftImages) ? draftImages.length : 0,
    finalGeneratedCount: Number(finalGeneratedCount || 0) > 0 ? Number(finalGeneratedCount) : finalFallbackCount,
    refinedImageCount: Number(refinedImageCount || 0) > 0 ? Number(refinedImageCount) : refinedFallbackCount,
    archivedImageCount: Number(archivedImageCount || 0),
  };
}

export function resetDraftGenerationState<
  T extends { draftImages: unknown[]; selectedDraftImageIds: number[] },
>(state: T): T {
  return {
    ...state,
    draftImages: [],
    selectedDraftImageIds: [],
  };
}

export function mergeUniqueNumbers(left: number[], right: number[]) {
  return Array.from(new Set([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]));
}

export function filterExistingAssetIds<T extends { id: number }>(selectedIds: number[], assets: T[]) {
  const existingIds = new Set((Array.isArray(assets) ? assets : []).map((asset) => asset.id));
  return (Array.isArray(selectedIds) ? selectedIds : []).filter((id, index, ids) => (
    existingIds.has(id) && ids.indexOf(id) === index
  ));
}

export function collectReviewImages<T extends GeneratedImageLike>(finalImages: T[], consistencyImages: T[]) {
  const seen = new Set<number>();
  return [...(Array.isArray(finalImages) ? finalImages : []), ...(Array.isArray(consistencyImages) ? consistencyImages : [])]
    .filter((image) => {
      if (seen.has(image.id)) return false;
      seen.add(image.id);
      return true;
    });
}

function appendUniqueImage<T extends GeneratedImageLike>(images: T[], image: T) {
  const safeImages = Array.isArray(images) ? images : [];
  if (safeImages.some((item) => item.id === image.id)) return safeImages;
  return [...safeImages, image];
}

export function moveGeneratedImageToReviewBucket<T extends GeneratedImageLike>(
  finalImages: T[],
  confirmedImages: T[],
  toRefineImages: T[],
  imageId: number,
  target: "confirmed" | "refine",
) {
  const safeFinalImages = Array.isArray(finalImages) ? finalImages : [];
  const selectedImage = safeFinalImages.find((image) => image.id === imageId);
  const remainingImages = safeFinalImages.filter((image) => image.id !== imageId);
  if (!selectedImage) {
    return {
      remainingImages,
      confirmedImages: Array.isArray(confirmedImages) ? confirmedImages : [],
      toRefineImages: Array.isArray(toRefineImages) ? toRefineImages : [],
    };
  }

  return {
    remainingImages,
    confirmedImages: target === "confirmed"
      ? appendUniqueImage(confirmedImages, selectedImage)
      : (Array.isArray(confirmedImages) ? confirmedImages : []),
    toRefineImages: target === "refine"
      ? appendUniqueImage(toRefineImages, selectedImage)
      : (Array.isArray(toRefineImages) ? toRefineImages : []),
  };
}

export function moveReviewImageBackToRefine<T extends GeneratedImageLike>(
  confirmedImages: T[],
  toRefineImages: T[],
  imageId: number,
) {
  const safeConfirmedImages = Array.isArray(confirmedImages) ? confirmedImages : [];
  const selectedImage = safeConfirmedImages.find((image) => image.id === imageId);
  const remainingConfirmedImages = safeConfirmedImages.filter((image) => image.id !== imageId);

  return {
    confirmedImages: remainingConfirmedImages,
    toRefineImages: selectedImage
      ? appendUniqueImage(toRefineImages, selectedImage)
      : (Array.isArray(toRefineImages) ? toRefineImages : []),
  };
}

export function directPassRefineSourceImage<
  TImage extends GeneratedImageLike,
  TConsistencyImage extends GeneratedImageLike & { sourceImageId?: number },
>(
  confirmedImages: TImage[],
  toRefineImages: TImage[],
  consistencyImages: TConsistencyImage[],
  imageId: number,
) {
  const safeConfirmedImages = Array.isArray(confirmedImages) ? confirmedImages : [];
  const safeToRefineImages = Array.isArray(toRefineImages) ? toRefineImages : [];
  const selectedImage = safeToRefineImages.find((image) => image.id === imageId);

  return {
    confirmedImages: selectedImage
      ? appendUniqueImage(safeConfirmedImages, selectedImage)
      : safeConfirmedImages,
    toRefineImages: safeToRefineImages.filter((image) => image.id !== imageId),
    consistencyImages: (Array.isArray(consistencyImages) ? consistencyImages : []).filter((image) =>
      image.sourceImageId !== imageId && image.id !== imageId,
    ),
  };
}

export function skipRefineSourceImage<
  TImage extends GeneratedImageLike,
  TConsistencyImage extends GeneratedImageLike & { sourceImageId?: number },
>(
  confirmedImages: TImage[],
  toRefineImages: TImage[],
  consistencyImages: TConsistencyImage[],
  imageId: number,
) {
  const safeConfirmedImages = Array.isArray(confirmedImages) ? confirmedImages : [];
  const safeToRefineImages = Array.isArray(toRefineImages) ? toRefineImages : [];

  return {
    confirmedImages: safeConfirmedImages,
    toRefineImages: safeToRefineImages.filter((image) => image.id !== imageId),
    consistencyImages: (Array.isArray(consistencyImages) ? consistencyImages : []).filter((image) =>
      image.sourceImageId !== imageId && image.id !== imageId,
    ),
  };
}

export function getImageChoiceGridClasses(variant: ImageChoiceGridVariant = "compact") {
  if (variant === "step6Draft") {
    return {
      container: "grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]",
      image: "aspect-square min-h-[200px] w-full bg-gray-100 object-cover",
    };
  }
  if (variant === "step6Final") {
    return {
      container: "grid gap-5 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]",
      image: "aspect-square min-h-[240px] w-full bg-gray-100 object-cover",
    };
  }
  return {
    container: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
    image: "aspect-square w-full bg-gray-100 object-cover",
  };
}

export function buildExpressionDraftPrompt(instructionContents: string[], extraPrompt: string) {
  return [
    ...(Array.isArray(instructionContents) ? instructionContents : []),
    extraPrompt,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

export function getFilledActionList(actionList: string[]) {
  return (Array.isArray(actionList) ? actionList : [])
    .map((action) => String(action || "").trim())
    .filter(Boolean);
}

export function buildActionDraftPrompt(
  instructionContents: string[],
  extraPrompt: string,
  action: string,
) {
  const trimmedAction = String(action || "").trim();
  const safeInstructions = Array.isArray(instructionContents) ? instructionContents : [];
  const hasActionVariable = safeInstructions.some((content) => String(content || "").includes("{{action}}"));
  const resolvedInstructions = safeInstructions.map((content) =>
    String(content || "").replaceAll("{{action}}", trimmedAction),
  );
  const basePrompt = buildExpressionDraftPrompt(resolvedInstructions, extraPrompt);
  const actionPrompt = hasActionVariable
    ? basePrompt
    : [basePrompt, trimmedAction ? `动作：${trimmedAction}` : ""].filter(Boolean).join("\n\n");
  return buildSingleImageDraftPrompt(actionPrompt);
}

export function buildCombinedActionDraftPrompt(
  instructionContents: string[],
  extraPrompt: string,
  actionList: string[],
) {
  const actions = getFilledActionList(actionList);
  const resolvedInstructions = (Array.isArray(instructionContents) ? instructionContents : []).map((content) =>
    String(content || "").replaceAll("{{action}}", "见下方动作列表"),
  );
  const basePrompt = buildExpressionDraftPrompt(resolvedInstructions, extraPrompt);
  const actionPrompt = [
    `请生成 ${actions.length} 张图，每张一只牛，动作各不相同，按以下描述分别生成：`,
    ...actions.map((action, index) => `第${index + 1}张动作：${action}`),
  ].join("\n");

  return [
    removeArrangementPromptSentences(basePrompt),
    actionPrompt,
    "只生成单张图片规格，不要拼图，每张图只有一个角色。",
  ].filter(Boolean).join("\n\n");
}

export function buildNumberedCollageDraftPrompt(
  instructionContents: string[],
  extraPrompt: string,
  actionList: string[],
) {
  const actions = getFilledActionList(actionList);
  const resolvedInstructions = (Array.isArray(instructionContents) ? instructionContents : []).map((content) =>
    String(content || "").replaceAll("{{action}}", "见下方编号动作表"),
  );
  const basePrompt = removeArrangementPromptSentences(
    buildExpressionDraftPrompt(resolvedInstructions, extraPrompt),
  );
  const actionLines = actions.map((action, index) => `第${index + 1}格：${action}`);
  const generationPlan = [
    `请生成一张包含 ${actions.length} 格的拼图草稿，每格一只牛，动作各不相同，按以下描述分别生成：`,
    ...actionLines,
  ].join("\n");
  const numberingRequirement = [
    "请在每格图的左上角或底部标注数字编号（1、2、3...），编号对应以下动作序号：",
    ...actionLines,
    "每格只有一只牛，编号清晰可见。",
  ].join("\n");

  return [basePrompt, generationPlan, numberingRequirement].filter(Boolean).join("\n\n");
}

export function getNumberedCollageDraftRequestCount(actionList: string[]) {
  return getFilledActionList(actionList).length;
}

export function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      (Array.isArray(tags) ? tags : [])
        .map((tag) => String(tag || "").trim())
        .filter(Boolean),
    ),
  );
}

export function addTaskTag(currentTags: string[], tag: string) {
  return normalizeTags([...(Array.isArray(currentTags) ? currentTags : []), tag]);
}

export function buildDefaultArchiveTags(taskTags: string[]) {
  return normalizeTags(taskTags);
}

export function buildDefaultArchiveImageTags(imageIds: number[], taskTags: string[]) {
  const defaultTags = buildDefaultArchiveTags(taskTags);
  return (Array.isArray(imageIds) ? imageIds : []).reduce<Record<string, string[]>>((items, imageId) => {
    items[imageId] = defaultTags;
    return items;
  }, {});
}

export function mergeDefaultArchiveImageTags(
  imageIds: number[],
  taskTags: string[],
  currentArchiveImageTags: Record<string, string[]> | null | undefined,
) {
  const defaults = buildDefaultArchiveImageTags(imageIds, taskTags);
  const current = currentArchiveImageTags && typeof currentArchiveImageTags === "object"
    ? currentArchiveImageTags
    : {};
  return {
    ...defaults,
    ...Object.entries(current).reduce<Record<string, string[]>>((items, [imageId, tags]) => {
      if (Array.isArray(tags)) items[imageId] = normalizeTags(tags);
      return items;
    }, {}),
  };
}

export function getImageArchiveTags(
  imageId: number,
  archiveImageTags: Record<string, string[]> | null | undefined,
  defaultTags: string[],
) {
  const imageTags = archiveImageTags?.[String(imageId)];
  if (Array.isArray(imageTags)) return normalizeTags(imageTags);
  return buildDefaultArchiveTags(defaultTags);
}

export function buildFinalActionPrompt(basePrompt: string, action: string) {
  const trimmedAction = String(action || "").trim();
  const rawBasePrompt = String(basePrompt || "");
  const hasActionVariable = rawBasePrompt.includes("{{action}}");
  const resolvedBasePrompt = rawBasePrompt.replaceAll("{{action}}", trimmedAction).trim();
  return [
    resolvedBasePrompt,
    FINAL_COW_CHARACTER_LOCK,
    hasActionVariable ? "" : `动作：${trimmedAction}`,
    "只生成单张图片，一只牛，不要拼图。",
  ].filter(Boolean).join("\n");
}

export function buildConsistencyGenerationPayload({
  taskId,
  modelConfigId,
  modelProvider,
  modelName,
  prompt,
  size,
  referenceAssetIds,
  sourceAssetId,
}: {
  taskId: number;
  modelConfigId: number;
  modelProvider: string;
  modelName: string;
  prompt: string;
  size: string;
  referenceAssetIds: number[];
  sourceAssetId?: number | null;
  sourceImageId?: number | null;
}) {
  return {
    task_id: taskId,
    model_config_id: modelConfigId,
    mode: "final",
    model_provider: modelProvider,
    model_name: modelName,
    prompt,
    size,
    count: 1,
    reference_asset_ids: mergeUniqueNumbers(
      sourceAssetId ? [sourceAssetId] : [],
      referenceAssetIds,
    ),
  };
}

export function buildSeriesActionDraftPrompt(
  instructionContents: string[],
  extraPrompt: string,
  actionList: string[],
  actionIndex: number,
) {
  const actions = getFilledActionList(actionList);
  const currentAction = actions[actionIndex] || "";
  const currentNumber = actionIndex + 1;
  const resolvedInstructions = (Array.isArray(instructionContents) ? instructionContents : []).map((content) =>
    String(content || "").replaceAll("{{action}}", currentAction),
  );
  const basePrompt = removeArrangementPromptSentences(
    buildExpressionDraftPrompt(resolvedInstructions, extraPrompt),
  );
  const seriesPlan = actions.map((action, index) => `第${index + 1}张：${action}`).join("\n");
  const seriesPrompt = [
    `你正在生成一个系列的第${currentNumber}张，共${actions.length}张，每张动作各不相同。`,
    "整个系列的动作规划：",
    seriesPlan,
    "",
    `现在请生成第${currentNumber}张，动作为：${currentAction}`,
    "只生成一只牛，单张图片，不要拼图，不要多角色。",
    SINGLE_IMAGE_DRAFT_CONSTRAINT,
  ].join("\n");

  return [basePrompt, seriesPrompt].filter(Boolean).join("\n\n");
}

function splitPromptIntoSentences(prompt: string) {
  const sentences: string[] = [];
  for (const line of prompt.split(/\n+/)) {
    const lineSentences = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [line];
    for (const sentence of lineSentences) {
      const trimmed = sentence.trim();
      if (trimmed) sentences.push(trimmed);
    }
  }
  return sentences;
}

export function removeArrangementPromptSentences(prompt: string) {
  return splitPromptIntoSentences(prompt)
    .filter((sentence) => !sentence.includes("排列") && !sentence.includes("一排"))
    .join("\n");
}

export function buildSingleImageDraftPrompt(prompt: string) {
  const cleanedPrompt = removeArrangementPromptSentences(prompt);
  return [cleanedPrompt, SINGLE_IMAGE_DRAFT_CONSTRAINT].filter(Boolean).join("\n\n");
}

function appendQuery(path: string, params: Record<string, string | null | undefined>) {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return query ? `${path}?${query}` : path;
}

export function buildAssetTagQueryPath(category: string) {
  return appendQuery("/api/assets/tags", {
    category: category === "all" ? undefined : category,
  });
}

export function buildAssetQueryPath(category: string, tags: string[]) {
  return appendQuery("/api/assets", {
    category: category === "all" ? undefined : category,
    tags: Array.isArray(tags) && tags.length > 0 ? tags.join(",") : undefined,
  });
}

export function splitTags(tags?: string | null) {
  if (!tags) return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
