import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("assets page keeps category-based dynamic tag loading for background assets", () => {
  const pageSource = readFileSync("frontend/app/assets/page.tsx", "utf8");

  assert.match(pageSource, /\/api\/assets\/tags\?category=\$\{encodeURIComponent\(nextCategory\)\}/);
  assert.match(pageSource, /background/);
  assert.match(pageSource, /\.map\(\(tag\) => tag\.name\)/);
});

test("assets page displays use counts for background assets", () => {
  const pageSource = readFileSync("frontend/app/assets/page.tsx", "utf8");

  assert.match(pageSource, /asset\.use_count/);
  assert.match(pageSource, /调用/);
});
