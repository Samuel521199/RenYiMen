import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEndFrameRequirementSupported,
  compileHappyHorseAudioContract,
  compileHappyHorseVideoPrompt,
  compileAliyunVideoPrompt,
  compileWan27VideoPrompt,
  resolveVideoAudioStrategy,
  resolveEndFrameRequirementLevel,
  validateVideoPromptContract,
  videoPromptContractFromUnknown,
} from "./video-terminal-contract.ts";
import type { VideoPromptContract } from "./types.ts";

function completeTestContract(input: {
  terminalState: string;
  motionPath: string;
  preserveRequirements: string[];
  narrativeBoundary: string;
  shotIntent: string;
}): VideoPromptContract {
  return {
    version: "video-prompt-contract-v1",
    terminalRequirements: [{
      requirementId: "terminal.complete_state",
      priority: "hard",
      observableFact: input.terminalState,
      acceptanceCriteria: "The final stable frames visibly satisfy the complete approved terminal state.",
      evidenceRefs: [{ type: "approved_end_frame", id: "keyframe:end" }],
      source: "approved_end_frame",
      sources: ["approved_end_frame"],
    }],
    motionSteps: input.motionPath ? [input.motionPath] : [],
    preserveRequirements: input.preserveRequirements,
    forbiddenOutcomes: [
      "No cut, dissolve, teleportation, scene replacement, pasted still, or inserted freeze-frame.",
      "No subtitles, captions, watermarks, timecodes, random letters, lyrics, or unrequested UI.",
    ],
    narrativeBoundary: input.narrativeBoundary,
    shotIntent: input.shotIntent,
  };
}

test("terminal requirement defaults to semantic and preserves explicit levels", () => {
  assert.equal(resolveEndFrameRequirementLevel({}), "hard_semantic");
  assert.equal(resolveEndFrameRequirementLevel({ end_frame_requirement_level: "hard_exact" }), "hard_exact");
  assert.equal(resolveEndFrameRequirementLevel({ terminalStateControl: "editorial" }), "editorial");
});

test("hard-exact tasks cannot silently route to a first-frame-only provider", () => {
  assert.throws(
    () => assertEndFrameRequirementSupported("hard_exact", {
      acceptsLastFrameImage: false,
      endFrameSemanticMode: "soft_prompt_target",
    }, "happyhorse-1.1-i2v"),
    /native last-frame input|first-frame image/,
  );
  assert.doesNotThrow(() => assertEndFrameRequirementSupported("hard_semantic", {
    acceptsLastFrameImage: false,
    endFrameSemanticMode: "soft_prompt_target",
  }, "happyhorse-1.1-i2v"));
});

test("planner JSON normalizes into a versioned video prompt contract without selecting items", () => {
  const contract = videoPromptContractFromUnknown({
    video_prompt_contract: {
      version: "video-prompt-contract-v1",
      terminal_requirements: [
        {
          requirement_id: "terminal.product_position",
          priority: "hard",
          observable_fact: "The product is beside the face.",
          acceptance_criteria: "The product remains visibly beside the face in the stable tail.",
          source: "approved_end_frame",
        },
      ],
      motion_steps: ["Lift the product continuously.", "Settle beside the face."],
      preserve_requirements: ["Keep the same face and product."],
      forbidden_outcomes: ["Do not cut."],
      narrative_boundary: "Do not invent the next beat.",
      shot_intent: "Show the product result.",
    },
  });
  assert.equal(contract?.terminalRequirements[0]?.requirementId, "terminal.product_position");
  assert.deepEqual(contract?.motionSteps, ["Lift the product continuously.", "Settle beside the face."]);
});

test("typed evidence references deterministically compile provenance without model-authored source", () => {
  const contract = videoPromptContractFromUnknown({
    version: "video-prompt-contract-v1",
    terminal_requirements: [{
      requirement_id: "terminal.result",
      priority: "hard",
      observable_fact: "The approved result is visible.",
      acceptance_criteria: "The final stable frames show it.",
      evidence_refs: [
        { type: "planner_artifact", id: "camera:camera_01" },
        { type: "story_contract", id: "beat:beat_03" },
        { type: "user_input", id: "user_prompt" },
      ],
    }],
    motion_steps: ["Move continuously into the result."],
    preserve_requirements: [],
    forbidden_outcomes: [],
    narrative_boundary: "",
    shot_intent: "",
  });
  assert.equal(contract?.terminalRequirements[0]?.source, "user");
  assert.deepEqual(
    contract?.terminalRequirements[0]?.sources,
    ["user", "story_contract", "planner"],
  );
  assert.equal(contract?.terminalRequirements[0]?.evidenceRefs.length, 3);
});

test("terminal provenance aliases are normalized locally while unknown owners still fail", () => {
  const base = {
    version: "video-prompt-contract-v1",
    terminal_requirements: [{
      requirement_id: "terminal.result",
      priority: "hard",
      observable_fact: "The approved result is visible.",
      acceptance_criteria: "The stable tail shows the approved result.",
      source: "end_frame_contract",
    }],
    motion_steps: ["Move continuously into the result."],
    preserve_requirements: [],
    forbidden_outcomes: [],
    narrative_boundary: "",
    shot_intent: "Reach the approved result.",
  };
  const normalized = videoPromptContractFromUnknown(base);
  assert.equal(normalized?.terminalRequirements[0]?.source, "approved_end_frame");

  const cameraGraphSource = videoPromptContractFromUnknown({
    ...base,
    terminal_requirements: [{
      ...base.terminal_requirements[0],
      source: "camera_graph_camera_01",
    }],
  });
  assert.equal(cameraGraphSource?.terminalRequirements[0]?.source, "planner");

  assert.throws(
    () => videoPromptContractFromUnknown({
      ...base,
      terminal_requirements: [{
        ...base.terminal_requirements[0],
        source: "some_unverifiable_owner",
      }],
    }),
    /some_unverifiable_owner.*invalid/,
  );
});

test("ordinary segment data is not mistaken for a prompt contract and malformed contracts fail loudly", () => {
  assert.equal(videoPromptContractFromUnknown({ segmentNo: 1, durationSeconds: 5 }), undefined);
  assert.throws(
    () => videoPromptContractFromUnknown({
      video_prompt_contract: {
        version: "video-prompt-contract-v1",
        terminal_requirements: [{
          requirement_id: "terminal.product_position",
          observable_fact: "The product is beside the face.",
          acceptance_criteria: "Visible throughout the stable tail.",
          source: "approved_end_frame",
        }],
        motion_steps: ["Lift the product."],
        preserve_requirements: [],
        forbidden_outcomes: [],
      },
    }),
    /priority must be hard or soft/,
  );
});

test("HappyHorse compiler serializes the model contract without truncating, deduplicating, or selecting", () => {
  const contract = completeTestContract({
    terminalState: "The character visibly holds the same product beside the face.",
    motionPath: "The hand lifts the product in one continuous movement.",
    preserveRequirements: ["same face; same product; same room"],
    narrativeBoundary: "Do not invent a reward.",
    shotIntent: "Reveal the product result.",
  });
  const compiled = compileHappyHorseVideoPrompt({
    durationSeconds: 5,
    requirementLevel: "hard_semantic",
    startState: "The approved character begins beside the product.",
    contract,
    retryCorrections: ["product position: finish the lift one second earlier"],
  });
  assert.ok(compiled.prompt.length <= 4200);
  assert.match(compiled.prompt, /REQUIREMENT terminal\.complete_state \[hard\]/);
  assert.match(compiled.prompt, /The character visibly holds the same product beside the face/);
  assert.match(compiled.prompt, /Complete the main action by 3\.5s/);
  assert.match(compiled.prompt, /STRUCTURED RETRY DELTA/);
  assert.equal(compiled.compacted, false);
  assert.deepEqual(compiled.warnings, []);
});

test("compiler states whether the approved last image is a real native model input", () => {
  const contract = completeTestContract({
    terminalState: "The approved terminal composition is visible.",
    motionPath: "Move continuously into the terminal composition.",
    preserveRequirements: [],
    narrativeBoundary: "",
    shotIntent: "",
  });
  const native = compileHappyHorseVideoPrompt({
    durationSeconds: 5,
    requirementLevel: "hard_exact",
    startState: "approved start",
    contract,
    retryCorrections: [],
    lastFrameIsNativeInput: true,
  });
  assert.match(native.prompt, /native LAST_FRAME image input/);
  const semantic = compileHappyHorseVideoPrompt({
    durationSeconds: 5,
    requirementLevel: "hard_semantic",
    startState: "approved start",
    contract,
    retryCorrections: [],
  });
  assert.match(semantic.prompt, /not a native model input/);
});

test("compiler does not label an R2V start reference as a hard native first frame", () => {
  const contract = completeTestContract({
    terminalState: "approved end reference",
    motionPath: "continuous motion",
    preserveRequirements: [],
    narrativeBoundary: "",
    shotIntent: "",
  });
  const compiled = compileHappyHorseVideoPrompt({
    durationSeconds: 5,
    requirementLevel: "hard_semantic",
    startState: "approved start reference",
    contract,
    retryCorrections: [],
    firstFrameIsNativeInput: false,
    lastFrameIsNativeInput: false,
  });
  assert.match(compiled.prompt, /role-labeled reference image/);
  assert.match(compiled.prompt, /APPROVED START REFERENCE TARGET/);
  assert.doesNotMatch(compiled.prompt, /1\. HARD START INPUT/);
});

test("Wan 2.7 compiler uses native boundary semantics and omits HappyHorse R2V instructions", () => {
  const contract = completeTestContract({
    terminalState: "The supplied closing composition is fully visible.",
    motionPath: "The character lowers one hand and continuously turns toward the product.",
    preserveRequirements: ["same character", "same product", "same camera axis"],
    narrativeBoundary: "Do not begin the next scene.",
    shotIntent: "Connect the two approved boundary images.",
  });
  const compiled = compileWan27VideoPrompt({
    modelId: "wan2.7-i2v-2026-04-25",
    durationSeconds: 10,
    requirementLevel: "hard_exact",
    startState: "native opening frame",
    contract,
    retryCorrections: [],
    firstFrameIsNativeInput: true,
    lastFrameIsNativeInput: true,
  });
  assert.match(compiled.prompt, /WAN 2\.7 NATIVE FIRST-LAST FRAME I2V/);
  assert.match(compiled.prompt, /supplied FIRST_FRAME is the exact opening image/);
  assert.match(compiled.prompt, /settle exactly into the supplied LAST_FRAME/);
  assert.doesNotMatch(compiled.prompt, /HAPPYHORSE|role-labeled reference image|Image 1/);
});

test("Aliyun video prompt dispatch preserves HappyHorse and selects Wan 2.7 by model family", () => {
  const contract = completeTestContract({
    terminalState: "approved ending",
    motionPath: "continuous movement",
    preserveRequirements: [],
    narrativeBoundary: "",
    shotIntent: "",
  });
  const common = {
    durationSeconds: 5,
    requirementLevel: "hard_exact" as const,
    startState: "approved opening",
    contract,
    retryCorrections: [],
    firstFrameIsNativeInput: true,
    lastFrameIsNativeInput: true,
  };
  assert.match(
    compileAliyunVideoPrompt({ ...common, modelId: "wan2.7-i2v-2026-04-25" }).prompt,
    /WAN 2\.7 NATIVE FIRST-LAST FRAME I2V/,
  );
  assert.match(
    compileAliyunVideoPrompt({ ...common, modelId: "happyhorse-1.1-i2v" }).prompt,
    /HAPPYHORSE FIRST-FRAME I2V/,
  );
});

test("HappyHorse audio contract defaults to native ambience and forbids accidental speech", () => {
  assert.equal(resolveVideoAudioStrategy(undefined), "native_ambience");
  const contract = compileHappyHorseAudioContract({
    mode: "ambient",
    needsVoiceover: false,
    needsDialogue: false,
    soundEffects: [{
      timingSeconds: 1.2,
      source: "product lid",
      action: "snaps closed",
      description: "a clean close click",
    }],
  }, 5);
  assert.match(contract, /Strategy: native_ambience/);
  assert.match(contract, /synchronized diegetic ambience and action sound effects/);
  assert.match(contract, /At approximately 1\.2s, product lid snaps closed: a clean close click/);
  assert.match(contract, /No dialogue\. No voice-over\. No background music/);
});

test("HappyHorse native-full audio contract carries exact short dialogue and lip sync", () => {
  const contract = compileHappyHorseAudioContract({
    mode: "dialogue",
    strategy: "native_full",
    needsVoiceover: false,
    needsDialogue: true,
    language: "Mandarin Chinese",
    speaker: "woman",
    voiceStyle: "warm and confident",
    exactTextRequired: true,
    lines: ["现在就试试。"],
    backgroundMusic: {
      source: "native",
      style: "light electronic",
      mood: "optimistic",
      intensity: "low",
    },
  }, 5);
  assert.match(contract, /Strategy: native_full/);
  assert.match(contract, /The speaker \(woman\) says exactly: "现在就试试。"/);
  assert.match(contract, /Language: Mandarin Chinese/);
  assert.match(contract, /Synchronize visible mouth movement naturally/);
  assert.match(contract, /Generate background music in a light electronic style with a optimistic mood/);
});

test("post-only audio contract suppresses all provider audio", () => {
  assert.equal(resolveVideoAudioStrategy({
    mode: "silent",
    needsVoiceover: false,
    needsDialogue: false,
  }), "post_only");
  assert.match(
    compileHappyHorseAudioContract({
      mode: "voiceover",
      strategy: "post_only",
      needsVoiceover: true,
      needsDialogue: false,
    }, 5),
    /Do not generate dialogue, voice-over, background music, or intentional sound effects/,
  );
});

test("HappyHorse R2V compiler identifies the audio-capable model and embeds the audio contract", () => {
  const contract = completeTestContract({
    terminalState: "The product remains visible.",
    motionPath: "The character closes the product lid.",
    preserveRequirements: ["same character", "same product"],
    narrativeBoundary: "",
    shotIntent: "Show a satisfying close.",
  });
  const compiled = compileHappyHorseVideoPrompt({
    modelId: "happyhorse-1.1-r2v",
    durationSeconds: 5,
    requirementLevel: "hard_semantic",
    startState: "The character holds the open product.",
    contract,
    retryCorrections: [],
    audioPlan: {
      mode: "ambient",
      strategy: "native_ambience",
      needsVoiceover: false,
      needsDialogue: false,
    },
  });
  assert.match(compiled.prompt, /HAPPYHORSE REFERENCE-TO-VIDEO — VALIDATED MODEL CONTRACT/);
  assert.match(compiled.prompt, /9\. AUDIO CONTRACT/);
  assert.match(compiled.prompt, /Strategy: native_ambience/);
});

test("invalid, duplicate, or over-budget model contracts fail instead of being rewritten", () => {
  const contract = completeTestContract({
    terminalState: "The product is visible.",
    motionPath: "Lift the product.",
    preserveRequirements: ["same face"],
    narrativeBoundary: "",
    shotIntent: "",
  });
  assert.throws(
    () => validateVideoPromptContract({ ...contract, motionSteps: ["Lift the product.", "Lift the product."] }),
    /duplicate motion steps/,
  );
  assert.throws(
    () => compileHappyHorseVideoPrompt({
      durationSeconds: 5,
      requirementLevel: "hard_semantic",
      startState: "start",
      contract: {
        ...contract,
        narrativeBoundary: "x".repeat(5000),
      },
      retryCorrections: [],
    }),
    /exceeding the HappyHorse budget/,
  );
});
