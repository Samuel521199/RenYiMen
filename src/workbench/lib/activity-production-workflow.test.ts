import assert from "node:assert/strict";
import test from "node:test";

import {
  buildActivityPromptPreview,
  buildActivityReferenceAssetQueryPath,
  normalizeActivityBatchImages,
  normalizeActivityReferenceTagNames,
  collectActivityReferenceAssetIds,
  buildActivityVariablesJson,
  initialActivityFieldValues,
  resetRejectedActivityGeneration,
  toggleActivityReferenceAssetSelection,
  validateActivityFieldValues,
  type ActivityFieldDefinition,
} from "./activity-production-workflow.ts";

const fields: ActivityFieldDefinition[] = [
  {
    field_key: "title",
    field_name: "主标题",
    field_type: "text",
    is_required: true,
    default_value: "Come Back",
    hint: "最多6个英文词",
    options_json: null,
    sort_order: 1,
  },
  {
    field_key: "bonus_type",
    field_name: "奖励类型",
    field_type: "select",
    is_required: true,
    default_value: "Coins",
    hint: null,
    options_json: ["Coins", "Bonus"],
    sort_order: 2,
  },
  {
    field_key: "show_button",
    field_name: "显示按钮",
    field_type: "switch",
    is_required: true,
    default_value: "true",
    hint: null,
    options_json: null,
    sort_order: 3,
  },
];

test("activity production initializes dynamic fields from template defaults", () => {
  assert.deepEqual(initialActivityFieldValues(fields), {
    title: "Come Back",
    bonus_type: "Coins",
    show_button: "true",
  });
});

test("activity production validateFields returns field-name error and null when complete", () => {
  const values = initialActivityFieldValues(fields);
  values.title = "  ";

  assert.equal(validateActivityFieldValues(fields, values), '请填写"主标题"');

  values.title = "  Big Reward  ";
  assert.equal(validateActivityFieldValues(fields, values), null);
});

test("activity production builds variables_json from trimmed field values", () => {
  const values = initialActivityFieldValues(fields);
  values.title = "  Big Reward  ";

  assert.deepEqual(buildActivityVariablesJson(fields, values), {
    title: "Big Reward",
    bonus_type: "Coins",
    show_button: "true",
  });
});

test("activity production prompt preview uses business labels and output section", () => {
  const preview = buildActivityPromptPreview(
    {
      template_no: "T01",
      name: "强奖励召回",
      structure_layer1: "奖励居中",
      structure_layer2: "标题在上方",
      structure_layer3: "按钮在底部",
      bg_description: "金色背景",
      rule_character: "固定牛角色",
      style_guide: "统一高饱和金币质感",
      rule_copy: "英文短句",
      fields,
    },
    initialActivityFieldValues(fields),
    "1080x1080",
  );

  assert.match(preview, /\[CHARACTER\]\n固定牛角色/);
  assert.match(preview, /\[STYLE GUIDE\]\n统一高饱和金币质感/);
  assert.match(preview, /\[CONTENT\]\n主标题: Come Back\n奖励类型: Coins\n显示按钮: true/);
  assert.match(preview, /\[OUTPUT\]\n1080 x 1080\nSingle image/);
});

test("activity production collects non-empty typed reference image ids in slot order", () => {
  assert.deepEqual(
    collectActivityReferenceAssetIds({
      character: 9,
      background: null,
      props: 12,
    }),
    [9, 12],
  );
});

test("activity production reference image selection toggles ids and caps at four", () => {
  assert.deepEqual(toggleActivityReferenceAssetSelection([1, 2], 2), [1]);
  assert.deepEqual(toggleActivityReferenceAssetSelection([1, 2, 3, 4], 5), [1, 2, 3, 4]);
  assert.deepEqual(toggleActivityReferenceAssetSelection([1, 2, 3], 4), [1, 2, 3, 4]);
});

test("activity production builds reference asset query path with category, limit, and optional tag", () => {
  assert.equal(
    buildActivityReferenceAssetQueryPath("expression", null),
    "/api/assets?category=expression&limit=30",
  );
  assert.equal(
    buildActivityReferenceAssetQueryPath("background", "金库 场景"),
    "/api/assets?category=background&limit=30&tags=%E9%87%91%E5%BA%93%20%E5%9C%BA%E6%99%AF",
  );
});

test("activity production normalizes reference tag names from string and object payloads", () => {
  assert.deepEqual(
    normalizeActivityReferenceTagNames([
      "3D卡通",
      { id: 1, name: "金币风" },
      { id: 2, name: "   " },
      "",
      null,
    ]),
    ["3D卡通", "金币风"],
  );
});

test("activity production normalizes batch images from backend snake_case payloads", () => {
  assert.deepEqual(
    normalizeActivityBatchImages([
      {
        id: 7,
        batch_id: 3,
        image_url: "/static/generated/a.png",
        extra_prompt: "more coins",
        refine_prompt: "fix hand",
        parent_image_id: 2,
        prompt_rendered: "Prompt",
        status: "done",
        cost_usd: "0.120000",
        token_used: 240,
        sort_order: 1,
      },
    ]),
    [
      {
        id: 7,
        batchId: 3,
        imageUrl: "/static/generated/a.png",
        extraPrompt: "more coins",
        refinePrompt: "fix hand",
        parentImageId: 2,
        promptRendered: "Prompt",
        status: "done",
        costUsd: 0.12,
        tokenUsed: 240,
        sortOrder: 1,
      },
    ],
  );
});

test("activity production reject regeneration clears generated state and returns step 3", () => {
  const transition = resetRejectedActivityGeneration({
    currentJobId: 20,
    generatedImageUrl: "/static/image.png",
    promptRendered: "prompt",
    qc: {
      reward_visible: true,
      action_clear: true,
      character_consistent: true,
    },
  });

  const nextState = transition.state;
  assert.equal(transition.step, 3);
  assert.equal(nextState.currentJobId, null);
  assert.equal(nextState.generatedImageUrl, "");
  assert.equal(nextState.promptRendered, "");
  assert.deepEqual(nextState.qc, {
    reward_visible: false,
    action_clear: false,
    character_consistent: false,
  });
});
