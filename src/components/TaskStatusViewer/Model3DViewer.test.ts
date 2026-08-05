import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewerSource = readFileSync("src/components/TaskStatusViewer/Model3DViewer.tsx", "utf8");
const taskViewerSource = readFileSync("src/components/TaskStatusViewer/TaskStatusViewer.tsx", "utf8");
const proxySource = readFileSync("src/app/api/download-external-image/route.ts", "utf8");
const downloadSource = readFileSync("src/lib/download-result-video.ts", "utf8");

test("model results render an interactive, lazily loaded GLB viewer", () => {
  assert.match(taskViewerSource, /<Model3DViewer src=\{mediaUrl\} posterUrl=\{previewUrl\}/);
  assert.match(viewerSource, /import\("three"\)/);
  assert.match(viewerSource, /GLTFLoader/);
  assert.match(viewerSource, /OrbitControls/);
  assert.match(viewerSource, /ResizeObserver/);
});

test("model viewer supports camera reset, keyboard access, loading and recovery feedback", () => {
  assert.match(viewerSource, /tabIndex=\{0\}/);
  assert.match(viewerSource, /ArrowLeft/);
  assert.match(viewerSource, /resetViewRef/);
  assert.match(viewerSource, /modelPreviewLoading/);
  assert.match(viewerSource, /modelPreviewRetry/);
});

test("model loading falls back to the authenticated same-origin proxy", () => {
  assert.match(viewerSource, /mediaKind=model/);
  assert.match(proxySource, /MAX_BYTES_MODEL/);
  assert.match(proxySource, /model\/gltf-binary/);
  assert.match(proxySource, /isVideo \|\| isModel \? 120_000/);
  assert.match(downloadSource, /ext === "glb" \? "model" : "video"/);
});
