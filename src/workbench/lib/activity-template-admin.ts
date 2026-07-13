export const STRUCTURED_PROMPT_PLACEHOLDER = "structured_prompt_managed_by_rules";

export const DEFAULT_CHARACTER_RULE = "固定使用同一只3D牛角色，保持角色外观、比例、材质和表情风格一致。";

export const LIGHT_THEME_CLASSES = [
  "bg-white",
  "bg-gray-50",
  "border-gray-200",
  "text-gray-900",
  "text-gray-700",
  "text-gray-600",
  "text-gray-500",
  "bg-emerald-50",
  "text-emerald-700",
  "border-emerald-200",
].join(" ");

const PRESET_KEYS = ["title", "subtitle", "reward_amount", "bonus_type", "cta_text"];

export type ActivityFieldType = "text" | "textarea" | "number" | "select" | "switch";

export interface ActivityFieldFormState {
  field_key?: string;
  field_name: string;
  field_type: ActivityFieldType;
  is_required: boolean;
  default_value: string;
  hint: string;
  options_text: string;
}

export interface ActivityTemplateFormState {
  template_no: string;
  name: string;
  type_id: string;
  usage_scenario: string;
  is_active: boolean;
  structure_layer1: string;
  structure_layer2: string;
  structure_layer3: string;
  bg_description: string;
  forbidden_rules: string;
  style_guide: string;
  style_tag: string;
  rule_character: string;
  rule_scene: string;
  rule_visual: string;
  rule_copy: string;
  rule_button: string;
  rule_quality: string;
  rule_forbidden: string;
  fields: ActivityFieldFormState[];
}

function generatedFieldKey(field: ActivityFieldFormState, index: number) {
  if (field.field_key && PRESET_KEYS.includes(field.field_key)) {
    return field.field_key;
  }
  const presetKey = PRESET_KEYS[index];
  if (presetKey && !field.field_key?.startsWith("field_")) {
    return presetKey;
  }
  return `field_${index + 1}`;
}

function splitOptions(optionsText: string) {
  return optionsText
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildActivityTemplatePayload(form: ActivityTemplateFormState) {
  return {
    template_no: form.template_no.trim(),
    name: form.name.trim(),
    type_id: Number(form.type_id),
    usage_scenario: form.usage_scenario.trim() || null,
    is_active: form.is_active,
    structure_layer1: form.structure_layer1.trim(),
    structure_layer2: form.structure_layer2.trim(),
    structure_layer3: form.structure_layer3.trim(),
    bg_description: form.bg_description.trim() || null,
    forbidden_rules: form.forbidden_rules.trim() || null,
    style_guide: form.style_guide.trim() || null,
    style_tag: form.style_tag.trim() || null,
    prompt_template: STRUCTURED_PROMPT_PLACEHOLDER,
    rule_character: form.rule_character.trim() || null,
    rule_scene: form.rule_scene.trim() || null,
    rule_visual: form.rule_visual.trim() || null,
    rule_copy: form.rule_copy.trim() || null,
    rule_button: form.rule_button.trim() || null,
    rule_quality: form.rule_quality.trim() || null,
    rule_forbidden: form.rule_forbidden.trim() || null,
    fields: form.fields.map((field, index) => ({
      field_key: generatedFieldKey(field, index),
      field_name: field.field_name.trim(),
      field_type: field.field_type,
      is_required: field.is_required,
      default_value: field.default_value.trim() || null,
      hint: field.hint.trim() || null,
      options_json: field.field_type === "select" ? splitOptions(field.options_text) : null,
      sort_order: index + 1,
    })),
  };
}

export function validateActivityTemplateForm(form: ActivityTemplateFormState): string {
  if (!form.template_no.trim()) return "请填写模板编号";
  if (!form.name.trim()) return "请填写模板名称";
  if (!form.type_id) return "请选择模板类型";
  if (!form.structure_layer1.trim()) return "请填写主视觉区描述";
  if (!form.structure_layer2.trim()) return "请填写文案区描述";
  if (!form.structure_layer3.trim()) return "请填写行动区描述";
  if (form.fields.length === 0) return "请至少保留一个活动填写项";

  for (const field of form.fields) {
    if (!field.field_name.trim()) return "请填写所有填写项名称";
    if (field.field_type === "select" && splitOptions(field.options_text).length === 0) {
      return `请为「${field.field_name || "下拉选择"}」填写选项内容`;
    }
  }

  return "";
}
