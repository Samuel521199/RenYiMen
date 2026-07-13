// @ts-nocheck
"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import ConfirmDialog from "@workbench/components/common/ConfirmDialog";
import PageHeader from "@workbench/components/common/PageHeader";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@workbench/lib/api";
import { useLanguage } from "@workbench/lib/LanguageContext";
import {
  DEFAULT_CHARACTER_RULE,
  buildActivityTemplatePayload,
  validateActivityTemplateForm,
  type ActivityFieldFormState,
  type ActivityFieldType,
  type ActivityTemplateFormState,
} from "@workbench/lib/activity-template-admin";

interface ActivityTemplateType {
  id: number;
  name: string;
  code: string;
  sort_order: number;
  template_count?: number;
}

interface ActivityFieldDefinition {
  id?: number;
  template_id?: number | null;
  field_key: string;
  field_name: string;
  field_type: ActivityFieldType;
  is_required: boolean;
  default_value?: string | null;
  hint?: string | null;
  options_json?: string[] | null;
  sort_order: number;
}

interface ActivityTemplate {
  id: number;
  template_no: string;
  name: string;
  name_en?: string | null;
  type_id: number;
  type_name?: string | null;
  structure_layer1: string;
  structure_layer2: string;
  structure_layer3: string;
  prompt_template: string;
  usage_scenario?: string | null;
  scenario_en?: string | null;
  bg_description?: string | null;
  forbidden_rules?: string | null;
  style_guide?: string | null;
  style_tag?: string | null;
  rule_character?: string | null;
  rule_scene?: string | null;
  rule_visual?: string | null;
  rule_copy?: string | null;
  rule_button?: string | null;
  rule_quality?: string | null;
  rule_forbidden?: string | null;
  fields?: ActivityFieldDefinition[];
  is_active: boolean;
  created_by?: number | null;
  created_at: string;
  updated_at: string;
}

interface ActivityGenerationJob {
  id: number;
  template_id?: number | null;
}

interface DeleteState {
  template: ActivityTemplate;
  hasJobs: boolean;
}

type EditorMode = "create" | "edit";
type ActivityTemplateEditorFormState = ActivityTemplateFormState & {
  name_en: string;
  scenario_en: string;
};

const fieldTypeOptions: Array<{ value: ActivityFieldType; label: string }> = [
  { value: "text", label: "单行文本" },
  { value: "textarea", label: "多行文本" },
  { value: "number", label: "数字" },
  { value: "select", label: "下拉选择" },
  { value: "switch", label: "开关" },
];

const inputClass =
  "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
const textareaClass =
  "mt-1 min-h-24 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500";
const secondaryButtonClass =
  "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60";
const primaryButtonClass =
  "rounded-md border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-emerald-300 disabled:bg-emerald-300";

function defaultActivityFields(): ActivityFieldFormState[] {
  return [
    {
      field_key: "title",
      field_name: "主标题",
      field_type: "text",
      is_required: true,
      default_value: "Come Back & Get Rewards",
      hint: "最多6个英文词",
      options_text: "",
    },
    {
      field_key: "subtitle",
      field_name: "副标题",
      field_type: "text",
      is_required: true,
      default_value: "Your bonus is waiting",
      hint: "最多10个英文词",
      options_text: "",
    },
    {
      field_key: "reward_amount",
      field_name: "奖励数量",
      field_type: "text",
      is_required: true,
      default_value: "20,000",
      hint: "",
      options_text: "",
    },
    {
      field_key: "bonus_type",
      field_name: "奖励类型",
      field_type: "select",
      is_required: true,
      default_value: "Coins",
      hint: "",
      options_text: "Coins, Bonus, Gift, Voucher, Free Reward",
    },
    {
      field_key: "cta_text",
      field_name: "按钮文字",
      field_type: "select",
      is_required: true,
      default_value: "Claim Now",
      hint: "",
      options_text: "Claim Now, Play Now, Join Now, Get Bonus",
    },
  ];
}

function emptyForm(typeId = ""): ActivityTemplateEditorFormState {
  return {
    template_no: "",
    name: "",
    name_en: "",
    type_id: typeId,
    usage_scenario: "",
    scenario_en: "",
    is_active: true,
    structure_layer1: "",
    structure_layer2: "",
    structure_layer3: "",
    bg_description: "",
    forbidden_rules: "",
    style_guide: "",
    style_tag: "",
    rule_character: DEFAULT_CHARACTER_RULE,
    rule_scene: "",
    rule_visual: "",
    rule_copy: "",
    rule_button: "",
    rule_quality: "",
    rule_forbidden: "",
    fields: defaultActivityFields(),
  };
}

function fieldDefinitionToFormField(field: ActivityFieldDefinition): ActivityFieldFormState {
  return {
    field_key: field.field_key,
    field_name: field.field_name,
    field_type: field.field_type,
    is_required: field.is_required,
    default_value: field.default_value || "",
    hint: field.hint || "",
    options_text: Array.isArray(field.options_json) ? field.options_json.join(", ") : "",
  };
}

function templateToForm(template: ActivityTemplate): ActivityTemplateEditorFormState {
  const sortedFields = [...(template.fields || [])].sort(
    (a, b) => a.sort_order - b.sort_order || String(a.field_key).localeCompare(String(b.field_key)),
  );

  return {
    template_no: template.template_no,
    name: template.name,
    name_en: template.name_en || "",
    type_id: String(template.type_id),
    usage_scenario: template.usage_scenario || "",
    scenario_en: template.scenario_en || "",
    is_active: template.is_active,
    structure_layer1: template.structure_layer1,
    structure_layer2: template.structure_layer2,
    structure_layer3: template.structure_layer3,
    bg_description: template.bg_description || "",
    forbidden_rules: template.forbidden_rules || "",
    style_guide: template.style_guide || "",
    style_tag: template.style_tag || "",
    rule_character: template.rule_character || DEFAULT_CHARACTER_RULE,
    rule_scene: template.rule_scene || "",
    rule_visual: template.rule_visual || "",
    rule_copy: template.rule_copy || "",
    rule_button: template.rule_button || "",
    rule_quality: template.rule_quality || "",
    rule_forbidden: template.rule_forbidden || "",
    fields: sortedFields.length > 0 ? sortedFields.map(fieldDefinitionToFormField) : defaultActivityFields(),
  };
}

function newField(index: number): ActivityFieldFormState {
  return {
    field_key: `field_${index + 1}`,
    field_name: "",
    field_type: "text",
    is_required: true,
    default_value: "",
    hint: "",
    options_text: "",
  };
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function truncatedScenario(value?: string | null) {
  const text = value?.trim();
  if (!text) return "-";
  return text;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}

function FormSection({ title, children, defaultOpen = false, action }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-gray-900">
        <span>{title}</span>
        {action}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

interface TemplateEditorProps {
  mode: EditorMode;
  form: ActivityTemplateEditorFormState;
  types: ActivityTemplateType[];
  saving: boolean;
  resettingFields: boolean;
  editingTemplate?: ActivityTemplate | null;
  onChange: (form: ActivityTemplateEditorFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  onResetDefaults: () => void;
}

function TemplateEditor({
  mode,
  form,
  types,
  saving,
  resettingFields,
  editingTemplate,
  onChange,
  onSave,
  onCancel,
  onResetDefaults,
}: TemplateEditorProps) {
  const { t } = useLanguage();

  function update<K extends keyof ActivityTemplateEditorFormState>(
    key: K,
    value: ActivityTemplateEditorFormState[K],
  ) {
    onChange({ ...form, [key]: value });
  }

  function updateField<K extends keyof ActivityFieldFormState>(
    index: number,
    key: K,
    value: ActivityFieldFormState[K],
  ) {
    const fields = form.fields.map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, [key]: value } : field,
    );
    onChange({ ...form, fields });
  }

  function removeField(index: number) {
    onChange({ ...form, fields: form.fields.filter((_, fieldIndex) => fieldIndex !== index) });
  }

  function addField() {
    onChange({ ...form, fields: [...form.fields, newField(form.fields.length)] });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            {mode === "create"
              ? t("新建模板")
              : `${t("编辑模板")} · ${editingTemplate?.template_no || ""}`}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {t("配置运营填写项和出图规则，系统会自动生成出图指令。")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <FormSection title={t("Section 1 — 基础信息")} defaultOpen>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("模板编号")}</span>
              <input
                value={form.template_no}
                onChange={(event) => update("template_no", event.target.value)}
                className={inputClass}
                placeholder="T01"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("模板名称")}</span>
              <input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("模板英文名称")}</span>
              <input
                value={form.name_en}
                onChange={(event) => update("name_en", event.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("模板类型")}</span>
              <select
                value={form.type_id}
                onChange={(event) => update("type_id", event.target.value)}
                className={inputClass}
                required
              >
                <option value="">{t("请选择类型")}</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {t(type.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => update("is_active", event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-emerald-600"
              />
              {t("是否启用")}
            </label>
            <label className="block md:col-span-2 xl:col-span-4">
              <span className="text-sm font-medium text-gray-700">{t("推荐使用场景")}</span>
              <textarea
                value={form.usage_scenario}
                onChange={(event) => update("usage_scenario", event.target.value)}
                className={textareaClass}
                placeholder="例如：7天未登录用户召回"
              />
            </label>
            <label className="block md:col-span-2 xl:col-span-4">
              <span className="text-sm font-medium text-gray-700">{t("推荐使用场景（英文）")}</span>
              <textarea
                value={form.scenario_en}
                onChange={(event) => update("scenario_en", event.target.value)}
                className={textareaClass}
                placeholder="For example: 7-day inactive user reactivation"
              />
            </label>
            <div className="flex flex-col gap-1 md:col-span-2 xl:col-span-4">
              <label className="text-sm font-medium text-gray-700">{t("风格标准")}</label>
              <textarea
                rows={3}
                className={inputClass}
                placeholder="描述出图风格要求，如：3D卡通风格，饱和度高，边缘干净，无噪点"
                value={form.style_guide ?? ""}
                onChange={(event) => update("style_guide", event.target.value)}
              />
              <p className="text-xs text-gray-400">{t("用于锁定出图风格，自动加入出图指令")}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">{t("风格标签")}</label>
              <input
                type="text"
                className={inputClass}
                placeholder="简短标签名，如：3D卡通"
                value={form.style_tag ?? ""}
                onChange={(event) => update("style_tag", event.target.value)}
                maxLength={50}
              />
              <p className="text-xs text-gray-400">
                {t("归档成品图时自动打上此标签，建议简短明确")}
              </p>
            </div>
          </div>
        </FormSection>

        <FormSection title={t("Section 2 — 画面结构配置")}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("主视觉区描述")}</span>
              <textarea
                value={form.structure_layer1}
                onChange={(event) => update("structure_layer1", event.target.value)}
                className={textareaClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("文案区描述")}</span>
              <textarea
                value={form.structure_layer2}
                onChange={(event) => update("structure_layer2", event.target.value)}
                className={textareaClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("行动区描述")}</span>
              <textarea
                value={form.structure_layer3}
                onChange={(event) => update("structure_layer3", event.target.value)}
                className={textareaClass}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("背景区描述")}</span>
              <textarea
                value={form.bg_description}
                onChange={(event) => update("bg_description", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("画面禁止事项")}</span>
              <textarea
                value={form.forbidden_rules}
                onChange={(event) => update("forbidden_rules", event.target.value)}
                className={textareaClass}
              />
            </label>
          </div>
        </FormSection>

        <FormSection
          title={t("Section 3 — 活动填写项配置")}
          action={
            mode === "edit" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  onResetDefaults();
                }}
                disabled={resettingFields}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resettingFields ? t("重置中...") : t("重置为默认填写项")}
              </button>
            ) : null
          }
        >
          <div className="space-y-3">
            {form.fields.map((field, index) => (
              <div key={`${field.field_key || "field"}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <label className="block xl:col-span-1">
                    <span className="text-xs font-medium text-gray-600">{t("填写项名称")}</span>
                    <input
                      value={field.field_name}
                      onChange={(event) => updateField(index, "field_name", event.target.value)}
                      className={inputClass}
                      placeholder="如：主标题"
                    />
                  </label>
                  <label className="block xl:col-span-1">
                    <span className="text-xs font-medium text-gray-600">{t("填写方式")}</span>
                    <select
                      value={field.field_type}
                      onChange={(event) => updateField(index, "field_type", event.target.value as ActivityFieldType)}
                      className={inputClass}
                    >
                      {fieldTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {t(option.label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-end gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={field.is_required}
                      onChange={(event) => updateField(index, "is_required", event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-emerald-600"
                    />
                    {t("是否必填")}
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">{t("默认内容")}</span>
                    <input
                      value={field.default_value}
                      onChange={(event) => updateField(index, "default_value", event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="block xl:col-span-2">
                    <span className="text-xs font-medium text-gray-600">{t("提示说明")}</span>
                    <input
                      value={field.hint}
                      onChange={(event) => updateField(index, "hint", event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  {field.field_type === "select" && (
                    <label className="block md:col-span-2 xl:col-span-5">
                      <span className="text-xs font-medium text-gray-600">{t("选项内容")}</span>
                      <input
                        value={field.options_text}
                        onChange={(event) => updateField(index, "options_text", event.target.value)}
                        className={inputClass}
                        placeholder="Coins, Bonus, Gift"
                      />
                    </label>
                  )}
                  <div className="flex items-end justify-end">
                    <button
                      type="button"
                      onClick={() => removeField(index)}
                      className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                    >
                      {t("删除")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" onClick={addField} className={secondaryButtonClass}>
              {t("+ 添加填写项")}
            </button>
          </div>
        </FormSection>

        <FormSection title={t("Section 4 — 出图规则")}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("角色要求")}</span>
              <textarea
                value={form.rule_character}
                onChange={(event) => update("rule_character", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("场景要求")}</span>
              <textarea
                value={form.rule_scene}
                onChange={(event) => update("rule_scene", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("主视觉要求")}</span>
              <textarea
                value={form.rule_visual}
                onChange={(event) => update("rule_visual", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("文案要求")}</span>
              <textarea
                value={form.rule_copy}
                onChange={(event) => update("rule_copy", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("按钮要求")}</span>
              <textarea
                value={form.rule_button}
                onChange={(event) => update("rule_button", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">{t("画质要求")}</span>
              <textarea
                value={form.rule_quality}
                onChange={(event) => update("rule_quality", event.target.value)}
                className={textareaClass}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-gray-700">{t("禁止事项")}</span>
              <textarea
                value={form.rule_forbidden}
                onChange={(event) => update("rule_forbidden", event.target.value)}
                className={textareaClass}
              />
            </label>
          </div>
          {/* Section 4 底部操作栏 */}
          <div className="flex justify-end items-center gap-6 mt-6 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:border-gray-400"
            >
              {t("取消")}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-md bg-emerald-500 px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? t("保存中...") : t("保存")}
            </button>
          </div>
        </FormSection>
      </div>
    </form>
  );
}

export default function AdminActivityTemplatesPage() {
  const { t, lang } = useLanguage();
  const [types, setTypes] = useState<ActivityTemplateType[]>([]);
  const [templates, setTemplates] = useState<ActivityTemplate[]>([]);
  const [activeTypeId, setActiveTypeId] = useState<number | "all">("all");
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ActivityTemplateEditorFormState>(emptyForm());
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingFields, setResettingFields] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const filteredTemplates = useMemo(() => {
    if (activeTypeId === "all") return templates;
    return templates.filter((template) => template.type_id === activeTypeId);
  }, [activeTypeId, templates]);

  const typeNameById = useMemo(() => {
    return types.reduce<Record<number, string>>((items, type) => {
      items[type.id] = t(type.name);
      return items;
    }, {});
  }, [t, types]);

  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingId) || null,
    [editingId, templates],
  );

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [typeRes, templateRes] = await Promise.all([
        apiGet<ActivityTemplateType[]>("/api/activity/template-types"),
        apiGet<ActivityTemplate[]>("/api/activity/templates"),
      ]);
      if (typeRes.code !== 0) {
        setError(typeRes.msg || t("模板类型加载失败"));
        return;
      }
      if (templateRes.code !== 0) {
        setError(templateRes.msg || t("模板列表加载失败"));
        return;
      }
      const nextTypes = Array.isArray(typeRes.data) ? typeRes.data : [];
      const nextTemplates = Array.isArray(templateRes.data) ? templateRes.data : [];
      setTypes(nextTypes);
      setTemplates(nextTemplates);
      setForm((current) => ({
        ...current,
        type_id: current.type_id || String(nextTypes[0]?.id || ""),
      }));
    } catch {
      setError(t("无法连接后端服务，或后端尚未实现活动图模板接口"));
    } finally {
      setLoading(false);
    }
  }

  async function refreshTemplates() {
    const templateRes = await apiGet<ActivityTemplate[]>("/api/activity/templates");
    if (templateRes.code !== 0) {
      throw new Error(templateRes.msg || t("模板列表加载失败"));
    }
    const nextTemplates = Array.isArray(templateRes.data) ? templateRes.data : [];
    setTemplates(nextTemplates);
    return nextTemplates;
  }

  useEffect(() => {
    loadData();
  }, []);

  function startCreate() {
    setEditorMode("create");
    setEditingId(null);
    setForm(emptyForm(String(types[0]?.id || "")));
    setError("");
    setNotice("");
  }

  function startEdit(template: ActivityTemplate) {
    setEditorMode("edit");
    setEditingId(template.id);
    setForm(templateToForm(template));
    setError("");
    setNotice("");
  }

  function closeEditor() {
    setEditorMode(null);
    setEditingId(null);
    setForm(emptyForm(String(types[0]?.id || "")));
  }

  function handleCancel() {
    if (!window.confirm(t("确认取消？未保存的内容将会丢失。"))) return;
    closeEditor();
    setError("");
    setNotice("");
  }

  async function handleSave() {
    const validationError = validateActivityTemplateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!form.name_en.trim()) {
      setError(t("请填写模板英文名称"));
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = {
        ...buildActivityTemplatePayload(form),
        name_en: form.name_en.trim(),
        scenario_en: form.scenario_en.trim() || null,
      };
      const res =
        editorMode === "edit" && editingId !== null
          ? await apiPut<ActivityTemplate>(`/api/activity/templates/${editingId}`, payload)
          : await apiPost<ActivityTemplate>("/api/activity/templates/create", payload);
      if (res.code !== 0) {
        setError(res.msg || t("保存模板失败"));
        return;
      }
      closeEditor();
      await loadData();
      setNotice(editorMode === "edit" ? t("模板已更新") : t("模板已创建"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaultFields() {
    if (editingId === null) return;

    setResettingFields(true);
    setError("");
    setNotice("");
    try {
      const res = await apiPost<{ template_id: number; reset_count: number }>(
        `/api/activity/templates/${editingId}/fields/reset-defaults`,
        {},
      );
      if (res.code !== 0) {
        setError(res.msg || t("重置默认填写项失败"));
        return;
      }
      const nextTemplates = await refreshTemplates();
      const updated = nextTemplates.find((template) => template.id === editingId);
      if (updated) {
        setForm(templateToForm(updated));
      }
      setNotice(t("已重置为默认填写项"));
    } catch {
      setError(t("无法连接后端服务"));
    } finally {
      setResettingFields(false);
    }
  }

  async function toggleTemplate(template: ActivityTemplate) {
    setError("");
    setNotice("");
    try {
      const res = await apiPatch<ActivityTemplate>(`/api/activity/templates/${template.id}/toggle`, {});
      if (res.code !== 0) {
        setError(res.msg || t("更新模板状态失败"));
        return;
      }
      const updated = res.data ?? template;
      setTemplates((current) =>
        current.map((item) =>
          item.id === template.id ? { ...item, is_active: updated.is_active } : item,
        ),
      );
      setNotice(updated.is_active ? t("模板已启用") : t("模板已禁用"));
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  async function requestDelete(template: ActivityTemplate) {
    setError("");
    setNotice("");
    try {
      const jobsRes = await apiGet<ActivityGenerationJob[]>(`/api/activity/jobs?template_id=${template.id}`);
      const jobs = jobsRes.code === 0 && Array.isArray(jobsRes.data) ? jobsRes.data : [];
      setDeleteState({ template, hasJobs: jobs.length > 0 });
    } catch {
      setDeleteState({ template, hasJobs: true });
    }
  }

  async function confirmDelete() {
    if (!deleteState) return;
    setError("");
    setNotice("");
    try {
      const res = await apiDelete(`/api/activity/templates/${deleteState.template.id}`);
      if (res.code !== 0) {
        setError(res.msg || t("删除模板失败"));
        return;
      }
      if (editingId === deleteState.template.id) {
        closeEditor();
      }
      setDeleteState(null);
      await loadData();
      setNotice(t("模板已删除"));
    } catch {
      setError(t("无法连接后端服务"));
    }
  }

  return (
    <div>
      <PageHeader
        title={t("活动图模板管理")}
        description={t("配置活动模板、运营填写项和自动出图规则。")}
        action={
          <button type="button" onClick={startCreate} className={primaryButtonClass}>
            {t("新建模板")}
          </button>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      {editorMode && (
        <TemplateEditor
          key={`${editorMode}-${editingId || "new"}`}
          mode={editorMode}
          form={form}
          types={types}
          saving={saving}
          resettingFields={resettingFields}
          editingTemplate={editingTemplate}
          onChange={setForm}
          onSave={handleSave}
          onCancel={handleCancel}
          onResetDefaults={resetDefaultFields}
        />
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setActiveTypeId("all")}
          className={`rounded-md border px-3 py-2 text-sm transition ${
            activeTypeId === "all"
              ? "border-emerald-500 bg-emerald-50 text-emerald-700"
              : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {t("全部")}
          <span className="ml-2 text-xs opacity-70">{templates.length}</span>
        </button>
        {types.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => setActiveTypeId(type.id)}
            className={`rounded-md border px-3 py-2 text-sm transition ${
              activeTypeId === type.id
                ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(type.name)}
            <span className="ml-2 text-xs opacity-70">
              {templates.filter((template) => template.type_id === type.id).length}
            </span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("编号")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("名称")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("类型")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("使用场景")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("状态")}</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">{t("更新时间")}</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">{t("操作")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("正在加载活动图模板...")}
                </td>
              </tr>
            ) : filteredTemplates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t("暂无活动图模板")}
                </td>
              </tr>
            ) : (
              filteredTemplates.map((template) => (
                <Fragment key={template.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-900">
                      {template.template_no}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {lang === "en" ? template.name_en || template.name : template.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {template.type_name ? t(template.type_name) : typeNameById[template.type_id] || "-"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-sm text-gray-700">
                      <span className="block truncate" title={truncatedScenario(template.usage_scenario)}>
                        {truncatedScenario(template.usage_scenario)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          template.is_active
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {template.is_active ? t("启用") : t("禁用")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{formatDate(template.updated_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      <button
                        type="button"
                        onClick={() => startEdit(template)}
                        className="font-medium text-blue-600 hover:text-blue-700"
                      >
                        {t("编辑")}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleTemplate(template)}
                        className="ml-4 font-medium text-gray-700 hover:text-gray-900"
                      >
                        {template.is_active ? t("禁用") : t("启用")}
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDelete(template)}
                        className="ml-4 font-medium text-red-600 hover:text-red-700"
                      >
                        {t("删除")}
                      </button>
                    </td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteState !== null}
        title={t("删除活动图模板")}
        description={
          deleteState?.hasJobs
            ? t("该模板已有生产记录，确认删除？")
            : `${t("确认删除模板")} ${deleteState?.template.template_no || ""}？`
        }
        onCancel={() => setDeleteState(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
