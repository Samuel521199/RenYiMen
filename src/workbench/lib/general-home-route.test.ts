import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("general workspace entry points target the AI creation studio", () => {
  const shellSource = readFileSync("src/components/platform/PlatformShell.tsx", "utf8");
  const workbenchIndexSource = readFileSync("src/app/(platform)/workbench/page.tsx", "utf8");
  const workbenchLayoutSource = readFileSync("src/app/(platform)/workbench/layout.tsx", "utf8");

  assert.equal((shellSource.match(/href="\/workbench\/tools"/g) ?? []).length, 2);
  assert.match(workbenchIndexSource, /redirect\("\/workbench\/tools"\)/);
  assert.match(workbenchLayoutSource, /callbackUrl=\/workbench\/tools/);
});

test("legacy dashboard and root URLs redirect to the creation studio", () => {
  const middlewareSource = readFileSync("src/middleware.ts", "utf8");

  assert.match(middlewareSource, /pathname === "\/workbench\/dashboard"/);
  assert.match(middlewareSource, /new URL\("\/workbench\/tools"/);
  assert.match(middlewareSource, /pathname === "\/workbench"/);
  assert.match(middlewareSource, /matcher: \["\/", "\/studio", "\/workbench", "\/workbench\/dashboard"\]/);
});
