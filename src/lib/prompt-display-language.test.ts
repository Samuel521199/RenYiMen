import assert from "node:assert/strict";
import test from "node:test";

import {
  promptForInterfaceLanguage,
  sanitizePromptForInterfaceLanguage,
} from "./prompt-display-language";

test("Chinese prompt display removes English prose but preserves Chinese and locked brand identifiers", () => {
  const mixed = [
    "资产参考图，目标资产：卡通牛角色；严格只显示 1 个主体，A single anthropomorphic cartoon bull character standing in a neutral pose.",
    "角色面带自信微笑。TONGITS KING Logo",
  ].join("\n");
  const displayed = sanitizePromptForInterfaceLanguage(mixed, "zh");
  assert.match(displayed, /资产参考图/);
  assert.match(displayed, /严格只显示 1 个主体/);
  assert.match(displayed, /角色面带自信微笑/);
  assert.match(displayed, /TONGITS KING Logo/);
  assert.doesNotMatch(displayed, /anthropomorphic|neutral pose|standing in/);
});

test("English prompt display removes Chinese prose", () => {
  const displayed = sanitizePromptForInterfaceLanguage(
    "Asset sheet for the bull. 角色必须正面站立。Centered full-body composition.",
    "en",
  );
  assert.equal(displayed, "Asset sheet for the bull. Centered full-body composition");
  assert.doesNotMatch(displayed, /[\u3400-\u9fff]/);
});

test("missing localized copy never leaks the opposite language into the interface", () => {
  const displayed = promptForInterfaceLanguage({
    preferred: "",
    fallback: "A detailed English-only generation prompt for a cartoon bull.",
    lang: "zh",
  });
  assert.equal(displayed, "中文展示稿暂不可用，请重新生成或直接编辑此提示词。");
});
