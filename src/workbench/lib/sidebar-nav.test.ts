import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NAV_GROUPS } from "./constants.ts";
import {
  getSidebarChildLinkClasses,
  isSidebarItemActive,
} from "./sidebar-nav.ts";

test("task center workflow children do not define special style flags", () => {
  const taskCenter = NAV_GROUPS.find((item) => item.label === "任务中心");
  assert.ok(taskCenter);
  assert.ok(Array.isArray(taskCenter.children));

  const childKeys = taskCenter.children.map((child) => Object.keys(child).sort());
  assert.deepEqual(childKeys, [
    ["href", "label"],
    ["href", "label"],
    ["href", "label"],
    ["href", "label"],
    ["href", "label"],
    ["href", "label"],
    ["href", "label"],
  ]);
});

test("workflow child links share one text-style class strategy", () => {
  const activeClasses = getSidebarChildLinkClasses(true);
  const inactiveClasses = getSidebarChildLinkClasses(false);

  assert.match(activeClasses, /text-gray-900/);
  assert.doesNotMatch(activeClasses, /bg-gray-900/);
  assert.doesNotMatch(activeClasses, /text-white/);
  assert.doesNotMatch(activeClasses, /font-bold/);

  assert.match(inactiveClasses, /text-gray-500/);
  assert.doesNotMatch(inactiveClasses, /bg-gray-900/);
  assert.doesNotMatch(inactiveClasses, /text-white/);
  assert.doesNotMatch(inactiveClasses, /font-bold/);
});

test("workflow child active detection treats direct paths and nested paths consistently", () => {
  assert.equal(isSidebarItemActive("/workflows", "/workflows"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/expression", "/workbench/workflows/expression"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/expression/history", "/workbench/workflows/expression"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/activity", "/workbench/workflows/activity"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/activity/jobs/1", "/workbench/workflows/activity"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/background", "/workbench/workflows/background"), true);
  assert.equal(isSidebarItemActive("/workbench/workflows/background/review/1", "/workbench/workflows/background"), true);
  assert.equal(isSidebarItemActive("/workbench/admin/activity-templates", "/workbench/workflows/activity"), false);
});

test("sidebar groups match the new dashboard, template, tag, and admin structure", () => {
  const labels = NAV_GROUPS.map((item) => item.label);
  assert.deepEqual(labels, [
    "首页看板",
    "任务中心",
    "模版中心",
    "素材库",
    "标签管理",
    "审核中心",
    "成品图库",
    "统计中心",
    "管理后台",
  ]);

  const templateCenter = NAV_GROUPS.find((item) => item.label === "模版中心");
  assert.ok(templateCenter);
  assert.deepEqual(templateCenter.children, [
    { label: "指令库", href: "/workbench/instructions" },
    { label: "Prompt 模版", href: "/workbench/prompts" },
    { label: "活动图模版", href: "/workbench/admin/activity-templates" },
  ]);

  const tagManagement = NAV_GROUPS.find((item) => item.label === "标签管理");
  assert.ok(tagManagement);
  assert.deepEqual(tagManagement.children, [
    { label: "素材标签管理", href: "/workbench/assets/tags" },
    { label: "成品图标签管理", href: "/workbench/gallery/tags" },
  ]);

  const adminGroup = NAV_GROUPS.find((item) => item.label === "管理后台");
  assert.ok(adminGroup);
  assert.deepEqual(adminGroup.children, [
    { label: "用户管理", href: "/workbench/admin/users" },
    { label: "模型配置", href: "/workbench/admin/models" },
    { label: "系统日志", href: "/workbench/admin/logs" },
  ]);
});

test("task center includes the daily post workflow entry after activity workflows", () => {
  const taskCenter = NAV_GROUPS.find((item) => item.label === "任务中心");
  assert.ok(taskCenter);
  assert.deepEqual(taskCenter.children, [
    { label: "任务列表", href: "/workbench/workflows" },
    { label: "表情制作", href: "/workbench/workflows/expression" },
    { label: "活动图生产", href: "/workbench/workflows/activity" },
    { label: "日常互动图", href: "/workbench/workflows/daily-post" },
    { label: "转发图生产", href: "/workbench/workflows/share" },
    { label: "背景图生成", href: "/workbench/workflows/background" },
    { label: "多图融合", href: "/workbench/workflows/multi-fusion" },
  ]);
});

test("daily post workflow constants expose the supported template types and content enums", () => {
  const source = readFileSync("frontend/lib/constants.ts", "utf8");

  assert.match(source, /DAILY_POST_TEMPLATE_TYPES/);
  assert.match(source, /emotion/);
  assert.match(source, /game/);
  assert.match(source, /choice/);
  assert.match(source, /meme/);
  assert.match(source, /local/);
  assert.match(source, /character/);
  assert.match(source, /DAILY_POST_BULL_ACTIONS/);
  assert.match(source, /happy/);
  assert.match(source, /helpless/);
  assert.match(source, /sweating/);
  assert.match(source, /umbrella/);
  assert.match(source, /payday/);
  assert.match(source, /celebrate/);
  assert.match(source, /DAILY_POST_BACKGROUNDS/);
  assert.match(source, /rain/);
  assert.match(source, /home/);
  assert.match(source, /street/);
  assert.match(source, /jeepney/);
  assert.match(source, /basketball/);
});
