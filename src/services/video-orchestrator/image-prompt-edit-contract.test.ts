import assert from "node:assert/strict";
import test from "node:test";

import {
  applyImagePromptEditContractToAssetContract,
  compileImagePromptDisplay,
  compileImagePromptForProvider,
  createImagePromptEditContract,
  normalizeImagePromptEditContract,
  updateLocalizedImagePromptDescription,
} from "./image-prompt-edit-contract";

test("localized editing updates the single contract and changes the provider prompt", () => {
  const initial = createImagePromptEditContract({
    imagePromptZh: "正面站立的卡通牛角色",
    imagePromptEn: "A front-facing cartoon bull.",
  });
  const updated = updateLocalizedImagePromptDescription(initial, "zh", "卡通牛角色全身正面站立，双手自然下垂");
  assert.equal(compileImagePromptDisplay(updated, "zh"), "卡通牛角色全身正面站立，双手自然下垂");
  assert.match(compileImagePromptForProvider(updated), /卡通牛角色全身正面站立/);
  assert.match(compileImagePromptForProvider(updated), /IMAGE_GENERATION_CONTRACT_JSON/);
});

test("advanced JSON edits and localized form read the same normalized contract", () => {
  const normalized = normalizeImagePromptEditContract({
    version: "image-prompt-edit-v1",
    lastEditedLocale: "en",
    localizedDescription: { zh: "纯色背景", en: "Solid background" },
    subject: { count: 1, descriptionZh: "一个角色", descriptionEn: "one character" },
    composition: { framing: "full_body", cameraAngle: "front", placement: "center", occupancy: "80%" },
    environment: { backgroundZh: "纯色", backgroundEn: "solid", foreground: "", midground: "", backgroundLayer: "", spatialRelationships: [] },
    lighting: { direction: "front-left", quality: "soft", colorTemperature: "5200K" },
    palette: [],
    materialDetails: [],
    intrinsicDetails: [],
    forbiddenElements: ["duplicate"],
    acceptanceCriteria: ["one subject"],
    creativeOverride: { zh: "", en: "" },
  });
  assert.equal(compileImagePromptDisplay(normalized, "en"), "Solid background");
  assert.match(compileImagePromptForProvider(normalized), /\"framing\":\"full_body\"/);
});

test("asset contract follows edits without losing its rendering-style lock", () => {
  const contract = createImagePromptEditContract({
    imagePromptZh: "红色产品正面图",
    imagePromptEn: "Front view of the red product",
    locale: "zh",
  });
  contract.subject.descriptionZh = "红色产品";
  contract.subject.count = 1;
  contract.composition.framing = "近景";

  const asset = applyImagePromptEditContractToAssetContract(contract, {
    renderingStyle: {
      medium: "stylized 3D CGI",
      dimensionality: "3d",
    },
  });

  assert.equal(asset.subjectDescription, "红色产品");
  assert.equal(asset.subjectCount, 1);
  assert.equal(asset.composition?.framing, "近景");
  assert.equal(asset.renderingStyle?.medium, "stylized 3D CGI");
});
