import assert from "node:assert/strict";
import test from "node:test";
import { getCropOutputSize, isImageSizeWithinBounds, resolveCropImageSource } from "./image-crop.ts";

test("image bounds enforce both minimum and maximum dimensions", () => {
  assert.equal(isImageSizeWithinBounds(400, 7000, 400, 7000), true);
  assert.equal(isImageSizeWithinBounds(399, 7000, 400, 7000), false);
  assert.equal(isImageSizeWithinBounds(400, 7001, 400, 7000), false);
});

test("crop output scales into the supported bounds without changing aspect ratio", () => {
  assert.deepEqual(getCropOutputSize({ width: 8000, height: 4000 }, 400, 7000), {
    width: 7000,
    height: 3500,
    scale: 0.875,
  });
  assert.deepEqual(getCropOutputSize({ width: 200, height: 100 }, 400, 7000), {
    width: 800,
    height: 400,
    scale: 4,
  });
});

test("remote crop sources use the same-origin proxy", () => {
  assert.equal(resolveCropImageSource("blob:preview", "https://local.test"), "blob:preview");
  assert.equal(resolveCropImageSource("https://local.test/image.png", "https://local.test"), "https://local.test/image.png");
  assert.equal(
    resolveCropImageSource("https://cdn.test/image.png", "https://local.test"),
    "/api/download-external-image?url=https%3A%2F%2Fcdn.test%2Fimage.png",
  );
});
