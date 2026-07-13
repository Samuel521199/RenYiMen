import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("tag combobox keeps a persistent custom-tag action with explicit create controls", () => {
  const source = readFileSync("frontend/components/common/TagCombobox.tsx", "utf8");

  assert.match(source, /options:\s*Array<\{\s*name:/);
  assert.match(source, /multiple\??:\s*boolean/);
  assert.match(source, /\/api\/assets\/tags\/create-inline/);
  assert.match(source, /\+ 自定义/);
  assert.match(source, /输入后按回车创建/);
  assert.match(source, /确认/);
  assert.match(source, /取消/);
  assert.match(source, /event\.key === "Escape"/);
  assert.doesNotMatch(source, /\+ 创建「/);
  assert.match(source, /onOptionsRefresh/);
  assert.match(source, /selected/);
  assert.match(source, /tag_group/);
});
