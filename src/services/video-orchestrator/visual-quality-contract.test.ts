import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAuthoritativeVisualContract,
  compileAtomicVisualRequirements,
  reconcileGenerationIssueLedger,
  repairNegativePromptAgainstVisualContract,
  repairPromptAgainstVisualContract,
} from "./visual-quality-contract.ts";

test("atomic visual requirements are bounded, stable and preserve explicit hard authority", () => {
  const input = {
    targetContract: {
      requiredVisibleEvidence: [
        "One approved character visibly holds the locked product",
        "The product remains on viewer-right",
      ],
      requiredAnchorIds: ["character_main", "product_main"],
      decorativeLighting: "warm rim light",
    },
    visualContract: {
      version: "visual-contract-v1" as const,
      mediaStage: "static_image" as const,
      sourcePriority: [],
      requiredText: ["BRAND X"],
      allowedText: ["BRAND X"],
      forbiddenText: [],
      exactTextAuthority: "approved_reference" as const,
      allowGameUi: false,
      allowBrandText: true,
      staticRequirements: [],
      deferredVideoChecks: [],
      verifiedConflicts: [],
      warnings: [],
    },
    purpose: "boundary_keyframe" as const,
  };
  const first = compileAtomicVisualRequirements(input);
  const second = compileAtomicVisualRequirements(input);
  assert.deepEqual(second, first);
  assert.ok(first.length <= 12);
  assert.ok(first.some((item) => item.domain === "brand_text" && item.severity === "hard"));
  assert.ok(first.some((item) => item.referenceAnchorIds?.includes("character_main")));
  assert.ok(first.some((item) => item.requirementId.includes("requiredvisibleevidence")));
  assert.equal(first.some((item) => item.target.includes("warm rim light")), false);
});

test("requirement-backed issue identity survives evaluator wording changes", () => {
  const first = reconcileGenerationIssueLedger({
    candidateNo: 1,
    artifactIssues: ["The locked product is absent"],
    correctionActions: [{
      region: "center",
      element: "product",
      observed: "The locked product is absent",
      target: "The character visibly holds the product",
      instruction: "Add the approved product to the character's hand",
      sourceConstraint: "requirement:contract.requiredvisibleevidence.abc123",
    }],
  });
  const second = reconcileGenerationIssueLedger({
    previous: {
      assetId: "keyframe:1:image",
      identityScore: 80,
      layoutScore: 80,
      promptAlignmentScore: 80,
      continuityScore: 80,
      artifactIssues: [],
      passed: false,
      issueLedger: first,
    },
    candidateNo: 2,
    artifactIssues: ["No approved product can be seen in the hand"],
    correctionActions: [{
      region: "center",
      element: "product",
      observed: "No approved product can be seen in the hand",
      target: "The character visibly holds the product",
      instruction: "Place the approved product in the visible hand",
      sourceConstraint: "requirement:contract.requiredvisibleevidence.abc123",
    }],
  });
  const current = second.find((item) => item.requirementId === "contract.requiredvisibleevidence.abc123");
  assert.equal(current?.issueId, first[0]?.issueId);
  assert.equal(current?.occurrenceCount, 2);
  assert.equal(second.filter((item) => item.requirementId === "contract.requiredvisibleevidence.abc123").length, 1);
});

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
