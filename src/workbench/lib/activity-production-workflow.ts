export type ActivityFieldType = "text" | "textarea" | "number" | "select" | "switch";

export interface ActivityFieldDefinition {
  field_key: string;
  field_name: string;
  field_type: ActivityFieldType;
  is_required: boolean;
  default_value?: string | null;
  hint?: string | null;
  options_json?: string[] | null;
  sort_order: number;
}

export interface ActivityTemplateForPreview {
  template_no: string;
  name: string;
  usage_scenario?: string | null;
  structure_layer1: string;
  structure_layer2: string;
  structure_layer3: string;
  bg_description?: string | null;
  forbidden_rules?: string | null;
  rule_character?: string | null;
  style_guide?: string | null;
  rule_scene?: string | null;
  rule_visual?: string | null;
  rule_copy?: string | null;
  rule_button?: string | null;
  rule_quality?: string | null;
  rule_forbidden?: string | null;
  fields?: ActivityFieldDefinition[];
}

export type ActivityFieldValue = string;
export type ActivityFieldValues = Record<string, ActivityFieldValue>;
export type ActivityAdSize = "1024x1024" | "1088x1920" | "1080x1080" | "1080x1920";

export interface ActivityReferenceImages {
  character: number | null;
  background: number | null;
  props: number | null;
}

export interface ActivityBatchImageView {
  id: number;
  batchId: number;
  imageUrl: string;
  extraPrompt: string;
  refinePrompt: string;
  parentImageId: number | null;
  promptRendered: string;
  status: string;
  costUsd: number;
  tokenUsed: number;
  sortOrder: number;
}

export interface ActivityQcState {
  reward_visible: boolean;
  action_clear: boolean;
  character_consistent: boolean;
}

export interface RejectRegenerationState {
  currentJobId: number | null;
  generatedImageUrl: string;
  promptRendered: string;
  qc: ActivityQcState;
}

type ActivityReferenceTagLike =
  | string
  | {
      name?: string | null;
    }
  | null
  | undefined;

type ActivityBatchImageLike = {
  id?: number | string | null;
  batch_id?: number | string | null;
  batchId?: number | string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  extra_prompt?: string | null;
  extraPrompt?: string | null;
  refine_prompt?: string | null;
  refinePrompt?: string | null;
  parent_image_id?: number | string | null;
  parentImageId?: number | string | null;
  prompt_rendered?: string | null;
  promptRendered?: string | null;
  status?: string | null;
  cost_usd?: number | string | null;
  costUsd?: number | string | null;
  token_used?: number | string | null;
  tokenUsed?: number | string | null;
  sort_order?: number | string | null;
  sortOrder?: number | string | null;
};

function sortedFields(fields: ActivityFieldDefinition[] = []) {
  return [...fields].sort((a, b) => a.sort_order - b.sort_order || a.field_key.localeCompare(b.field_key));
}

export function initialActivityFieldValues(fields: ActivityFieldDefinition[] = []): ActivityFieldValues {
  return sortedFields(fields).reduce<ActivityFieldValues>((values, field) => {
    values[field.field_key] = field.default_value || "";
    return values;
  }, {});
}

export function validateActivityFieldValues(
  fields: ActivityFieldDefinition[] = [],
  values: ActivityFieldValues,
): string | null {
  for (const field of sortedFields(fields)) {
    if (field.is_required && !values[field.field_key]?.trim()) {
      return `请填写"${field.field_name}"`;
    }
  }
  return null;
}

export function buildActivityVariablesJson(
  fields: ActivityFieldDefinition[] = [],
  values: ActivityFieldValues,
): Record<string, string> {
  return sortedFields(fields).reduce<Record<string, ActivityFieldValue>>((payload, field) => {
    const value = values[field.field_key];
    payload[field.field_key] = String(value ?? "").trim();
    return payload;
  }, {});
}

export function buildActivityPromptPreview(
  template: ActivityTemplateForPreview,
  values: ActivityFieldValues,
  outputSize = "1024x1024",
): string {
  const parts: string[] = [];
  if (template.rule_character) parts.push(`[CHARACTER]\n${template.rule_character}`);
  if (template.style_guide) parts.push(`[STYLE GUIDE]\n${template.style_guide}`);
  if (template.rule_scene) parts.push(`[SCENE]\n${template.rule_scene}`);

  const structure = [
    template.structure_layer1 ? `主视觉区：${template.structure_layer1}` : "",
    template.structure_layer2 ? `文案区：${template.structure_layer2}` : "",
    template.structure_layer3 ? `行动区：${template.structure_layer3}` : "",
    template.bg_description ? `背景区：${template.bg_description}` : "",
  ].filter(Boolean);
  if (structure.length > 0) parts.push(`[STRUCTURE]\n${structure.join("\n")}`);

  if (template.rule_visual) parts.push(`[VISUAL]\n${template.rule_visual}`);

  const content = sortedFields(template.fields).map((field) => {
    const value = values[field.field_key];
    return `${field.field_name}: ${value || ""}`;
  });
  if (content.length > 0) parts.push(`[CONTENT]\n${content.join("\n")}`);

  if (template.rule_copy) parts.push(`[COPY RULES]\n${template.rule_copy}`);
  if (template.rule_button) parts.push(`[BUTTON]\n${template.rule_button}`);
  if (template.rule_quality) parts.push(`[QUALITY]\n${template.rule_quality}`);

  const forbidden = [template.rule_forbidden, template.forbidden_rules].filter(Boolean);
  if (forbidden.length > 0) parts.push(`[FORBIDDEN]\n${forbidden.join("\n")}`);

  parts.push(`[OUTPUT]\n${outputSize.replace("x", " x ")}\nSingle image`);
  return parts.join("\n\n");
}

export function collectActivityReferenceAssetIds(referenceImages: ActivityReferenceImages): number[] {
  return [referenceImages.character, referenceImages.background, referenceImages.props].filter(
    (id): id is number => id !== null,
  );
}

export function toggleActivityReferenceAssetSelection(selectedIds: number[], assetId: number, maxCount = 4) {
  if (selectedIds.includes(assetId)) {
    return selectedIds.filter((id) => id !== assetId);
  }
  if (selectedIds.length >= maxCount) {
    return selectedIds;
  }
  return [...selectedIds, assetId];
}

export function buildActivityReferenceAssetQueryPath(category: string, activeTag: string | null) {
  const params = [`category=${encodeURIComponent(String(category || "").trim())}`, "limit=30"];
  const cleanTag = String(activeTag || "").trim();
  if (cleanTag) {
    params.push(`tags=${encodeURIComponent(cleanTag)}`);
  }
  return `/api/assets?${params.join("&")}`;
}

export function normalizeActivityReferenceTagNames(tags: ActivityReferenceTagLike[]) {
  return (Array.isArray(tags) ? tags : []).reduce<string[]>((items, tag) => {
    const name = typeof tag === "string" ? tag.trim() : String(tag?.name || "").trim();
    if (!name) {
      return items;
    }
    items.push(name);
    return items;
  }, []);
}

function numericOrZero(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeActivityBatchImages(images: unknown[]): ActivityBatchImageView[] {
  return (Array.isArray(images) ? images : []).map((rawImage) => {
    const image = (rawImage || {}) as ActivityBatchImageLike;
    return {
    id: numericOrZero(image.id),
    batchId: numericOrZero(image.batchId ?? image.batch_id),
    imageUrl: image.imageUrl || image.image_url || "",
    extraPrompt: image.extraPrompt || image.extra_prompt || "",
    refinePrompt: image.refinePrompt || image.refine_prompt || "",
    parentImageId: nullableNumber(image.parentImageId ?? image.parent_image_id),
    promptRendered: image.promptRendered || image.prompt_rendered || "",
    status: image.status || "pending",
    costUsd: numericOrZero(image.costUsd ?? image.cost_usd),
    tokenUsed: numericOrZero(image.tokenUsed ?? image.token_used),
    sortOrder: numericOrZero(image.sortOrder ?? image.sort_order),
    };
  });
}

export function resetRejectedActivityGeneration<T extends RejectRegenerationState>(state: T) {
  return {
    step: 3,
    state: {
      ...state,
      currentJobId: null,
      generatedImageUrl: "",
      promptRendered: "",
      qc: {
        reward_visible: false,
        action_clear: false,
        character_consistent: false,
      },
    },
  };
}
