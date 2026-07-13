import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_PAGE_SHELL_CLASS,
  ACTIVITY_SECTION_CARD_CLASS,
  ACTIVITY_STEP_RAIL_CLASS,
  getActivityStepCardClasses,
  getActivityTemplateTypeTabClasses,
} from "./activity-workflow-theme.ts";

test("activity workflow shell inherits the global light page background", () => {
  assert.equal(ACTIVITY_PAGE_SHELL_CLASS, "text-gray-900");
  assert.doesNotMatch(ACTIVITY_PAGE_SHELL_CLASS, /bg-black/);
  assert.doesNotMatch(ACTIVITY_PAGE_SHELL_CLASS, /bg-gray-900/);
  assert.doesNotMatch(ACTIVITY_PAGE_SHELL_CLASS, /min-h-screen/);
});

test("activity workflow step rail and section cards share light card styling", () => {
  assert.match(ACTIVITY_STEP_RAIL_CLASS, /border-gray-200/);
  assert.match(ACTIVITY_STEP_RAIL_CLASS, /bg-white/);
  assert.match(ACTIVITY_SECTION_CARD_CLASS, /border-gray-200/);
  assert.match(ACTIVITY_SECTION_CARD_CLASS, /bg-white/);
});

test("activity workflow active and inactive step cards use light page states", () => {
  const active = getActivityStepCardClasses({ active: true, finished: false, clickable: true });
  const finished = getActivityStepCardClasses({ active: false, finished: true, clickable: true });
  const idle = getActivityStepCardClasses({ active: false, finished: false, clickable: false });

  assert.match(active, /border-emerald-500/);
  assert.match(active, /bg-emerald-500/);
  assert.match(active, /text-white/);
  assert.doesNotMatch(active, /bg-black/);

  assert.match(finished, /border-emerald-200/);
  assert.match(finished, /bg-emerald-50/);
  assert.match(finished, /text-emerald-700/);

  assert.match(idle, /border-gray-200/);
  assert.match(idle, /bg-white/);
  assert.match(idle, /text-gray-400/);
});

test("activity template type tabs use the same light button family", () => {
  const active = getActivityTemplateTypeTabClasses(true);
  const inactive = getActivityTemplateTypeTabClasses(false);

  assert.match(active, /border-emerald-500/);
  assert.match(active, /bg-emerald-500/);
  assert.match(active, /text-white/);
  assert.match(inactive, /border-gray-200/);
  assert.match(inactive, /bg-white/);
  assert.match(inactive, /text-gray-600/);
  assert.doesNotMatch(inactive, /bg-black/);
});
