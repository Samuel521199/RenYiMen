import assert from "node:assert/strict";
import test from "node:test";

import {
  repairJsonDeterministically,
  validateJsonRepairSemanticPreservation,
} from "./deterministic-json-repair.ts";

const expected = {
  facts: ["alpha", "beta"],
  confidence: 0.9,
  visible: true,
};

const cases: Array<{ name: string; input: string }> = [
  {
    name: "trailing comma",
    input: '{"facts":["alpha","beta"],"confidence":0.9,"visible":true,}',
  },
  {
    name: "missing closing brackets",
    input: '{"facts":["alpha","beta"],"confidence":0.9,"visible":true',
  },
  {
    name: "missing array comma",
    input: '{"facts":["alpha" "beta"],"confidence":0.9,"visible":true}',
  },
  {
    name: "Markdown code fence",
    input: '```json\n{"facts":["alpha","beta"],"confidence":0.9,"visible":true}\n```',
  },
  {
    name: "prose before and after JSON",
    input: 'Here is the JSON:\n{"facts":["alpha","beta"],"confidence":0.9,"visible":true}\nDone.',
  },
  {
    name: "repeated second response",
    input: '{"facts":["alpha","beta"],"confidence":0.9,"visible":true}\n{"facts":["alpha","beta"],"confidence":0.9,"visible":true}',
  },
  {
    name: "illegal control character inside a string",
    input: '{"facts":["alpha","be\u0001ta"],"confidence":0.9,"visible":true}',
  },
];

for (const fixture of cases) {
  test(`repairs ${fixture.name} without changing semantic values`, () => {
    const result = repairJsonDeterministically(fixture.input);
    assert.equal(result.status, "repaired");
    if (result.status !== "repaired") return;
    if (fixture.name === "illegal control character inside a string") {
      assert.deepEqual(result.value, {
        ...expected,
        facts: ["alpha", "be\u0001ta"],
      });
    } else {
      assert.deepEqual(result.value, expected);
    }
    assert.equal(
      result.originalSemanticFingerprint,
      result.repairedSemanticFingerprint,
    );
  });
}

test("rejects a repair that would invent a scalar value", () => {
  const result = repairJsonDeterministically('{"facts":["alpha\\q"]}');
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "semantic_mismatch");
  }
});

test("does not discard a second top-level response with different semantic values", () => {
  const result = repairJsonDeterministically(
    '{"facts":["alpha"]}\n{"facts":["different"]}',
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.reason, "semantic_mismatch");
  }
});

test("accepts model syntax repair only when semantic values are unchanged", () => {
  const result = validateJsonRepairSemanticPreservation(
    '{"name":"hero","score":10,"items":[1 2]}',
    '{"name":"hero","score":10,"items":[1,2]}',
  );
  assert.equal(result.valid, true);
});

test("rejects model syntax repair that adds fields or rewrites scalar values", () => {
  const addedField = validateJsonRepairSemanticPreservation(
    '{"name":"hero","score":10,}',
    '{"name":"hero","score":10,"repair_execution":{}}',
  );
  assert.equal(addedField.valid, false);

  const rewrittenValue = validateJsonRepairSemanticPreservation(
    '{"name":"hero","score":10,}',
    '{"name":"winner","score":11}',
  );
  assert.equal(rewrittenValue.valid, false);

  const duplicatedExistingField = validateJsonRepairSemanticPreservation(
    '{"name":"hero","score":10,}',
    '{"name":"hero","score":10,"name":"hero"}',
  );
  assert.equal(duplicatedExistingField.valid, false);
});

test("accepts removing identical duplicate object fields during model syntax repair", () => {
  const result = validateJsonRepairSemanticPreservation(
    '{"name":"hero","score":10,"global_consistency_facts":[],"global_consistency_facts":[]',
    '{"name":"hero","score":10,"global_consistency_facts":[]}',
  );
  assert.equal(result.valid, true);
});

test("rejects removing a duplicate field when its values differ", () => {
  const result = validateJsonRepairSemanticPreservation(
    '{"name":"hero","status":"draft","status":"approved"}',
    '{"name":"hero","status":"approved"}',
  );
  assert.equal(result.valid, false);
});
