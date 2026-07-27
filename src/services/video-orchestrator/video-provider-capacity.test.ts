import assert from "node:assert/strict";
import test from "node:test";
import { selectFairVideoProviderWaiter } from "./video-provider-capacity.ts";
import { dashScopeResourceKey } from "./provider-capacity.ts";

const at = (seconds: number) => new Date(1_700_000_000_000 + seconds * 1_000);

test("an idle user receives the next shared provider slot before a saturated user", () => {
  const selected = selectFairVideoProviderWaiter([
    { id: "user-a-next", userId: "a", projectId: "a1", queuedAt: at(0), createdAt: at(0) },
    { id: "user-b-first", userId: "b", projectId: "b1", queuedAt: at(1), createdAt: at(1) },
  ], [
    { userId: "a", projectId: "a1" },
    { userId: "a", projectId: "a2" },
  ]);
  assert.equal(selected?.id, "user-b-first");
});

test("projects are balanced inside one user before queue age breaks ties", () => {
  const selected = selectFairVideoProviderWaiter([
    { id: "busy-project", userId: "a", projectId: "a1", queuedAt: at(0), createdAt: at(0) },
    { id: "idle-project", userId: "a", projectId: "a2", queuedAt: at(1), createdAt: at(1) },
  ], [
    { userId: "a", projectId: "a1" },
  ]);
  assert.equal(selected?.id, "idle-project");
});

test("a single user's oldest demand can consume otherwise idle capacity", () => {
  const selected = selectFairVideoProviderWaiter([
    { id: "second", userId: "a", projectId: "a1", queuedAt: at(2), createdAt: at(2) },
    { id: "first", userId: "a", projectId: "a1", queuedAt: at(1), createdAt: at(1) },
  ], []);
  assert.equal(selected?.id, "first");
});

test("text, image, visual-QA and video capacity never share a resource pool", () => {
  const model = "shared-model-name";
  const keys = new Set([
    dashScopeResourceKey("text_planning", model),
    dashScopeResourceKey("image_generation", model),
    dashScopeResourceKey("visual_quality", model),
    dashScopeResourceKey("video_generation", model),
  ]);
  assert.equal(keys.size, 4);
  for (const key of keys) {
    assert.doesNotMatch(key, /DASHSCOPE_API_KEY|BAILIAN_API_KEY/);
  }
});
