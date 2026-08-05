import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const routeSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/download-external-image/route.ts"),
  "utf8",
);
const reviewPageSource = fs.readFileSync(
  path.join(process.cwd(), "src/app/(platform)/workbench/workflows/one-prompt-video/page.tsx"),
  "utf8",
);

test("authenticated image previews are browser-cacheable across page remounts", () => {
  assert.match(
    routeSource,
    /IMAGE_PREVIEW_CACHE_CONTROL\s*=\s*"private, max-age=604800, stale-while-revalidate=86400, immutable"/,
  );
  assert.match(
    routeSource,
    /proxyExternalMedia\(url, mediaKindRaw, \{ cachePreview: mediaKindRaw !== "video" && mediaKindRaw !== "model" \}\)/,
  );
});

test("POST downloads and video proxying keep no-store semantics", () => {
  assert.match(routeSource, /NO_STORE_CACHE_CONTROL\s*=\s*"private, no-store"/);
  assert.match(
    routeSource,
    /proxyExternalMedia\(url, mediaKindRaw, \{ cachePreview: false \}\)/,
  );
  assert.match(routeSource, /options\.cachePreview && !isVideo && !isModel/);
});

test("preview proxy retries transient origin failures before showing a broken image", () => {
  assert.match(routeSource, /fetchExternalMediaWithRetry\(url/);
  assert.match(routeSource, /isVideo \|\| isModel \? 2 : 3/);
  assert.match(routeSource, /if \(response\.ok \|\| response\.status < 500 \|\| attempt === maxAttempts\)/);
});

test("candidate previews bypass a stale failure and then fall back to the durable source URL", () => {
  assert.match(
    reviewPageSource,
    /onError=\{\(event\) => retryPreviewImageDirectly\(event, candidate\.mediaUrl\)\}/,
  );
  assert.match(reviewPageSource, /previewImageSrc\(directUrl\)[\s\S]*retry=/);
  assert.match(reviewPageSource, /image\.src = directUrl/);
});
