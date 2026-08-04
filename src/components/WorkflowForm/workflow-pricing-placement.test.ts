import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

test("every dynamic-form workflow receives the title pricing action", () => {
  assert.match(source, /headerAction=\{selectedSku \? \(/);
  assert.match(source, /<WorkflowPricing/);
  assert.match(source, /sku=\{selectedSku\}/);
});

test("the old footer price copy is removed", () => {
  const footerStart = source.indexOf("formFooter={");
  const footerEnd = source.indexOf("{/* ── Right", footerStart);
  const footerSource = source.slice(footerStart, footerEnd);

  assert.doesNotMatch(footerSource, /estimateCreditsDynamic/);
  assert.doesNotMatch(footerSource, /estimateCreditsFixed/);
});

test("all pricing buttons reuse the dance-video trigger", () => {
  assert.match(source, /function PriceTrigger/);
  assert.match(source, /<PriceTrigger locale=\{locale\}/);
  assert.match(source, /BAILIAN_S2V_480P_CREDITS_PER_SECOND/);
  assert.match(source, /sku\.sellCredits\.toLocaleString/);
});

test("the standalone one-prompt tool also exposes title pricing", () => {
  const standaloneSource = readFileSync(
    "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx",
    "utf8",
  );

  assert.match(standaloneSource, /<FixedWorkflowPricing/);
  assert.match(standaloneSource, /credits=\{5000\}/);
});
