import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthoritativeVisualContract,
  reconcileGenerationIssueLedger,
  repairNegativePromptAgainstVisualContract,
  repairPromptAgainstVisualContract,
} from "./visual-quality-contract.ts";

test("game-ad contract preserves authorized brand text and UI while narrowing generic bans", () => {
  const contract = buildAuthoritativeVisualContract({
    targetContract: { usesConsistencyAnchors: ["game_logo", "game_interface"], productState: "得分数字快速跳动" },
    anchorContractText: "anchor_id=game_logo; type=brand_visual; ‘COLOR BLITZ SOCIAL’; game_interface; 计时器、得分数字",
    prompt: "展示游戏LOGO与游戏界面，无文字无UI无水印",
    negativePrompt: "text, UI elements, watermark, gibberish, 文字, UI元素",
    mediaStage: "static_image",
    hasApprovedReferences: true,
  });
  assert.equal(contract.allowBrandText, true);
  assert.equal(contract.allowGameUi, true);
  assert.equal(contract.exactTextAuthority, "approved_reference");
  assert.deepEqual(contract.requiredText, ["COLOR BLITZ SOCIAL"]);
  assert.ok(contract.deferredVideoChecks.some((item) => item.includes("快速跳动")));
  assert.match(repairPromptAgainstVisualContract("展示游戏LOGO，无文字无UI无水印", contract), /权威品牌文字/);
  const negative = repairNegativePromptAgainstVisualContract("text, UI elements, watermark, gibberish, 文字, UI元素", contract);
  assert.doesNotMatch(negative, /(?:^|, )text(?:,|$)|UI elements|文字|UI元素/i);
  assert.match(negative, /watermark/);
  assert.match(negative, /gibberish/);
});

test("issue ledger closes prior issues and defers motion-only still checks", () => {
  const previous = {
    issueLedger: [{
      issueId: "issue_hand",
      fingerprint: "anatomy:hand",
      category: "anatomy" as const,
      summary: "right hand fingers overlap",
      severity: "soft" as const,
      applicableStage: "static_image" as const,
      status: "open" as const,
      firstSeenCandidateNo: 1,
      lastSeenCandidateNo: 1,
      occurrenceCount: 1,
    }],
  };
  const ledger = reconcileGenerationIssueLedger({
    previous: previous as never,
    candidateNo: 2,
    artifactIssues: ["Timer is static and lacks animation"],
    correctionActions: [],
  });
  assert.equal(ledger.find((item) => item.issueId === "issue_hand")?.status, "resolved");
  const timer = ledger.find((item) => item.category === "game_ui");
  assert.equal(timer?.status, "invalid_for_stage");
  assert.equal(timer?.applicableStage, "video");
});
