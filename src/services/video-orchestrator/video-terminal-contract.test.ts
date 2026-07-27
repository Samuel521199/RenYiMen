import assert from "node:assert/strict";
import test from "node:test";

import {
  assertEndFrameRequirementSupported,
  buildLegacyVideoPromptContract,
  compileHappyHorseVideoPrompt,
  resolveEndFrameRequirementLevel,
  validateVideoPromptContract,
  videoPromptContractFromUnknown,
} from "./video-terminal-contract.ts";

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
  const contract = buildLegacyVideoPromptContract({
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
  assert.match(compiled.prompt, /REQUIREMENT legacy\.complete_terminal_state \[hard\]/);
  assert.match(compiled.prompt, /The character visibly holds the same product beside the face/);
  assert.match(compiled.prompt, /Complete the main action by 3\.5s/);
  assert.match(compiled.prompt, /STRUCTURED RETRY DELTA/);
  assert.equal(compiled.compacted, false);
  assert.deepEqual(compiled.warnings, []);
});

test("compiler states whether the approved last image is a real native model input", () => {
  const contract = buildLegacyVideoPromptContract({
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
  const contract = buildLegacyVideoPromptContract({
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

test("invalid, duplicate, or over-budget model contracts fail instead of being rewritten", () => {
  const contract = buildLegacyVideoPromptContract({
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
