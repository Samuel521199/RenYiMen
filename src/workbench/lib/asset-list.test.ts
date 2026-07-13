import assert from "node:assert/strict";
import test from "node:test";

import { parseAssetListPageResponse, parseAssetListResponse } from "./asset-list.ts";

test("parseAssetListResponse accepts plain array", () => {
  const items = [{ id: 1, url: "/static/a.png" }];
  assert.deepEqual(parseAssetListResponse(items), items);
});

test("parseAssetListResponse accepts paginated payload", () => {
  const payload = {
    items: [{ id: 2, url: "/static/b.png" }],
    total: 10,
    page: 2,
    page_size: 1,
  };
  assert.deepEqual(parseAssetListResponse(payload), payload.items);
});

test("parseAssetListResponse returns empty for invalid payload", () => {
  assert.deepEqual(parseAssetListResponse(null), []);
  assert.deepEqual(parseAssetListResponse({ total: 5 }), []);
});

test("parseAssetListPageResponse reads paginated payload", () => {
  const payload = {
    items: [{ id: 3, url: "/static/c.png" }],
    total: 99,
    page: 3,
    page_size: 12,
  };
  assert.deepEqual(parseAssetListPageResponse(payload), payload);
});

test("parseAssetListPageResponse trims oversized paginated items", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, url: `/static/${index + 1}.png` }));
  const payload = { items, total: 50, page: 1, page_size: 24 };
  const pageData = parseAssetListPageResponse(payload, 24, 1);
  assert.equal(pageData.items.length, 24);
  assert.equal(pageData.items[0]?.id, 1);
  assert.equal(pageData.total, 50);
});

test("parseAssetListPageResponse slices plain array by requested page", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({ id: index + 1, url: `/static/${index + 1}.png` }));
  const page1 = parseAssetListPageResponse(items, 24, 1);
  assert.equal(page1.items.length, 24);
  assert.equal(page1.total, 50);
  assert.equal(page1.page, 1);

  const page3 = parseAssetListPageResponse(items, 24, 3);
  assert.equal(page3.items.length, 2);
  assert.equal(page3.page, 3);
});

test("parseAssetListPageResponse wraps plain array on single page", () => {
  const items = [{ id: 4, url: "/static/d.png" }];
  assert.deepEqual(parseAssetListPageResponse(items, 48, 1), {
    items,
    total: 1,
    page: 1,
    page_size: 48,
  });
});
