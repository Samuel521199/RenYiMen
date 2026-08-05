import assert from "node:assert/strict";
import test from "node:test";

import {
  navigateWorkbenchToolSection,
  readWorkbenchToolGroup,
  WORKBENCH_TOOL_SECTION_EVENT,
  WORKFLOW_STUDIO_HISTORY_STATE_KEY,
} from "./tool-section-navigation.ts";

test("reads supported workbench tool groups", () => {
  assert.equal(readWorkbenchToolGroup("favorites"), "favorites");
  assert.equal(readWorkbenchToolGroup("video-generation"), "video-generation");
  assert.equal(readWorkbenchToolGroup("video-editing"), "video-editing");
  assert.equal(readWorkbenchToolGroup("audio-post"), "audio-post");
});

test("treats the tools home and unknown groups as unfiltered", () => {
  assert.equal(readWorkbenchToolGroup(null), null);
  assert.equal(readWorkbenchToolGroup(""), null);
  assert.equal(readWorkbenchToolGroup("unknown"), null);
});

test("switches tool sections through history state without reloading the page", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let pushedHref = "";
  let pushedState: Record<string, unknown> | null = null;
  let dispatchedGroup: string | null | undefined;
  const fakeWindow = {
    location: {
      href: "http://localhost:3001/workbench/tools?group=video-editing",
      pathname: "/workbench/tools",
      search: "?group=video-editing",
      hash: "",
    },
    history: {
      state: { [WORKFLOW_STUDIO_HISTORY_STATE_KEY]: "TEST_SKU", preserved: true },
      pushState(state: Record<string, unknown>, _title: string, href: string) {
        pushedState = state;
        pushedHref = href;
      },
      replaceState() {
        throw new Error("unexpected replaceState");
      },
    },
    dispatchEvent(event: CustomEvent<{ group: string | null }>) {
      assert.equal(event.type, WORKBENCH_TOOL_SECTION_EVENT);
      dispatchedGroup = event.detail.group;
      return true;
    },
  };

  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  try {
    navigateWorkbenchToolSection("/workbench/tools?group=audio-post");
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }

  assert.equal(pushedHref, "/workbench/tools?group=audio-post");
  assert.deepEqual(pushedState, { preserved: true });
  assert.equal(dispatchedGroup, "audio-post");
});
