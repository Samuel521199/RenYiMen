# Activity Template Admin Redesign

## Goal

Rewrite `/admin/activity-templates` from a technical prompt-template editor into a business-facing activity form configurator. Admins configure template structure, operator-facing form fields, and image rules; operators later fill those fields and the backend builds the prompt.

## Layout

The page uses a two-part single-page layout:

- A fixed inline editor above the list, shown only when creating or editing.
- A template list below the editor.

The editor is opened by "新建模板" or "编辑". It does not open inside table rows. This keeps the table stable and gives the form enough space for four configuration sections.

## Template List

The list loads template types from `GET /api/activity/template-types` and templates from `GET /api/activity/templates`.

It shows:

- Tabs: 全部 plus every loaded template type.
- Columns: 编号, 名称, 类型, 使用场景, 状态, 操作.
- Actions: 编辑, 启用/禁用, 删除.

The usage scenario column displays `usage_scenario` as a truncated single-line value.

## Editor Sections

All sections use light `details` panels. Section 1 is expanded by default. Sections 2, 3, and 4 are collapsed by default.

Section 1: 基础信息

- `template_no`
- `name`
- `type_id`
- `usage_scenario`
- `is_active`

Section 2: 画面结构配置

- `structure_layer1`
- `structure_layer2`
- `structure_layer3`
- `bg_description`
- `forbidden_rules`

Section 3: 活动填写项配置

- Each row edits `field_name`, `field_type`, `is_required`, `default_value`, `hint`, and select options.
- `field_key` is not user-editable.
- Preset default keys are preserved when present: `title`, `subtitle`, `reward_amount`, `bonus_type`, `cta_text`.
- Added fields use `field_6`, `field_7`, and so on after payload normalization.
- Field rows are submitted with normalized `sort_order`.
- Select options are edited as comma-separated text and submitted as `options_json`.
- Existing templates show a reset button that calls `POST /api/activity/templates/{id}/fields/reset-defaults`.

Section 4: 出图规则

- `rule_character`
- `rule_scene`
- `rule_visual`
- `rule_copy`
- `rule_button`
- `rule_quality`
- `rule_forbidden`

The legacy `prompt_template` is hidden from admins and submitted as a compatibility placeholder.

## Styling

The page must stay in the global light admin style:

- Allowed families include `bg-white`, `bg-gray-50`, `border-gray-200`, `text-gray-900`, and related light states.
- The admin page must not use dark container classes such as `bg-gray-800`, `bg-gray-900`, or `border-gray-700`.

## Validation

The frontend validates required template identity and structure fields before submit. At least one activity field is required. Select fields must include at least one option after trimming.

## Verification

Add a focused frontend helper test covering payload normalization and light-theme class constraints, then run the frontend build.
