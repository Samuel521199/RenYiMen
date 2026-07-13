import assert from "node:assert/strict";
import test from "node:test";

import { apiUpload } from "./api.ts";

test("apiUpload sends requests with an abort signal for timeout handling", async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedSignal = init?.signal as AbortSignal | undefined;
    return {
      json: async () => ({ code: 0, msg: "ok", data: {} }),
    } as Response;
  }) as typeof fetch;

  try {
    await apiUpload("/api/assets/upload", new FormData(), 120000);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(capturedSignal);
  assert.equal(capturedSignal.aborted, false);
});
