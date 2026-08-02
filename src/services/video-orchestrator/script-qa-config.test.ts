import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isOnePromptVideoScriptQaEnabled,
  readOnePromptVideoScriptQaConfig,
} from "./script-qa-config.ts";

test("script QA is opt-in and defaults to disabled", () => {
  assert.equal(isOnePromptVideoScriptQaEnabled({ NODE_ENV: "development" }), false);
});

test("script QA can be explicitly enabled", () => {
  assert.equal(isOnePromptVideoScriptQaEnabled({
    NODE_ENV: "development",
    ONE_PROMPT_VIDEO_SCRIPT_QA: "true",
  }), true);
});

test("fast preview overrides an enabled script QA switch", () => {
  const config = readOnePromptVideoScriptQaConfig({
    NODE_ENV: "development",
    ONE_PROMPT_VIDEO_SCRIPT_QA: "true",
    ONE_PROMPT_VIDEO_FAST_PREVIEW: "true",
  });
  assert.equal(config.enabled, false);
  assert.equal(config.disabledByFastPreview, true);
});

test("production may explicitly enable script QA while fast preview stays blocked", () => {
  assert.equal(isOnePromptVideoScriptQaEnabled({
    NODE_ENV: "production",
    ONE_PROMPT_VIDEO_SCRIPT_QA: "true",
    ONE_PROMPT_VIDEO_FAST_PREVIEW: "true",
  }), true);
});

test("planner keeps story contracts advisory while script QA is disabled", () => {
  const source = readFileSync(
    new URL("./three-stage-planner.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /planning_contract\.advisory_only/);
  assert.match(source, /story_contract\.advisory_only/);
  assert.match(
    source,
    /isOnePromptVideoScriptQaEnabled\(\) && !finalStoryContract\.passed/,
  );
  assert.match(
    source,
    /function semanticStoryGateMode\(\)[\s\S]*?!isOnePromptVideoScriptQaEnabled\(\)\) return "off"/,
  );
  assert.match(
    source,
    /function singleTakeMaxRevisions[\s\S]*?!isOnePromptVideoScriptQaEnabled\(\)\) return 0/,
  );
});
