import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workflow sessions page supports activity and background workflow sessions", () => {
  const pageSource = readFileSync("frontend/app/workflows/page.tsx", "utf8");

  assert.match(pageSource, /activity:\s*"活动图生产"/);
  assert.match(pageSource, /background:\s*"背景图生成"/);
  assert.match(pageSource, /session\.workflow_type === "activity"/);
  assert.match(pageSource, /session\.workflow_type === "background"/);
  assert.match(pageSource, /\/workflows\/activity\?session_id=\$\{sessionId\}/);
  assert.match(pageSource, /\/workflows\/background\?session_id=\$\{sessionId\}/);
  assert.match(pageSource, /getSessionHref\(session\)/);
  assert.match(pageSource, /bg-blue-50 text-blue-600/);
  assert.match(pageSource, /bg-violet-50 text-violet-600/);
  assert.match(pageSource, /session\.workflow_type === "background"/);
  assert.match(pageSource, /session\.status === "completed"/);
  assert.match(pageSource, /state\.step \|\| session\.current_step \|\| 1/);
  assert.match(pageSource, /return "已完成"/);
  assert.match(pageSource, /return `第 \$\{step\} 步`/);
  assert.doesNotMatch(pageSource, /workflow_type=expression&status/);
});

test("activity workflow page restores batches from workflow sessions", () => {
  const pageSource = readFileSync("frontend/app/workflows/activity/page.tsx", "utf8");

  assert.match(pageSource, /useSearchParams\(\)/);
  assert.match(pageSource, /<Suspense/);
  assert.match(pageSource, /\/api\/workflow-sessions\/\$\{sessionId\}/);
  assert.match(pageSource, /\/api\/activity\/batches\/\$\{state\.batch_id\}/);
  assert.match(pageSource, /setStep\(4\)/);
});

test("activity workflow refine action uses loading guard and disables duplicate clicks", () => {
  const pageSource = readFileSync("frontend/app/workflows/activity/page.tsx", "utf8");

  assert.match(pageSource, /refiningLoading/);
  assert.match(pageSource, /生成中…/);
  assert.match(pageSource, /disabled=\{!refinePromptInput\.trim\(\) \|\| refiningLoading\}/);
  assert.match(pageSource, /disabled=\{refiningLoading\}/);
});

test("activity workflow background selector explains background library reuse", () => {
  const pageSource = readFileSync("frontend/app/workflows/activity/page.tsx", "utf8");

  assert.match(pageSource, /背景图库中的素材均可直接选用，如需新背景可前往背景图生成工作流制作后入库/);
  assert.match(pageSource, /title="背景参考图"/);
});
