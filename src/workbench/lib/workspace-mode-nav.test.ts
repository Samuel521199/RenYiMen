import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NAV_GROUPS } from "./constants.ts";

test("general and operations entries are removed from the sidebar", () => {
  assert.equal(NAV_GROUPS.some((item) => item.label === "通用型"), false);
  assert.equal(NAV_GROUPS.some((item) => item.label === "运营部"), false);
  assert.equal(NAV_GROUPS.some((item) => item.label === "首页看板"), false);
});

test("top navigation switches between isolated sidebar menus", () => {
  const headerSource = readFileSync("src/components/platform/PlatformShell.tsx", "utf8");
  const sidebarSource = readFileSync("src/workbench/components/layout/Sidebar.tsx", "utf8");

  assert.match(headerSource, /href="\/workbench\/tools"/);
  assert.match(headerSource, /href="\/workbench\/operations"/);
  assert.match(headerSource, /workspaceGeneral/);
  assert.match(headerSource, /workspaceOperations/);
  assert.match(sidebarSource, /isGeneralWorkspace/);
  assert.match(sidebarSource, /item\.href === "\/workbench\/tools"/);
  assert.match(sidebarSource, /item\.href !== "\/workbench\/tools"/);
});
