import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isFastStartMp4, mp4TopLevelAtoms } from "./mp4-streaming.ts";

function atom(type: string, payloadBytes: number): Buffer {
  const value = Buffer.alloc(8 + payloadBytes);
  value.writeUInt32BE(value.length, 0);
  value.write(type, 4, 4, "latin1");
  return value;
}

test("MP4 fast-start requires moov before mdat", () => {
  const slow = Buffer.concat([atom("ftyp", 4), atom("mdat", 16), atom("moov", 8)]);
  const fast = Buffer.concat([atom("ftyp", 4), atom("moov", 8), atom("mdat", 16)]);
  assert.equal(isFastStartMp4(slow), false);
  assert.equal(isFastStartMp4(fast), true);
  assert.deepEqual(mp4TopLevelAtoms(fast).map((item) => item.type), ["ftyp", "moov", "mdat"]);
});

test("OSS persistence enforces streaming MP4 layout and immutable browser caching", () => {
  const source = readFileSync(new URL("./oss-media.ts", import.meta.url), "utf8");

  assert.match(source, /optimizeMp4ForStreaming/);
  assert.match(source, /public, max-age=31536000, immutable/);
  assert.match(source, /ContentDisposition:\s*"inline"/);
  assert.match(source, /OSS_MEDIA_PUBLIC_DOMAIN/);
});
