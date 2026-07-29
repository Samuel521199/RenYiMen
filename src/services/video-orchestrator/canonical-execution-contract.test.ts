import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_EXECUTION_CONTRACT_VERSION,
  CanonicalExecutionContractError,
  createCanonicalExecutionContractV2,
  providerPromptFromExecutionContract,
} from "./canonical-execution-contract.ts";

test("canonical execution contract is English and versioned", () => {
  const contract = createCanonicalExecutionContractV2({
    targetId: "keyframe-1",
    artifactId: "keyframe:1:image",
    revision: 3,
    prompt: "One mascot stands centered in a clean studio.",
    negativePrompt: "watermark, random text",
    constraints: { subjectCount: 1 },
    references: [{ url: "https://example.com/reference.png", role: "identity" }],
    displayZh: { prompt: "一只吉祥物居中站在干净的摄影棚内。" },
  });
  assert.equal(contract.schemaVersion, CANONICAL_EXECUTION_CONTRACT_VERSION);
  assert.equal(contract.language, "en");
  assert.equal(providerPromptFromExecutionContract(contract), contract.prompt);
  assert.equal(contract.display?.zh?.prompt, "一只吉祥物居中站在干净的摄影棚内。");
});

test("Chinese display copy cannot enter the canonical provider prompt", () => {
  assert.throws(
    () => createCanonicalExecutionContractV2({
      targetId: "keyframe-1",
      artifactId: "keyframe:1:image",
      revision: 1,
      prompt: "一只吉祥物居中站立。",
    }),
    (error) => error instanceof CanonicalExecutionContractError
      && error.code === "EXECUTION_CONTRACT_INVALID",
  );
});

test("editing display.zh cannot change the provider prompt", () => {
  const first = createCanonicalExecutionContractV2({
    targetId: "segment-1",
    artifactId: "segment:1:video",
    revision: 1,
    prompt: "The mascot walks from the left mark to the center mark.",
    displayZh: { prompt: "吉祥物从左侧走到中央。" },
  });
  const edited = {
    ...first,
    display: { zh: { prompt: "用户修改后的中文展示文案。" } },
  };
  assert.equal(providerPromptFromExecutionContract(edited), first.prompt);
});
