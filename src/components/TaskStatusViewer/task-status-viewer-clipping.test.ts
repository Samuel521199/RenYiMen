import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("active task layers reset stale scroll positions", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/TaskStatusViewer/TaskStatusViewer.tsx"),
    "utf8",
  );

  assert.match(source, /querySelector<HTMLElement>\('\[aria-hidden="false"\]'\)/);
  assert.match(source, /activeLayer\.scrollTop = 0/);
  assert.match(source, /\[justify-content:safe_center\]/);
});

test("the result viewer host passes its full flex height to the stage", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/WorkflowForm/WorkflowStudio.tsx"),
    "utf8",
  );

  assert.match(source, /className="flex min-h-0 flex-1 flex-col overflow-hidden">\s*<TaskStatusViewer/);
  assert.match(source, /lg:h-full lg:flex-1/);
});

test("success results omit the redundant status heading and hide the scrollbar until hover", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/TaskStatusViewer/TaskStatusViewer.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, />\{tt\.successLabel\}<\/p>/);
  assert.doesNotMatch(source, /\{resultHeadline\}/);
  assert.match(source, /hover-reveal-scrollbar absolute inset-0/);
});
