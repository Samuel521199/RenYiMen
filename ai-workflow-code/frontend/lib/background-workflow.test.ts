import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("background workflow page restores sessions and uses the activity light theme shell", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /useSearchParams\(\)/);
  assert.match(pageSource, /<Suspense/);
  assert.match(pageSource, /ACTIVITY_PAGE_SHELL_CLASS/);
  assert.match(pageSource, /ACTIVITY_SECTION_CARD_CLASS/);
  assert.match(pageSource, /\/api\/workflow-sessions\/\$\{sessionId\}/);
});

test("background workflow page loads all key form options from background tags and exposes four steps", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /填写任务参数/);
  assert.match(pageSource, /生成草图/);
  assert.match(pageSource, /精修标准化/);
  assert.match(pageSource, /入素材库/);
  assert.match(pageSource, /\/api\/assets\/tags\?category=\$\{encodeURIComponent\("background"\)\}/);
  assert.match(pageSource, /tag\.group === "purpose"/);
  assert.match(pageSource, /tag\.group === "scene"/);
  assert.match(pageSource, /tag\.group === "mood"/);
  assert.match(pageSource, /tag\.group === "color_style"/);
  assert.match(pageSource, /TagCombobox/);
  assert.match(pageSource, /本地风格化/);
  assert.match(pageSource, /whitespacePositions/);
  assert.match(pageSource, /whitespace_positions/);
  assert.match(pageSource, /补充描述/);
  assert.match(pageSource, /extra_prompt/);
  assert.match(pageSource, /地方集市，摊位密集，彩色遮阳布，热闹氛围/);
  assert.match(pageSource, /extra_prompt: formState\.extraPrompt \|\| undefined/);
  assert.doesNotMatch(pageSource, /classifyBackgroundTag/);
  assert.doesNotMatch(pageSource, /stripTagPrefix/);
});

test("background workflow page generates reviews archives and limits reference uploads", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /\/api\/background\/available-models/);
  assert.match(pageSource, /\?mode=\$\{mode\}/);
  assert.match(pageSource, /\/api\/background\/batches\/\$\{batchId\}\/generate/);
  assert.match(pageSource, /\/api\/background\/images\/\$\{imageId\}\/review/);
  assert.match(pageSource, /\/api\/background\/images\/\$\{imageId\}\/archive/);
  assert.match(pageSource, /modelConfigId/);
  assert.match(pageSource, /model_config_id/);
  assert.match(pageSource, /开始生成/);
  assert.match(pageSource, /最多 3 张/);
  assert.match(pageSource, /上传参考图后，生成模型将自动限制为支持参考图模式的模型/);
  assert.match(pageSource, /review_status/);
  assert.match(pageSource, /is_recommended/);
  assert.match(pageSource, /精修使用参考图模式，仅支持 gpt-image 系列模型/);
  assert.match(pageSource, /已加入素材库，可在活动图工作流 Step 2 背景选择器中直接选用/);
  assert.match(pageSource, /已入库/);
});

test("background workflow page switches step 2 model source when reference images exist", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /const hasReferenceAssets = referenceAssets\.length > 0/);
  assert.match(pageSource, /const mode = hasReferenceAssets \? "refine" : undefined/);
  assert.match(pageSource, /await fetchAvailableModels\(mode\)/);
  assert.match(pageSource, /setModelConfigId\(nextSelectedModelId\)/);
  assert.match(pageSource, /已选模型不支持参考图，已自动切换/);
  assert.match(pageSource, /referenceAssets\.length/);
});

test("background workflow page keeps all available models instead of filtering to final only", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /return Array\.isArray\(res\.data\) \? res\.data : \[\];/);
  assert.doesNotMatch(pageSource, /usage_type === "final" \|\| model\.usage_type === "both"/);
  assert.doesNotMatch(pageSource, /const finalModels = models\.filter/);
});

test("background workflow page moves generation count control to step 2 and partitions pending versus approved cards", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");
  const cardSource = readFileSync("frontend/components/workflow/ImageReviewCard.tsx", "utf8");

  assert.doesNotMatch(pageSource, /updateForm\("count"/);
  assert.doesNotMatch(pageSource, /formState\.count/);
  assert.match(pageSource, /待筛选/);
  assert.match(pageSource, /已通过/);
  assert.match(cardSource, /撤回/);
  assert.match(pageSource, /review_status === "pending"/);
  assert.match(pageSource, /review_status === "approved" \|\| image\.review_status === "refine"/);
  assert.match(pageSource, /text-sm font-medium text-gray-700">生成数量/);
  assert.match(pageSource, /value=\{generationCount\}/);
  assert.match(pageSource, /<option key=\{count\} value=\{count\}>/);
  assert.match(pageSource, /count: regenerateImageId \? 1 : generationCount/);
  assert.match(pageSource, /下一步/);
});

test("background workflow page refreshes batch details after generate succeeds", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(
    pageSource,
    /\/api\/background\/batches\/\$\{batchId\}\/generate[\s\S]*if \(res\.code !== 0 \|\| !res\.data\) \{[\s\S]*await refreshBatch\(batchId\)[\s\S]*setStep\(2\)/,
  );
});

test("background workflow page disables generation controls for archived batches", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /batch\?\.status === "archived"/);
  assert.match(pageSource, /该批次已入库，如需重新生成请新建任务/);
  assert.match(pageSource, /label=\{isArchivedBatch \? "已入库" : "开始生成"\}/);
  assert.match(pageSource, /loadingLabel="生成中…"/);
  assert.match(pageSource, /disabled=\{!batchId \|\| isArchivedBatch \|\| generating \|\| loadingModels \|\| !modelConfigId\}/);
  assert.match(pageSource, /disabled=\{workingImageId === imageId \|\| isArchivedBatch \|\| generating \|\| !modelConfigId\}/);
});

test("background workflow page adds AI refine action for reviewed images", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /AI 精修/);
  assert.match(pageSource, /精修指令（可选）/);
  assert.match(pageSource, /针对这张图的精修方向，例如：增强光影层次、去掉右下角多余元素/);
  assert.match(pageSource, /const \[refinePromptByImageId, setRefinePromptByImageId\] = useState<Record<number, string>>\(\{\}\)/);
  assert.match(pageSource, /value=\{refinePromptByImageId\[image\.id\] \|\| ""\}/);
  assert.match(pageSource, /精修中\.\.\./);
  assert.match(pageSource, /\/api\/background\/images\/\$\{imageId\}\/refine/);
  assert.match(pageSource, /model_config_id: refineModelConfigId/);
  assert.match(pageSource, /refine_prompt: refinePromptByImageId\[imageId\] \|\| undefined/);
  assert.match(pageSource, /disabled=\{workingImageId === image\.id \|\| !refineModelConfigId\}/);
  assert.match(
    pageSource,
    /\/api\/background\/images\/\$\{imageId\}\/refine[\s\S]*await refreshBatch\(batchId\)[\s\S]*setMessage\("AI 精修已完成"\)/,
  );
});

test("background workflow page shows a completion confirmation after all reviewed images are archived", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");

  assert.match(pageSource, /pendingArchiveImages\.length === 0/);
  assert.match(pageSource, /所有背景图已入库，本次任务完成/);
  assert.match(pageSource, /返回任务列表/);
  assert.match(pageSource, /router\.push\("\/workflows"\)/);
});

test("background workflow page renders a clickable whitespace position diagram", () => {
  const pageSource = readFileSync("frontend/app/workflows/background/page.tsx", "utf8");
  const pickerSource = readFileSync("frontend/components/workflow/WhitespacePositionPicker.tsx", "utf8");

  assert.match(pageSource, /@\/components\/workflow\/WhitespacePositionPicker/);
  assert.doesNotMatch(pageSource, /function WhitespacePositionPicker/);
  assert.match(pickerSource, /<svg[^>]+width=\{160\}[^>]+height=\{200\}/);
  assert.match(pickerSource, /strokeDasharray="3 3"/);
  assert.match(pickerSource, /x:\s*8,\s*y:\s*8,\s*width:\s*144,\s*height:\s*56/);
  assert.match(pickerSource, /x:\s*8,\s*y:\s*144,\s*width:\s*144,\s*height:\s*48/);
  assert.match(pickerSource, /x:\s*8,\s*y:\s*64,\s*width:\s*48,\s*height:\s*80/);
  assert.match(pickerSource, /x:\s*104,\s*y:\s*64,\s*width:\s*48,\s*height:\s*80/);
  assert.match(pickerSource, /x:\s*56,\s*y:\s*64,\s*width:\s*48,\s*height:\s*80/);
  assert.match(pickerSource, /rgba\(0,\s*0,\s*0,\s*0\.15\)/);
  assert.match(pickerSource, /rgba\(0,\s*0,\s*0,\s*0\.06\)/);
});
