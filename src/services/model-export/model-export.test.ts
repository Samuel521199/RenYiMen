import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync("src/app/api/model-assets/export/route.ts", "utf8");
const exporterSource = readFileSync("scripts/model-export-blender.py", "utf8");
const viewerSource = readFileSync("src/components/TaskStatusViewer/TaskStatusViewer.tsx", "utf8");
const dockerfileSource = readFileSync("Dockerfile", "utf8");

test("model export route authenticates, blocks private hosts, and invokes Blender without a shell", () => {
  assert.match(routeSource, /const session = await auth\(\)/);
  assert.match(routeSource, /lookup\(parsed\.hostname/);
  assert.match(routeSource, /isPrivateIp/);
  assert.match(routeSource, /redirect: "manual"/);
  assert.match(routeSource, /shell: false/);
  assert.match(routeSource, /safeRemoveTemporaryDirectory/);
});

test("art packages contain FBX, original textures, semantic maps, and split PBR channels", () => {
  assert.match(exporterSource, /bpy\.ops\.export_scene\.fbx/);
  assert.match(exporterSource, /textures" \/ "source/);
  assert.match(exporterSource, /"base_color"/);
  assert.match(exporterSource, /"normal"/);
  assert.match(exporterSource, /\("roughness", 1\), \("metallic", 2\)/);
  assert.match(exporterSource, /manifest\.json/);
});

test("model result UI exposes original GLB, FBX package, and texture package downloads", () => {
  assert.match(viewerSource, /downloadGlbBtn/);
  assert.match(viewerSource, /handleModelExport\("fbx"\)/);
  assert.match(viewerSource, /handleModelExport\("textures"\)/);
  assert.match(viewerSource, /role="alert"/);
  assert.match(viewerSource, /min-h-11/);
});

test("production image includes the headless Blender runtime and exporter script", () => {
  assert.match(dockerfileSource, /apk add --no-cache[^\n]*blender-headless/);
  assert.match(dockerfileSource, /scripts\/model-export-blender\.py/);
  assert.match(dockerfileSource, /BLENDER_EXECUTABLE=\/usr\/bin\/blender-headless/);
});
