import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_SUBTITLE_CREDITS } from "./subtitle-pricing.ts";

test("automatic subtitles have one shared fixed price", () => {
  assert.equal(AUTO_SUBTITLE_CREDITS, 100);
});
