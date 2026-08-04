import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const controlsDir = path.join(process.cwd(), "src/components/WorkflowForm/controls");
const controlSources = [
  "ImageUploadControl.tsx",
  "VideoUploadControl.tsx",
  "AudioUploadControl.tsx",
  "MultiImageUploadWidget.tsx",
].map((fileName) => ({
  fileName,
  source: readFileSync(path.join(controlsDir, fileName), "utf8"),
}));
const hookSource = readFileSync(path.join(controlsDir, "useFileDrop.ts"), "utf8");
const translationsSource = readFileSync(
  path.join(process.cwd(), "src/i18n/translations.ts"),
  "utf8",
);
const workflowTypesSource = readFileSync(
  path.join(process.cwd(), "src/types/workflow.ts"),
  "utf8",
);
const dynamicFormSource = readFileSync(
  path.join(process.cwd(), "src/components/WorkflowForm/DynamicForm.tsx"),
  "utf8",
);

test("every generic media upload control uses the shared drop behavior", () => {
  for (const { fileName, source } of controlSources) {
    assert.match(source, /useFileDrop/, `${fileName} must use the shared file-drop hook`);
    assert.match(source, /\.\.\.dropZoneProps/, `${fileName} must bind the drop-zone handlers`);
    assert.match(source, /uploadDropActive/, `${fileName} must render active drag feedback`);
  }
});

test("future workflow schemas inherit drag-and-drop through an exhaustive media widget map", () => {
  assert.match(workflowTypesSource, /export type MediaUploadField =/);
  assert.match(workflowTypesSource, /export type MediaUploadFieldKind = MediaUploadField\["kind"\]/);
  assert.match(dynamicFormSource, /satisfies Record<MediaUploadFieldKind, WidgetKey>/);
  assert.match(
    dynamicFormSource,
    /if \(isMediaUploadField\(field\)\) return mediaUploadWidgetByFieldKind\[field\.kind\]/,
  );
});

test("file drops suppress browser navigation and preserve single/multiple selection", () => {
  assert.match(hookSource, /onDragEnter: handleDragEnter/);
  assert.match(hookSource, /onDragOver: handleDragOver/);
  assert.match(hookSource, /onDragLeave: handleDragLeave/);
  assert.match(hookSource, /onDrop: handleDrop/);
  assert.match(hookSource, /event\.preventDefault\(\)/);
  assert.match(hookSource, /multiple \? files : files\.slice\(0, 1\)/);
});

test("drop zones provide localized idle and active instructions", () => {
  assert.match(translationsSource, /uploadDropHint: "拖拽文件到此处，或点击选择"/);
  assert.match(translationsSource, /uploadDropActive: "松开即可上传"/);
  assert.match(translationsSource, /uploadDropHint: "Drop a file here, or click to choose"/);
  assert.match(translationsSource, /uploadDropActive: "Release to upload"/);
});
