import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBytesAsGib,
  formatDiskUsageSummary,
  getDiskUsageLevel,
} from "./disk-usage.ts";
import {
  readLocalDiskUsage,
  readWorkbenchBackendDiskUsage,
} from "./disk-usage-server.ts";

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

test("backend connection failures fall back to local disk usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    assert.equal(await readWorkbenchBackendDiskUsage("http://localhost:8000"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("malformed backend responses fall back to local disk usage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{invalid json", { status: 200 })) as typeof fetch;
  try {
    assert.equal(await readWorkbenchBackendDiskUsage("http://localhost:8000"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local disk usage probe returns a valid capacity", async () => {
  const payload = await readLocalDiskUsage(process.cwd());
  assert.ok(payload.total_bytes > 0);
  assert.ok(payload.free_bytes >= 0);
  assert.ok(payload.used_percent >= 0 && payload.used_percent <= 100);
});
