import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = read("prisma/migrations/20260729032000_record_phase8_order_and_special_recovery/migration.sql");
const script = read("scripts/remediate-phase8-order-special-project.ts");
const dashboard = read("scripts/one-prompt-production-dashboard.ts");

test("Phase 8 order deviation and the deleted special project have durable audit tables", () => {
  assert.match(migration, /video_architecture_migration_audits/);
  assert.match(migration, /video_special_project_recovery_records/);
  assert.match(migration, /planning_restarted/);
  assert.match(migration, /recovery_actions/);
});

test("special project remediation preserves target actions without restarting planning", () => {
  assert.match(script, /cms45bepz0001tv8okj4l1o9w/);
  assert.match(script, /consistency_reference:-1000:image/);
  assert.match(script, /REPAIR_CONTRACT/);
  assert.match(script, /consistency_reference:-1005:image/);
  assert.match(script, /RETRY_QUALITY/);
  assert.match(script, /WAITING_RECOVERY_ARCHIVED/);
  assert.match(script, /planningRestarted: false/);
  assert.match(script, /planningJobsAfter !== 0/);
});

test("migration audit is continuously visible on the production dashboard", () => {
  assert.match(dashboard, /unresolvedMigrationAudits/);
  assert.match(dashboard, /status: \{ notIn: \["completed", "compensated"\] \}/);
});

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}
