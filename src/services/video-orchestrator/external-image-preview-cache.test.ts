import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const routeSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/download-external-image/route.ts"),
  "utf8",
);

test("authenticated image previews are browser-cacheable across page remounts", () => {
  assert.match(
    routeSource,
    /IMAGE_PREVIEW_CACHE_CONTROL\s*=\s*"private, max-age=604800, stale-while-revalidate=86400, immutable"/,
  );
  assert.match(
    routeSource,
    /proxyExternalMedia\(url, mediaKindRaw, \{ cachePreview: mediaKindRaw !== "video" \}\)/,
  );
});

test("POST downloads and video proxying keep no-store semantics", () => {
  assert.match(routeSource, /NO_STORE_CACHE_CONTROL\s*=\s*"private, no-store"/);
  assert.match(
    routeSource,
    /proxyExternalMedia\(url, mediaKindRaw, \{ cachePreview: false \}\)/,
  );
  assert.match(routeSource, /options\.cachePreview && !isVideo/);
});
