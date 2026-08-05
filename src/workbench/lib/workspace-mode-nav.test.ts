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
  assert.match(sidebarSource, /TOOL_SECTION_NAV_ITEMS/);
  assert.match(sidebarSource, /getNavItemHref\(item\)/);
});

test("tool section sidebar entries use reliable document navigation", () => {
  const sidebarSource = readFileSync("src/workbench/components/layout/Sidebar.tsx", "utf8");

  assert.match(sidebarSource, /\/workbench\/tools\?group=video-generation/);
  assert.match(sidebarSource, /\/workbench\/tools\?group=video-editing/);
  assert.match(sidebarSource, /\/workbench\/tools\?group=audio-post/);
  assert.match(sidebarSource, /isToolSection\s*\?\s*\(/);
  assert.match(sidebarSource, /navigateWorkbenchToolSection\(href\)/);
  assert.match(sidebarSource, /event\.preventDefault\(\)/);
});
