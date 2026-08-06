import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NAV_GROUPS } from "./constants.ts";

test("workspace switches remain outside the workspace-specific navigation", () => {
  assert.equal(NAV_GROUPS.some((item) => item.label === "通用型"), false);
  assert.equal(NAV_GROUPS.some((item) => item.label === "运营部"), false);
  assert.equal(NAV_GROUPS.some((item) => item.label === "首页看板"), false);
});

test("top navigation switches between isolated full-width workspace menus", () => {
  const headerSource = readFileSync("src/components/platform/PlatformShell.tsx", "utf8");
  const layoutSource = readFileSync("src/app/(platform)/workbench/layout.tsx", "utf8");
  const topNavSource = readFileSync("src/workbench/components/layout/TopNavigation.tsx", "utf8");

  assert.doesNotMatch(headerSource, /workspaceGeneral/);
  assert.doesNotMatch(headerSource, /workspaceOperations/);
  assert.match(topNavSource, /operations-mega/);
  assert.match(topNavSource, /href="\/workbench\/operations"/);
  assert.ok(
    topNavSource.indexOf("generalLinks[0]") < topNavSource.indexOf("{operationsMegaMenu}"),
    "operations mega menu should be displayed immediately after home",
  );
  assert.match(headerSource, /workbench-top-navigation-root/);
  assert.match(layoutSource, /<WorkbenchTopNavigation \/>/);
  assert.doesNotMatch(layoutSource, /<WorkbenchSidebar \/>/);
  assert.match(topNavSource, /GENERAL_COLUMNS/);
  assert.match(topNavSource, /h-full shrink-0 items-center whitespace-nowrap/);
  assert.match(topNavSource, /relative h-full shrink-0/);
  assert.match(topNavSource, /operationsMenus/);
  assert.match(topNavSource, /w-\[min\(900px,calc\(100vw-3rem\)\)\]/);
  assert.match(topNavSource, /max-h-\[min\(560px,calc\(100vh-8rem\)\)\]/);
  assert.match(topNavSource, /fixed left-1\/2 top-\[calc\(5rem-2px\)\][\s\S]*w-\[min\(1180px,calc\(100vw-3rem\)\)\][\s\S]*-translate-x-1\/2/);
  assert.match(topNavSource, /workbench-creative-menu[^\n]*overflow-x-hidden overflow-y-auto/);
  assert.match(topNavSource, /createPortal/);
});

test("general top navigation exposes the approved catalog sections", () => {
  const topNavSource = readFileSync("src/workbench/components/layout/TopNavigation.tsx", "utf8");

  assert.match(topNavSource, /\/workbench\/tools\?group=video-generation/);
  assert.match(topNavSource, /\/workbench\/tools\?group=favorites/);
  assert.match(topNavSource, /\/workbench\/tools\?group=video-editing/);
  assert.match(topNavSource, /\/workbench\/tools\?group=audio-post/);
  assert.match(topNavSource, /label: "音频", labelEn: "Audio", href: "\/workbench\/tools\?category=audio"/);
  assert.match(topNavSource, /\/workbench\/tools\?category=image/);
  assert.doesNotMatch(topNavSource, /one-prompt-video|一句话成片/);
});
