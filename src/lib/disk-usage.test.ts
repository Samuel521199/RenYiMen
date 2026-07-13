import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBytesAsGib,
  formatDiskUsageSummary,
  getDiskUsageLevel,
} from "./disk-usage.ts";

test("formatBytesAsGib formats gibibytes", () => {
  assert.equal(formatBytesAsGib(1024 ** 3 * 31), "31G");
  assert.equal(formatBytesAsGib(1024 ** 3 * 148), "148G");
});

test("getDiskUsageLevel applies warning thresholds", () => {
  assert.equal(getDiskUsageLevel(79), "normal");
  assert.equal(getDiskUsageLevel(80), "warning");
  assert.equal(getDiskUsageLevel(90), "critical");
});

test("formatDiskUsageSummary renders free/total summary", () => {
  const summary = formatDiskUsageSummary({
    path: "/storage",
    total_bytes: 148 * 1024 ** 3,
    used_bytes: 111 * 1024 ** 3,
    free_bytes: 31 * 1024 ** 3,
    used_percent: 79,
  });
  assert.match(summary, /31G \/ 148G \(79%\)/);
});
