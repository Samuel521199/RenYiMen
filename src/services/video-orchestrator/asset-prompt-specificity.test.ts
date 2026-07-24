import assert from "node:assert/strict";
import test from "node:test";
import {
  assetSubjectPromptInstruction,
  buildAssetConsistencyReference,
  resolveImageTargetDependencyScope,
} from "./project-service.ts";
import { buildAuthoritativeVisualContract } from "./visual-quality-contract.ts";
import type { VideoConsistencyAnchor } from "./types.ts";

const playingCards = {
  id: "game_cards",
  type: "prop",
  displayNameZh: "扑克牌",
  displayNameEn: "Playing Cards",
  descriptionZh: "标准扑克牌，卡通风格，可见 A 与 K。",
  descriptionEn: "Standard cartoon playing cards with visible A and K.",
} as VideoConsistencyAnchor;

test("playing-card asset prompt fixes count, rank, suit, orientation, and layout", () => {
  const prompt = assetSubjectPromptInstruction(playingCards, "prop", "zh");
  assert.match(prompt, /严格只显示两张/);
  assert.match(prompt, /左侧黑桃 A/);
  assert.match(prompt, /右侧红桃 K/);
  assert.match(prompt, /正上方无透视俯视/);
  assert.match(prompt, /不得重叠/);
  assert.match(prompt, /左上角和右下角必须显示完全一致/);
  assert.match(prompt, /禁止出现第三张牌/);
});

test("intrinsic card markings are explicitly distinguished from random text", () => {
  const zh = assetSubjectPromptInstruction(playingCards, "prop", "zh");
  const en = assetSubjectPromptInstruction(playingCards, "prop", "en");
  assert.match(zh, /牌面固有标记，不属于随机文字/);
  assert.match(en, /mandatory intrinsic markings, not incidental text/);
  assert.match(en, /Ace of Spades on the left and King of Hearts on the right/);
});

test("ordinary props do not receive playing-card-specific requirements", () => {
  const chip = {
    ...playingCards,
    id: "poker_chips",
    displayNameZh: "筹码",
    displayNameEn: "Poker Chips",
    descriptionZh: "圆形彩色筹码",
    descriptionEn: "Round colored chips",
  } as VideoConsistencyAnchor;
  assert.equal(assetSubjectPromptInstruction(chip, "prop", "zh"), "");
});

test("isolated asset dependency scope ignores global story anchors", () => {
  const plan = {
    consistencyManifest: {
      anchors: [
        { id: "hero_bull", type: "person" },
        { id: "opponent_bull", type: "person" },
        { id: "card_table_scene", type: "location" },
        { id: "game_cards", type: "prop" },
      ],
    },
  };
  const target = {
    anchorId: "opponent_bull",
    assetCategory: "person",
    assetView: "front",
    effectiveRequiredAnchorIds: ["hero_bull", "opponent_bull", "card_table_scene", "game_cards"],
  };
  const scope = resolveImageTargetDependencyScope(plan as never, target, -1003);
  assert.deepEqual(scope.requiredAnchorIds, ["opponent_bull"]);
  assert.deepEqual(scope.forbiddenAnchorIds, ["hero_bull", "card_table_scene", "game_cards"]);
  assert.equal(scope.targetAnchorId, "opponent_bull");
  assert.equal(scope.isolatedAsset, true);
});

test("asset reference compiler does not inherit unrelated base-reference state", () => {
  const baseReference = {
    kind: "character",
    needed: true,
    keyframeNo: -1,
    purpose: "legacy",
    scene: "beach card table",
    characterState: "hero bull and opponent bull seated together",
    productState: "cards and chips visible",
    imagePrompt: "legacy scene",
    negativePrompt: "",
  } as const;
  const person = buildAssetConsistencyReference({
    item: {
      assetId: "opponent_bull:front",
      category: "person",
      view: "front",
      keyframeNo: -1003,
      anchorId: "opponent_bull",
      required: true,
    },
    anchor: {
      id: "opponent_bull",
      type: "person",
      mustStayConsistent: true,
      needsReferenceImage: true,
      descriptionEn: "One opponent bull.",
    },
    baseReference: baseReference as never,
    userPrompt: "game ad",
    negativePrompt: "",
  });
  assert.equal(person.scene, "plain white or light neutral asset-library background");
  assert.equal(person.productState, "");
  assert.match(person.characterState, /opponent_bull:front/);

  const prop = buildAssetConsistencyReference({
    item: {
      assetId: "poker_chips:single",
      category: "prop",
      view: "single",
      keyframeNo: -1008,
      anchorId: "poker_chips",
      required: true,
    },
    anchor: {
      id: "poker_chips",
      type: "prop",
      mustStayConsistent: true,
      needsReferenceImage: true,
      descriptionEn: "Bright cartoon poker chips.",
    },
    baseReference: baseReference as never,
    userPrompt: "game ad",
    negativePrompt: "",
  });
  assert.equal(prop.characterState, "");
  assert.equal(prop.scene, "plain white or light neutral asset-library background");
});

test("isolated props preserve intrinsic markings without enabling full game UI", () => {
  const contract = buildAuthoritativeVisualContract({
    targetContract: {
      isolationMode: "single_asset",
      assetCategory: "prop",
      imagePrompt: "Two playing cards with visible A and K on a plain white background; no UI.",
    },
    prompt: "Render only the two cards. No HUD, logo, title, score, or interface.",
    negativePrompt: "game UI, HUD, title, logo",
    mediaStage: "static_image",
    hasApprovedReferences: false,
  });
  assert.equal(contract.allowGameUi, false);
});
