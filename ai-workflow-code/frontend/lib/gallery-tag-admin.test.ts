import assert from "node:assert/strict";
import test from "node:test";

import {
  GALLERY_SOURCE_TYPES,
  normalizeManagedGalleryTags,
} from "./gallery-tag-admin.ts";

test("gallery tag admin exposes six source-type tabs", () => {
  assert.deepEqual(
    GALLERY_SOURCE_TYPES.map((item) => item.code),
    ["activity", "share", "daily", "trending", "brand", "game"],
  );
});

test("gallery tag admin normalizes managed tag records", () => {
  const tags = normalizeManagedGalleryTags([
    { id: 1, name: "3D卡通", source_type: "activity", image_count: 2 },
    { id: "bad", name: "", source_type: "activity", image_count: 0 },
  ]);

  assert.deepEqual(tags, [
    { id: 1, name: "3D卡通", source_type: "activity", image_count: 2, created_at: null },
  ]);
});
