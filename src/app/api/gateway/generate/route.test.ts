import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("gateway checks generation history schema before submitting an upstream task", () => {
  const source = readFileSync("src/app/api/gateway/generate/route.ts", "utf8");
  const schemaCheck = source.indexOf("if (!await generationHistorySchemaReady())");
  const upstreamSubmit = source.indexOf("upstream = await adapter.generate");

  assert.ok(schemaCheck > 0);
  assert.ok(upstreamSubmit > schemaCheck);
  assert.match(source, /providerState: true/);
  assert.match(source, /toolProjectId: true/);
  assert.match(source, /DB_SCHEMA_OUT_OF_SYNC/);
});
