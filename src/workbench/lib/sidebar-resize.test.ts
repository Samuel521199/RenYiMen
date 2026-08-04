import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("workbench sidebar supports persistent pointer and keyboard resizing", () => {
  const source = readFileSync("src/workbench/components/layout/Sidebar.tsx", "utf8");

  assert.match(source, /SIDEBAR_WIDTH_STORAGE_KEY/);
  assert.match(source, /onPointerDown=\{handleResizePointerDown\}/);
  assert.match(source, /onPointerMove=\{handleResizePointerMove\}/);
  assert.match(source, /role="separator"/);
  assert.match(source, /aria-valuenow=\{sidebarWidth\}/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /onDoubleClick/);
  assert.match(source, /style=\{\{ width: sidebarWidth \}\}/);
});
