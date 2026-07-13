import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LIGHT_THEME_CLASSES,
  buildActivityTemplatePayload,
  validateActivityTemplateForm,
  type ActivityTemplateFormState,
} from "./activity-template-admin.ts";

function baseForm(): ActivityTemplateFormState {
  return {
    template_no: " T01 ",
    name: " 回访召回 ",
    type_id: "2",
    usage_scenario: "7天未登录用户召回",
    is_active: true,
    structure_layer1: "金币奖励展示",
    structure_layer2: "标题区",
    structure_layer3: "按钮区",
    bg_description: "金色背景",
    forbidden_rules: "禁止中文",
    style_guide: "高饱和金币风格，品牌牛角色统一材质",
    style_tag: "3D卡通",
    rule_character: "固定角色",
    rule_scene: "大厅",
    rule_visual: "奖励居中",
    rule_copy: "短文案",
    rule_button: "高对比",
    rule_quality: "高清",
    rule_forbidden: "禁止额外角色",
    fields: [
      {
        field_key: "title",
        field_name: "主标题",
        field_type: "text",
        is_required: true,
        default_value: "Come Back",
        hint: "最多6词",
        options_text: "",
      },
      {
        field_key: "field_9",
        field_name: "奖励类型",
        field_type: "select",
        is_required: true,
        default_value: "Coins",
        hint: "",
        options_text: "Coins, Bonus, , Gift",
      },
    ],
  };
}

test("activity template admin payload normalizes fields and keeps preset keys", () => {
  const payload = buildActivityTemplatePayload(baseForm());

  assert.equal(payload.template_no, "T01");
  assert.equal(payload.name, "回访召回");
  assert.equal(payload.type_id, 2);
  assert.equal(payload.prompt_template, "structured_prompt_managed_by_rules");
  assert.equal(payload.style_guide, "高饱和金币风格，品牌牛角色统一材质");
  assert.equal(payload.style_tag, "3D卡通");
  assert.equal(payload.fields[0].field_key, "title");
  assert.equal(payload.fields[0].sort_order, 1);
  assert.equal(payload.fields[1].field_key, "field_2");
  assert.deepEqual(payload.fields[1].options_json, ["Coins", "Bonus", "Gift"]);
});

test("activity template admin validation requires select options", () => {
  const form = baseForm();
  form.fields[1].options_text = " , ";

  assert.equal(validateActivityTemplateForm(form), "请为「奖励类型」填写选项内容");
});

test("activity template admin light theme helper excludes dark page classes", () => {
  assert.match(LIGHT_THEME_CLASSES, /bg-white/);
  assert.match(LIGHT_THEME_CLASSES, /border-gray-200/);
  assert.match(LIGHT_THEME_CLASSES, /text-gray-900/);
  assert.doesNotMatch(LIGHT_THEME_CLASSES, /bg-gray-800/);
  assert.doesNotMatch(LIGHT_THEME_CLASSES, /bg-gray-900/);
  assert.doesNotMatch(LIGHT_THEME_CLASSES, /border-gray-700/);
});

test("activity template editor keeps save actions at the end of section 4", () => {
  const pageSource = readFileSync("frontend/app/admin/activity-templates/page.tsx", "utf8");

  assert.match(pageSource, /Section 4 底部操作栏/);
  assert.match(pageSource, /确认取消？未保存的内容将会丢失。/);
  assert.match(pageSource, /className="flex justify-end items-center gap-6 mt-6 pt-4 border-t border-gray-100"/);
  assert.doesNotMatch(pageSource, /保存修改/);
});
