import assert from "node:assert/strict";
import test from "node:test";

import {
  ReferenceFactsSchema,
  referenceFactContract,
  referenceFactsExample,
  referenceFactsPromptExampleJson,
} from "./reference-fact-contract.ts";
import {
  structuredStageJsonSchema,
  validateStructuredStageValue,
} from "./structured-stage-contract.ts";

test("the exact reference fact example embedded in the prompt passes the same Zod contract", () => {
  const promptExample = JSON.parse(referenceFactsPromptExampleJson);
  assert.deepEqual(promptExample, referenceFactsExample);
  assert.equal(ReferenceFactsSchema.safeParse(promptExample).success, true);
  const result = validateStructuredStageValue(
    referenceFactContract,
    promptExample,
  );
  assert.equal(result.status, "valid");
});

test("a visible spatial layout string is normalized losslessly to one clause", () => {
  const value = structuredClone(referenceFactsExample) as Record<string, any>;
  value.reference_facts[0].spatial_layout = "bull left of the title";
  const result = validateStructuredStageValue(referenceFactContract, value);
  assert.equal(result.status, "valid");
  if (result.status === "valid") {
    assert.deepEqual(result.value.reference_facts[0].spatial_layout, [
      "bull left of the title",
    ]);
  }
});

test("structured visible facts are losslessly normalized without another model call", () => {
  const value = structuredClone(referenceFactsExample) as Record<string, any>;
  value.reference_facts[0].people = [{
    type: "mascot",
    description: "smiling cartoon bull",
  }];
  value.reference_facts[0].objects = [
    { type: "playing_card", rank: "A", suit: "clubs" },
    "green leaves",
  ];
  value.reference_facts[0].brand_marks = "TONGITS KING logo";
  value.global_consistency_facts = [{
    subject: "bull mascot",
    rule: "brown fur and green shirt",
  }];

  const result = validateStructuredStageValue(referenceFactContract, value);
  assert.equal(result.status, "valid");
  if (result.status !== "valid") return;
  assert.deepEqual(result.value.reference_facts[0].people, [
    JSON.stringify({
      type: "mascot",
      description: "smiling cartoon bull",
    }),
  ]);
  assert.deepEqual(result.value.reference_facts[0].objects, [
    JSON.stringify({ type: "playing_card", rank: "A", suit: "clubs" }),
    "green leaves",
  ]);
  assert.deepEqual(result.value.reference_facts[0].brand_marks, [
    "TONGITS KING logo",
  ]);
  assert.deepEqual(result.value.global_consistency_facts, [
    JSON.stringify({
      subject: "bull mascot",
      rule: "brown fur and green shirt",
    }),
  ]);
});

test("invalid confidence and missing fields fail the contract", () => {
  const value = structuredClone(referenceFactsExample) as Record<string, any>;
  value.reference_facts[0].confidence = 1.5;
  delete value.reference_facts[0].objects;
  const result = validateStructuredStageValue(referenceFactContract, value);
  assert.equal(result.status, "repairable");
});

test("unknown fields fail the strict reference fact contract", () => {
  const value = structuredClone(referenceFactsExample) as Record<string, any>;
  value.reference_facts[0].story = "invented action";
  const result = validateStructuredStageValue(referenceFactContract, value);
  assert.equal(result.status, "repairable");
});

test("JSON Schema is generated from the reference fact Zod contract", () => {
  const schema = structuredStageJsonSchema(referenceFactContract);
  const definitions = schema.definitions as Record<string, Record<string, unknown>>;
  assert.equal(definitions.reference_fact_extractor_contract.type, "object");
});
