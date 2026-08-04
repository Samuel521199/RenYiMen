import assert from "node:assert/strict";
import test from "node:test";

import OnePromptVideoToolLayout from "../app/(platform)/workbench/tools/one-prompt-video/layout";
import OnePromptVideoWorkflowLayout from "../app/(platform)/workbench/workflows/one-prompt-video/layout";
import { GET as getSkuCatalog } from "../app/api/skus/route";
import { isOnePromptVideoWorkbenchEnabled } from "./one-prompt-video-feature";

test("one-prompt video workbench is disabled by default", () => {
  assert.equal(isOnePromptVideoWorkbenchEnabled({}), false);
});

test("one-prompt video workbench can be disabled only from server configuration", () => {
  assert.equal(isOnePromptVideoWorkbenchEnabled({ ONE_PROMPT_VIDEO_WORKBENCH_ENABLED: "false" }), false);
  assert.equal(isOnePromptVideoWorkbenchEnabled({ ONE_PROMPT_VIDEO_WORKBENCH_ENABLED: " true " }), true);
  assert.equal(isOnePromptVideoWorkbenchEnabled({ ONE_PROMPT_VIDEO_WORKBENCH_ENABLED: "invalid" }), false);
});

test("disabled workbench is removed from the catalog and both direct routes", async () => {
  const previous = process.env.ONE_PROMPT_VIDEO_WORKBENCH_ENABLED;
  process.env.ONE_PROMPT_VIDEO_WORKBENCH_ENABLED = "false";
  try {
    const body = await (await getSkuCatalog()).json();
    assert.equal(
      body.skus.some((sku: { skuId: string }) => sku.skuId === "ONE_PROMPT_30S_VIDEO"),
      false,
    );
    for (const layout of [OnePromptVideoToolLayout, OnePromptVideoWorkflowLayout]) {
      assert.throws(
        () => layout({ children: null }),
        (error: unknown) => error instanceof Error && "digest" in error
          && error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.ONE_PROMPT_VIDEO_WORKBENCH_ENABLED;
    else process.env.ONE_PROMPT_VIDEO_WORKBENCH_ENABLED = previous;
  }
});
