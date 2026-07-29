import assert from "node:assert/strict";
import test from "node:test";

import { compileAssetImagePromptEn, validateAssetImageContract } from "./asset-image-contract";
import {
  PlayingCardContractConflictError,
  resolvePlayingCardAssetContract,
} from "./playing-card-contract";
import { buildAssetConsistencyReference } from "./project-service";
import type { VideoConsistencyAnchor } from "./types";

function cardAnchor(overrides: Partial<VideoConsistencyAnchor> = {}): VideoConsistencyAnchor {
  return {
    id: "game_cards",
    type: "prop",
    displayNameEn: "Playing Cards",
    descriptionEn: "Reusable playing-card prop.",
    mustStayConsistent: true,
    needsReferenceImage: true,
    assetImageContract: {
      subjectCount: 2,
      subjectDescription: "Ace of Clubs on the left and Ace of Hearts on the right.",
      composition: {
        framing: "full isolated asset sheet",
        cameraAngle: "slight low-angle view",
        placement: "the cards overlap by 20%",
        occupancy: "70% of frame",
      },
      environment: { background: "plain white studio background" },
      lighting: { direction: "soft frontal light", quality: "even studio light" },
      intrinsicDetails: ["Ace of Clubs", "Ace of Hearts"],
      forbiddenElements: ["extra cards", "joker", "hands", "table", "UI"],
      acceptanceCriteria: ["exactly two cards", "both card identities are readable"],
    },
    ...overrides,
  };
}

test("asset contract beats category defaults without concatenating contradictory card identities", () => {
  const resolved = resolvePlayingCardAssetContract({ anchor: cardAnchor() });
  const prompt = compileAssetImagePromptEn(resolved.anchor);

  assert.match(prompt, /Ace of Clubs at left/);
  assert.match(prompt, /Ace of Hearts at right/);
  assert.match(prompt, /overlap by exactly 20%/);
  assert.match(prompt, /low-angle view/);
  assert.doesNotMatch(prompt, /Ace of Spades/);
  assert.doesNotMatch(prompt, /King of Hearts/);
  assert.doesNotMatch(prompt, /no overlap/);
  assert.equal(resolved.playingCards.fieldAuthority?.cards, "asset_contract");
});

test("explicit user requirements override the existing asset contract field by field", () => {
  const resolved = resolvePlayingCardAssetContract({
    anchor: cardAnchor(),
    userPrompt: "Use Ace of Spades and King of Hearts. The cards must have no overlap in a strict top-down orthographic view.",
  });
  const prompt = compileAssetImagePromptEn(resolved.anchor);

  assert.match(prompt, /Ace of Spades at left/);
  assert.match(prompt, /King of Hearts at right/);
  assert.match(prompt, /no overlap/);
  assert.match(prompt, /top-down orthographic/);
  assert.doesNotMatch(prompt, /Ace of Clubs/);
  assert.equal(resolved.playingCards.fieldAuthority?.cards, "user_requirement");
  assert.equal(resolved.playingCards.fieldAuthority?.overlap, "user_requirement");
});

test("confirmed reference facts override a lower-priority asset contract", () => {
  const resolved = resolvePlayingCardAssetContract({
    anchor: cardAnchor({
      sourceEvidence: [{
        source: "reference_fact",
        text: "The approved reference visibly shows Queen of Diamonds and Jack of Clubs with no overlap.",
      }],
    }),
  });
  const prompt = compileAssetImagePromptEn(resolved.anchor);

  assert.match(prompt, /Queen of Diamonds at left/);
  assert.match(prompt, /Jack of Clubs at right/);
  assert.doesNotMatch(prompt, /Ace of Clubs/);
  assert.equal(resolved.playingCards.fieldAuthority?.cards, "reference_fact");
});

test("user edits override an already structured playing-card contract", () => {
  const first = resolvePlayingCardAssetContract({ anchor: cardAnchor() });
  const edited = resolvePlayingCardAssetContract({
    anchor: first.anchor,
    userEditPrompt: "Change the cards to Queen of Spades and 10 of Diamonds, overlapping by 15%.",
  });
  const prompt = compileAssetImagePromptEn(edited.anchor);

  assert.match(prompt, /Queen of Spades at left/);
  assert.match(prompt, /10 of Diamonds at right/);
  assert.match(prompt, /overlap by exactly 15%/);
  assert.doesNotMatch(prompt, /Ace of Clubs/);
  assert.equal(edited.playingCards.fieldAuthority?.cards, "user_edit");
});

test("same-authority overlap contradictions block before image request compilation", () => {
  const base = cardAnchor();
  const anchor = cardAnchor({
    assetImageContract: {
      ...base.assetImageContract!,
      composition: {
        ...base.assetImageContract!.composition,
        placement: "Keep a clear gap with no overlap, but also overlap the cards by 20%.",
      },
    },
  });

  assert.throws(
    () => resolvePlayingCardAssetContract({ anchor }),
    (error) => error instanceof PlayingCardContractConflictError
      && error.conflicts.some((item) => item.field === "overlap"),
  );
  assert.ok(validateAssetImageContract(anchor).some((issue) => issue.field === "playingCards.overlap"));
});

test("final asset reference uses only the resolved canonical contract", () => {
  const reference = buildAssetConsistencyReference({
    item: {
      assetId: "game_cards:single",
      category: "prop",
      view: "single",
      keyframeNo: -1001,
      anchorId: "game_cards",
      required: true,
    },
    anchor: cardAnchor({
      imagePromptEn: "Legacy instruction: Ace of Spades and King of Hearts with no overlap.",
    }),
    userPrompt: "",
    negativePrompt: "",
  });

  assert.match(reference.imagePromptEn ?? "", /Ace of Clubs at left/);
  assert.match(reference.imagePromptEn ?? "", /overlap by exactly 20%/);
  assert.doesNotMatch(reference.imagePromptEn ?? "", /Ace of Spades/);
  assert.doesNotMatch(reference.imagePromptEn ?? "", /King of Hearts/);
  assert.doesNotMatch(reference.negativePromptEn ?? "", /overlapping cards/);
});
