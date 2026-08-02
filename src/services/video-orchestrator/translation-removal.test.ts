import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const plannerSource = readFileSync(
  path.join(root, "src/services/video-orchestrator/three-stage-planner.ts"),
  "utf8",
);
const packageJson = readFileSync(path.join(root, "package.json"), "utf8");
const envExamples = [
  readFileSync(path.join(root, ".env.example"), "utf8"),
  readFileSync(path.join(root, ".env.local.example"), "utf8"),
].join("\n");
const composeSource = [
  readFileSync(path.join(root, "docker-compose.yml"), "utf8"),
  readFileSync(path.join(root, "docker-compose.dev.yml"), "utf8"),
].join("\n");

test("one-prompt planning sends and consumes model text without a translation boundary", () => {
  assert.doesNotMatch(plannerSource, /local-translation|local_translation/);
  assert.doesNotMatch(plannerSource, /prepareEnglishOnlyModelRequestBody/);
  assert.doesNotMatch(plannerSource, /localizeChineseDisplayFields/);
  assert.match(plannerSource, /body:\s*JSON\.stringify\(body\)/);
  assert.match(plannerSource, /body:\s*JSON\.stringify\(\{\s*\.\.\.body,\s*stream:\s*true/);
  assert.match(plannerSource, /return parsed as T/);
});

test("translation model implementation and runtime configuration are removed", () => {
  assert.equal(
    existsSync(path.join(root, "src/services/video-orchestrator/local-translation.ts")),
    false,
  );
  assert.equal(
    existsSync(path.join(root, "scripts/start-local-translation.ps1")),
    false,
  );
  assert.doesNotMatch(packageJson, /translation:start|test:local-translation/);
  assert.doesNotMatch(envExamples, /MODEL_TRANSLATION|QWEN_MT|LOCAL_TRANSLATION|LIBRETRANSLATE/);
  assert.doesNotMatch(composeSource, /MODEL_TRANSLATION|QWEN_MT|LOCAL_TRANSLATION|libretranslate/i);
});
