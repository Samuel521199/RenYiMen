import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("embedded tool studio uses the available viewport instead of adding another screen height", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.match(source, /embedded \? "relative flex h-full min-h-0/);
  assert.match(source, /max-w-\[1600px\]/);
  assert.match(source, /STUDIO_SPLIT_STORAGE_KEY/);
  assert.match(source, /lg:w-\[var\(--studio-left-width\)\]/);
  assert.match(source, /role="separator"/);
  assert.match(source, /onPointerMove=\{handleSplitPointerMove\}/);
  assert.match(source, /onDoubleClick/);
  assert.match(source, /compact=\{embedded\}/);
});

test("the tools route provides a definite height to the embedded studio", () => {
  const source = readFileSync("src/app/(platform)/workbench/tools/page.tsx", "utf8");

  assert.match(source, /className="h-full min-h-0 flex-1"/);
});

test("the tools gallery title uses the same display typography as the home section heading", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.match(source, /<h1 className="home-section-title text-3xl sm:text-4xl">/);
});

test("dynamic fields use a responsive two-column desktop grid", () => {
  const source = readFileSync("src/components/WorkflowForm/DynamicForm.tsx", "utf8");

  assert.match(source, /xl:grid-cols-2/);
  assert.match(source, /grid-cols-1 gap-5/);
  assert.match(source, /multiImageUpload/);
  assert.match(source, /xl:col-span-2/);
});

test("upload constraints live in field help instead of persistent group copy", () => {
  const source = readFileSync("src/components/WorkflowForm/DynamicForm.tsx", "utf8");

  assert.match(source, /movesDescriptionToUploads/);
  assert.match(source, /uploadConstraintHelp/);
  assert.match(source, /validation\.maxSizeMB/);
  assert.match(source, /validation\.minDimension/);
  assert.match(source, /resolveMediaDurationRange/);
  assert.match(source, /field\.maxItems/);
  assert.match(source, /group-hover\/help:visible/);
});

test("embedded task viewer can shrink to the parent panel", () => {
  const viewerSource = readFileSync("src/components/TaskStatusViewer/TaskStatusViewer.tsx", "utf8");
  const studioSource = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.match(viewerSource, /compact\?: boolean/);
  assert.match(viewerSource, /h-full min-h-0/);
  assert.doesNotMatch(viewerSource, /compact[\s\S]{0,120}min-h-\[510px\]/);
  assert.match(viewerSource, /overscroll-contain/);
  assert.match(viewerSource, /scrollable \? "overflow-y-auto" : "overflow-y-hidden"/);
  assert.match(viewerSource, /layerClass\(active, false\)/);
  assert.match(studioSource, /min-h-0 flex-1 overflow-hidden/);
  assert.match(studioSource, /100dvh-7rem/);
});

test("editing workflow parameters clears a stale submission error", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.match(source, /setSubmitError\(null\);\s*\}, \[parameters\]\);/);
});

test("audio upload shows and enforces the selected motion mode duration range", () => {
  const source = readFileSync("src/components/WorkflowForm/controls/AudioUploadControl.tsx", "utf8");
  const videoSource = readFileSync("src/components/WorkflowForm/controls/VideoUploadControl.tsx", "utf8");

  assert.match(source, /mediaDurationRangeText/);
  assert.match(source, /validateMediaDuration/);
  assert.match(source, /当前动作模式时长/);
  assert.match(source, /uploaded/);
  assert.match(videoSource, /hasDynamicDuration/);
  assert.match(videoSource, /validateMediaDuration/);
  assert.match(videoSource, /当前动作模式时长/);
});

test("tool generation does not depend on the optional project persistence API", () => {
  const studioSource = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.doesNotMatch(studioSource, /<ToolProjectSelector/);
  assert.doesNotMatch(studioSource, /Please wait for a project to load/);
  assert.doesNotMatch(studioSource, /!selectedToolProjectId \|\| sessionStatus/);
  assert.match(studioSource, /body: JSON\.stringify\(built\)/);
  assert.match(studioSource, /fetchCloudHistory\(null\)/);
});

test("task elapsed time survives polling view reinitialization for the same task", () => {
  const source = readFileSync("src/hooks/useTaskPolling.ts", "utf8");

  assert.match(source, /const taskStartTimes = new Map<string, number>\(\)/);
  assert.match(source, /getOrCreateTaskStartTime\(taskId\)/);
  assert.match(source, /taskStartTimes\.delete\(currentTaskId\)/);
  assert.doesNotMatch(source, /pollStartRef\.current = Date\.now\(\)/);
});

test("the four featured video-edit tools also appear under AI video editing", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");
  const setStart = source.indexOf("const AI_VIDEO_EDITING_SKU_IDS");
  const setEnd = source.indexOf("]);", setStart);
  const editingSet = source.slice(setStart, setEnd);

  for (const skuId of [
    "BAILIAN_HAPPYHORSE_VIDEO_EDIT",
    "BAILIAN_SCENE_LIGHT_VIDEO_EDIT",
    "BAILIAN_OVERALL_STYLE_TRANSFER",
    "BAILIAN_HIGH_DYNAMIC_REDRAW",
  ]) {
    assert.match(editingSet, new RegExp(skuId));
  }
  assert.match(source, /activeToolGroup === "video-editing"/);
  assert.match(source, /isSkuInVideoEditingTab/);
});

test("video generation is split into image-to-video and continuation tabs", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

  assert.match(source, /type VideoGenerationTab = "image-to-video" \| "video-continuation"/);
  assert.match(source, /label: "图生视频"/);
  assert.match(source, /label: "视频续写"/);
  assert.match(source, /activeToolGroup === "video-generation"/);
  assert.match(source, /isSkuInVideoGenerationTab/);
  assert.match(source, /VIDEO_CONTINUATION_SKU_IDS/);
  assert.match(source, /BAILIAN_WAN27_VIDEO_CONTINUATION/);
});

test("audio navigation uses the shared audio category button", () => {
  const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");
  const topNavigationSource = readFileSync("src/workbench/components/layout/TopNavigation.tsx", "utf8");

  assert.match(topNavigationSource, /label: "音频", labelEn: "Audio", href: "\/workbench\/tools\?category=audio"/);
  assert.match(source, /\{ key: "audio", label: t\.categoryAudio \}/);
  assert.match(source, /activeToolGroup === "audio-post" \? "audio" : "video"/);
  assert.doesNotMatch(source, /AUDIO_POST_TABS|AudioPostTab/);
});
