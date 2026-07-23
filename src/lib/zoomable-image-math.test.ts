import assert from "node:assert/strict";
import test from "node:test";

import { zoomViewAtPoint, type ZoomFocus, type ZoomView } from "./zoomable-image-math";

function imageCoordinateAt(view: ZoomView, focus: ZoomFocus) {
  return {
    x: (focus.x - view.x) / view.scale,
    y: (focus.y - view.y) / view.scale,
  };
}

test("cursor-anchored zoom keeps the same image point under the cursor", () => {
  const focus = { x: 173, y: -91 };
  const before = { scale: 1, x: 0, y: 0 };
  const imagePoint = imageCoordinateAt(before, focus);
  const after = zoomViewAtPoint(before, 1.8, focus);
  const anchored = imageCoordinateAt(after, focus);
  assert.ok(Math.abs(anchored.x - imagePoint.x) < 1e-9);
  assert.ok(Math.abs(anchored.y - imagePoint.y) < 1e-9);
});

test("successive wheel events use the current atomic view without anchor drift", () => {
  const focus = { x: -208, y: 137 };
  let view = { scale: 1, x: 0, y: 0 };
  const imagePoint = imageCoordinateAt(view, focus);
  for (let index = 0; index < 8; index += 1) view = zoomViewAtPoint(view, 1.18, focus);
  const anchored = imageCoordinateAt(view, focus);
  assert.ok(Math.abs(anchored.x - imagePoint.x) < 1e-9);
  assert.ok(Math.abs(anchored.y - imagePoint.y) < 1e-9);
});

test("zooming fully out resets the centered view", () => {
  const view = zoomViewAtPoint({ scale: 1.2, x: -40, y: 25 }, 0.01, { x: 80, y: 60 });
  assert.deepEqual(view, { scale: 1, x: 0, y: 0 });
});
