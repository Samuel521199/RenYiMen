import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeGameVisualPromptText, stripNonStandardPromptSymbols } from "./frame-contract";

test("stripNonStandardPromptSymbols removes replacement chars and zero-width artifacts", () => {
  const cleaned = stripNonStandardPromptSymbols("倒计时\uFFFD 00:30\u200B score 1280");
  assert.equal(cleaned, "倒计时 00:30 score 1280");
});

test("sanitizeGameVisualPromptText normalizes timer and score HUD wording", () => {
  const cleaned = sanitizeGameVisualPromptText("游戏界面倒计时: 00:15，分数: 9999", "guofeng");
  assert.match(cleaned, /MM:SS/);
  assert.match(cleaned, /阿拉伯数字/);
  assert.match(cleaned, /国风/);
  assert.doesNotMatch(cleaned, /★/);
});

test("sanitizeGameVisualPromptText skips generic HUD rules for brand logo assets", () => {
  const cleaned = sanitizeGameVisualPromptText(
    "Generate a clean centered reference image of only the COLOR BLITZ SOCIAL logo with DOUBLE UP BONUS banner and x2 icon on pure white background.",
    "guofeng",
    { brandVisual: true },
  );
  assert.match(cleaned, /COLOR BLITZ SOCIAL/);
  assert.doesNotMatch(cleaned, /国风/);
  assert.doesNotMatch(cleaned, /Game HUD uses clean sans-serif/);
});
