import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGalleryQuery,
  normalizeGalleryCategories,
  normalizeGalleryTags,
} from "./gallery-browser.ts";

test("gallery browser query includes selected three-level filters only", () => {
  const query = buildGalleryQuery({
    selectedSourceType: "activity",
    selectedSubCategory: "revisit",
    selectedTag: "3D卡通",
  });

  assert.equal(query, "source_type=activity&sub_category=revisit&style_tag=3D%E5%8D%A1%E9%80%9A");
});

test("gallery browser query omits empty filters", () => {
  const query = buildGalleryQuery({
    selectedSourceType: null,
    selectedSubCategory: null,
    selectedTag: null,
  });

  assert.equal(query, "");
});

test("gallery browser normalizers keep only valid categories and tags", () => {
  const categories = normalizeGalleryCategories([
    {
      code: "activity",
      label: "活动图",
      count: 3,
      sub_categories: [{ code: "revisit", label: "回访召回" }],
    },
    {
      code: "",
      label: "broken",
      count: 0,
      sub_categories: [],
    },
  ]);
  const tags = normalizeGalleryTags(["3D卡通", "", "金币风", null]);

  assert.deepEqual(categories, [
    {
      code: "activity",
      label: "活动图",
      count: 3,
      sub_categories: [{ code: "revisit", label: "回访召回" }],
    },
  ]);
  assert.deepEqual(tags, ["3D卡通", "金币风"]);
});
