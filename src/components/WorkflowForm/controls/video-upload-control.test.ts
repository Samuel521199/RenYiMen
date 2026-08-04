import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(process.cwd(), "src/components/WorkflowForm/controls/VideoUploadControl.tsx"),
  "utf8",
);
const dynamicFormSource = readFileSync(
  path.join(process.cwd(), "src/components/WorkflowForm/DynamicForm.tsx"),
  "utf8",
);
const imageUploadSource = readFileSync(
  path.join(process.cwd(), "src/components/WorkflowForm/controls/ImageUploadControl.tsx"),
  "utf8",
);
const studioSource = readFileSync(
  path.join(process.cwd(), "src/components/WorkflowForm/WorkflowStudio.tsx"),
  "utf8",
);

test("video upload preview cannot be widened by long filenames or OSS URLs", () => {
  assert.match(source, /min-w-0 max-w-full space-y-3 overflow-hidden/);
  assert.match(source, /h-\[176px\]/);
  assert.match(source, /w-full min-w-0 max-w-full flex-col items-center gap-2 overflow-hidden/);
  assert.match(source, /block w-full min-w-0 truncate text-center/);
  assert.match(dynamicFormSource, /fieldset className="group\/section min-w-0 max-w-full overflow-visible/);
  assert.match(dynamicFormSource, /grid min-w-0 max-w-full grid-cols-1 gap-x-5 gap-y-5 overflow-visible/);
  assert.match(imageUploadSource, /min-w-0 max-w-full space-y-2 overflow-hidden/);
  assert.match(studioSource, /aside className="w-full min-w-0 max-w-full overflow-x-hidden/);
});

test("upload controls hide clear actions and remote storage metadata", () => {
  assert.doesNotMatch(source, /clearImageField|uploadRemoteUrl/);
  assert.doesNotMatch(imageUploadSource, /clearImageField|uploadRemoteUrl|uploadFileName/);
});
