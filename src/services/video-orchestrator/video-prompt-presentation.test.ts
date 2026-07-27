import assert from "node:assert/strict";
import test from "node:test";

import type { ResolvedVideoImageInputs, VideoImageInput } from "@/services/providers/video-input-contract";
import type { VideoPromptContract } from "./types";
import { compileOrderedSubjectActionPrompt } from "./video-prompt-presentation";

const contract: VideoPromptContract = {
  version: "video-prompt-contract-v1",
  terminalRequirements: [{
    requirementId: "victory",
    priority: "hard",
    observableFact: "The heroine visibly holds the phone in the victorious pose.",
    acceptanceCriteria: "The final stable frames show the approved pose.",
    source: "approved_end_frame",
  }],
  motionSteps: [
    "The heroine raises the phone and turns toward the camera.",
  ],
  preserveRequirements: ["Keep the heroine and phone consistent."],
  forbiddenOutcomes: ["No cut or teleportation."],
  narrativeBoundary: "Do not invent another event.",
  shotIntent: "Show the victory.",
};

test("ordered subject/action prompt uses concrete references without exposing the internal role map", () => {
  const transported: VideoImageInput[] = [{
    id: "start",
    role: "first_frame",
    url: "https://example.com/start.png",
    authority: "reference_only",
    instruction: "Approved opening.",
    allowedUse: ["opening composition"],
    forbiddenUse: [],
    actionRole: "boundary",
  }, {
    id: "end",
    role: "last_frame",
    url: "https://example.com/end.png",
    authority: "reference_only",
    instruction: "Approved ending.",
    allowedUse: ["ending composition"],
    forbiddenUse: [],
    actionRole: "boundary",
  }, {
    id: "heroine",
    role: "character_identity",
    url: "https://example.com/heroine.png",
    authority: "reference_only",
    instruction: "Preserve the heroine.",
    allowedUse: ["face", "hairstyle", "red jacket", "body proportions"],
    forbiddenUse: [],
    entityName: "the heroine in the red jacket",
    actionRole: "actor",
  }, {
    id: "phone",
    role: "product_identity",
    url: "https://example.com/phone.png",
    authority: "reference_only",
    instruction: "Preserve the phone.",
    allowedUse: ["black frame", "rear camera layout"],
    forbiddenUse: [],
    entityName: "the black phone",
    actionRole: "object",
  }, {
    id: "room",
    role: "scene_layout",
    url: "https://example.com/room.png",
    authority: "reference_only",
    instruction: "Preserve the room.",
    allowedUse: ["room layout", "background geometry"],
    forbiddenUse: [],
    entityName: "the game room",
    actionRole: "environment",
  }];
  const resolved: ResolvedVideoImageInputs = {
    transported,
    evaluationOnly: [],
    rejected: [],
    internalReferenceMap: [],
    coverage: {
      requiredAnchorIds: [],
      coveredAnchorIds: [],
      uncoveredHardAnchorIds: [],
    },
    promptRoleMap: "INTERNAL ROLE MAP",
    nativeFirstFrame: false,
    nativeLastFrame: false,
  };

  const prompt = compileOrderedSubjectActionPrompt({
    contract,
    resolvedImages: resolved,
    startState: "The heroine stands in the room.",
  });

  assert.match(prompt, /^MAIN ACTION/);
  assert.match(prompt, /heroine in the red jacket from \[Image 3\]/);
  assert.match(prompt, /black phone from \[Image 4\]/);
  assert.match(prompt, /game room from \[Image 5\]/);
  assert.match(prompt, /target ending state shown in \[Image 2\]/);
  assert.match(prompt, /Preserve the heroine in the red jacket's face/);
  assert.doesNotMatch(prompt, /INTERNAL ROLE MAP|Authority:|Allowed evidence:/);
});
