import assert from "node:assert/strict";
import test from "node:test";
import {
  compactPersonCharacterState,
  compactPersonReferenceUsageNote,
  compilePersonCompositionPrompt,
  compilePersonIdentityLock,
  normalizePersonReferenceUsageNotes,
} from "./person-image-prompt-ownership";
import type { VideoConsistencyAnchor } from "./types";
import {
  buildAliyunReferenceImageMap,
  fitAliyunImagePromptWithReport,
} from "./aliyun-workflow";

const bull: VideoConsistencyAnchor = {
  id: "bull_character",
  type: "person",
  mustStayConsistent: true,
  needsReferenceImage: true,
  visualLock: {
    shape: "compact rounded bull",
    material: "soft modeled fur and fabric",
    color: "warm brown",
    markings: "white horns",
    scale: "hero scale",
    state: "neutral",
    forbiddenDrift: ["flat 2D"],
  },
  assetImageContract: {
    subjectCount: 1,
    subjectDescription: "Bull wearing the complete locked costume",
    composition: {
      framing: "full body",
      cameraAngle: "front eye-level",
      placement: "centered",
      occupancy: "75 percent of frame height",
    },
    environment: { background: "pure white studio background" },
    lighting: { direction: "soft frontal light", quality: "dimensional" },
    renderingStyle: {
      medium: "stylized 3D CGI",
      dimensionality: "3d",
      forbiddenDrift: ["flat 2D"],
    },
    palette: ["brown", "blue", "red"],
    materialDetails: ["fur", "fabric"],
    intrinsicDetails: [
      "brown cowboy hat",
      "blue vest with yellow trim",
      "red neckerchief",
      "white horns",
      "gold circular medallion",
    ],
  },
};

test("person reference note declares authority without re-enumerating identity", () => {
  const note = compactPersonReferenceUsageNote("bull_character");
  assert.match(note, /Authoritative for identity and rendering style only/);
  assert.doesNotMatch(note, /face design|horn geometry|body proportions|clothing|materials/);
});

test("legacy verbose person authority notes are replaced instead of accumulated", () => {
  const notes = normalizePersonReferenceUsageNotes([
    "HARD IDENTITY + HARD RENDERING STYLE reference for person asset bull_character. Copy face, horns, clothing, materials and proportions.",
    "AUTHORITATIVE ANCHOR CONTRACTS — repeat every identity fact",
    "STYLE-ONLY reference for palette",
  ], "bull_character");
  assert.equal(notes.length, 2);
  assert.equal(notes.filter((note) => /HARD IDENTITY \+ HARD RENDERING STYLE/.test(note)).length, 1);
  assert.match(notes.join("\n"), /STYLE-ONLY reference for palette/);
  assert.doesNotMatch(notes.join("\n"), /Copy face|repeat every identity fact/);
});

test("person character state keeps target state and removes stable identity repeats", () => {
  const state = compactPersonCharacterState(
    "Full-body character reference, exact front view, standing neutral pose, face clearly visible, same outfit, hairstyle, body proportions, and accessories",
    "front",
  );
  assert.match(state, /exact front view/);
  assert.match(state, /standing neutral pose/);
  assert.match(state, /face clearly visible/);
  assert.doesNotMatch(state, /same outfit|hairstyle|body proportions|accessories/);
});

test("person composition prompt excludes identity and rendering fields", () => {
  const prompt = compilePersonCompositionPrompt(bull.assetImageContract, "legacy full identity prompt", "full-body neutral pose");
  assert.match(prompt, /framing=full body/);
  assert.match(prompt, /background=pure white studio background/);
  assert.match(prompt, /lighting=soft frontal light, dimensional/);
  assert.doesNotMatch(prompt, /cowboy hat|vest|neckerchief|rendering|palette|material/);
});

test("explicit target framing overrides a conflicting legacy composition framing", () => {
  const prompt = compilePersonCompositionPrompt({
    ...bull.assetImageContract,
    composition: { ...bull.assetImageContract?.composition, framing: "medium close-up" },
  }, "", "Full-body character reference, standing neutral pose");
  assert.match(prompt, /framing=Full body/i);
  assert.doesNotMatch(prompt, /medium close-up/i);
});

test("person identity lock is the concise visible-feature source", () => {
  const lock = compilePersonIdentityLock(bull);
  assert.match(lock, /brown cowboy hat/);
  assert.match(lock, /gold circular medallion/);
  assert.doesNotMatch(lock, /soft modeled fur|hero scale|neutral|flat 2D|stylized 3D/);
});

test("representative person asset prompt stays below the soft provider budget without duplicated identity contracts", () => {
  const usageNote = compactPersonReferenceUsageNote(bull.id);
  const state = compactPersonCharacterState(
    "Full-body character reference, exact front view, standing neutral pose, face clearly visible, same outfit, body proportions, and accessories",
    "front",
  );
  const composition = compilePersonCompositionPrompt(bull.assetImageContract, "", state);
  const identity = compilePersonIdentityLock(bull);
  const prompt = [
    buildAliyunReferenceImageMap(["https://example.com/bull.png"], [usageNote]),
    "IMAGE PROMPT COMPILED FROM STRUCTURED CONTRACT",
    "Create one reusable still consistency reference image.",
    "Frame contract:",
    "- target: consistency_reference:-1000",
    "- asset_category: person",
    "- asset_view: front",
    "- output_scope: isolated_asset",
    `- character_state: ${state}`,
    `- source_image_prompt: ${composition}`,
    `Identity lock (sole textual identity source): ${identity}`,
    "Execution rules:",
    "- The source_image_prompt is authoritative for subject count, pose, framing, and background; other sections only add facts absent from it.",
    "- Output exactly one clean still in the requested view.",
    "- Isolation: exactly one character; plain white or light-neutral background; no text, logo, UI, scenery, or other characters.",
  ].join("\n");
  const report = fitAliyunImagePromptWithReport(prompt);
  assert.ok(report.originalLength < 4200);
  assert.equal(report.compacted, false);
  assert.equal(report.omittedCriticalUnits, 0);
  assert.equal((prompt.match(/brown cowboy hat/g) ?? []).length, 1);
  assert.doesNotMatch(prompt, /rendering_style:\s*\{|same outfit|same body proportions|same accessories/);
});
