import assert from "node:assert/strict";
import test from "node:test";
import {
  getCropOutputSize,
  isImageSizeWithinBounds,
  resolveCropImageSource,
} from "./image-crop";

test("upscales a small crop to the model minimum", () => {
  assert.deepEqual(getCropOutputSize({ width: 200, height: 300 }, 400, 7000), {
    width: 400,
    height: 600,
    scale: 2,
  });
});

test("downscales a large crop to the model maximum", () => {
  assert.deepEqual(getCropOutputSize({ width: 8000, height: 4000 }, 400, 7000), {
    width: 7000,
    height: 3500,
    scale: 0.875,
  });
});

test("detects image dimensions outside configured bounds", () => {
  assert.equal(isImageSizeWithinBounds(399, 900, 400, 7000), false);
  assert.equal(isImageSizeWithinBounds(900, 7001, 400, 7000), false);
  assert.equal(isImageSizeWithinBounds(900, 1200, 400, 7000), true);
});

test("routes cross-origin crop images through the same-origin media proxy", () => {
  assert.equal(
    resolveCropImageSource("https://oss.example.com/uploads/a.jpg", "http://47.86.39.173:3001"),
    "/api/download-external-image?url=https%3A%2F%2Foss.example.com%2Fuploads%2Fa.jpg",
  );
});

test("keeps local crop image sources unchanged", () => {
  assert.equal(resolveCropImageSource("blob:local-preview", "http://47.86.39.173:3001"), "blob:local-preview");
  assert.equal(resolveCropImageSource("/uploads/a.jpg", "http://47.86.39.173:3001"), "/uploads/a.jpg");
});
