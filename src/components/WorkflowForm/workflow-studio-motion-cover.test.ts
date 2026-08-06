import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const studio = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");
const catalog = readFileSync("src/app/api/skus/route.ts", "utf8");
const skuTypes = readFileSync("src/types/sku-catalog.ts", "utf8");
const generator = readFileSync("scripts/generate-workflow-motion-covers.ts", "utf8");

test("gallery supports optional muted looping motion covers with static fallback", () => {
  assert.match(skuTypes, /coverVideo\?: string/);
  assert.match(studio, /sku\.coverVideo/);
  assert.match(studio, /autoPlay/);
  assert.match(studio, /muted/);
  assert.match(studio, /loop/);
  assert.match(studio, /playsInline/);
  assert.match(studio, /poster=\{sku\.cover\}/);
  assert.match(studio, /onCanPlay/);
  assert.match(studio, /onMouseEnter/);
});

test("workflow metadata is revealed on hover, focus, and touch-only devices", () => {
  assert.match(studio, /const priceLabel =/);
  assert.match(studio, /group-hover:opacity-100/);
  assert.match(studio, /group-focus-within:opacity-100/);
  assert.match(studio, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(studio, /\{priceLabel\}/);
  assert.match(studio, /\{desc\}/);
  assert.doesNotMatch(studio, /\{\/\* Bottom bar \*\/\}/);
});

test("every catalog workflow has a matching semantic motion cover", () => {
  const skuCount = (catalog.match(/\bskuId:/g) ?? []).length;
  const coverPairs = [...catalog.matchAll(/cover: "\/covers\/([^"]+)",\s+coverVideo: "\/covers\/([^"]+)"/g)];

  assert.equal(skuCount, 31);
  assert.equal(coverPairs.length, skuCount);
  for (const pair of coverPairs) {
    assert.match(pair[2], /-motion\.mp4$/);
    assert.equal(existsSync(`public/covers/${pair[2]}`), true);
  }
});

test("batch generation uses Alibaba Model Studio HappyHorse instead of Kling", () => {
  assert.equal((generator.match(/\bcoverFile: "/g) ?? []).length, 31);
  assert.match(generator, /new BailianAdapter\(\)/);
  assert.match(generator, /happyhorse-1\.1-i2v/);
  assert.doesNotMatch(generator, /providers\/KlingAdapter/);
});
