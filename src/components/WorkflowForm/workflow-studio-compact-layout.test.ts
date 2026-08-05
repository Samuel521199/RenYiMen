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
  assert.match(source, /validation\.maxDurationSec/);
  assert.match(source, /field\.maxItems/);
  assert.match(source, /group-hover\/help:visible/);
});

test("embedded task viewer can shrink to the parent panel", () => {
  const source = readFileSync("src/components/TaskStatusViewer/TaskStatusViewer.tsx", "utf8");

  assert.match(source, /compact\?: boolean/);
  assert.match(source, /h-full min-h-\[510px\]/);
  assert.match(source, /lg:min-h-0/);
  assert.match(source, /min-h-0 overflow-y-auto/);
  assert.match(source, /visibleBarPct/);
  assert.match(source, /progressEstimateLabel/);
});
