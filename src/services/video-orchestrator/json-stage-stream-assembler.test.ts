import assert from "node:assert/strict";
import test from "node:test";

import { JsonStageStreamAssembler } from "./json-stage-stream-assembler.ts";

test("cumulative message snapshots append only the new suffix", () => {
  const assembler = new JsonStageStreamAssembler();
  assembler.append({ choiceIndex: 0, messageContent: "{" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]}" });

  assert.equal(assembler.content(), "{\"facts\":[]}");
  assert.equal(assembler.metrics().contentMode, "cumulative");
  assert.equal(assembler.metrics().cumulativeDivergenceCount, 0);
});

test("duplicate and older cumulative snapshots do not duplicate the answer", () => {
  const assembler = new JsonStageStreamAssembler();
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]}" });

  assert.equal(assembler.content(), "{\"facts\":[]}");
  assert.equal(assembler.metrics().duplicateCumulativeSnapshotCount, 1);
  assert.equal(assembler.metrics().cumulativeRegressionCount, 1);
});

test("standard delta pieces remain incremental and repeated tokens are observed, not removed", () => {
  const assembler = new JsonStageStreamAssembler();
  assembler.append({ choiceIndex: 0, deltaContent: "{\"facts\":[" });
  assembler.append({ choiceIndex: 0, deltaContent: "]" });
  assembler.append({ choiceIndex: 0, deltaContent: "]" });

  assert.equal(assembler.content(), "{\"facts\":[]]");
  assert.equal(assembler.metrics().contentMode, "delta");
  assert.equal(assembler.metrics().consecutiveDuplicateDeltaCount, 1);
});

test("cumulative snapshots mixed into a delta stream cannot replay assembled content", () => {
  const assembler = new JsonStageStreamAssembler();
  assembler.append({ choiceIndex: 0, deltaContent: "{\"facts\":" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":" });
  assembler.append({ choiceIndex: 0, messageContent: "{\"facts\":[]" });
  assembler.append({ choiceIndex: 0, deltaContent: "}" });

  assert.equal(assembler.content(), "{\"facts\":[]}");
  assert.equal(assembler.metrics().contentMode, "mixed");
  assert.equal(assembler.metrics().duplicateCumulativeSnapshotCount, 1);
});
