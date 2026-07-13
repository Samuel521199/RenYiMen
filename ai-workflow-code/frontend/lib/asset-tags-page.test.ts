import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("asset tags page exposes background tag grouping UI and labels", () => {
  const pageSource = readFileSync("frontend/app/assets/tags/page.tsx", "utf8");

  assert.match(pageSource, /分组/);
  assert.match(pageSource, /标签分组/);
  assert.match(pageSource, /category === "background"/);
  assert.match(pageSource, /purpose/);
  assert.match(pageSource, /scene/);
  assert.match(pageSource, /mood/);
  assert.match(pageSource, /color_style/);
  assert.match(pageSource, /用途/);
  assert.match(pageSource, /场景/);
  assert.match(pageSource, /氛围/);
  assert.match(pageSource, /颜色风格/);
});
