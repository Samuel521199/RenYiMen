import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/WorkflowForm/WorkflowStudio.tsx", "utf8");

test("auto subtitle submit callback refreshes after the uploaded video URL changes", () => {
  assert.match(
    source,
    /\}, \[selectedSku, validate, buildPayload, resetPoll, setViewingHistoryId, isAutoSubtitleTool, standaloneSourceVideoUrl, locale\]\);/,
  );
});

test("the stale upload warning clears when a standalone video becomes ready", () => {
  assert.match(source, /if \(isAutoSubtitleTool && standaloneSourceVideoUrl\) setSubmitError\(null\)/);
});
