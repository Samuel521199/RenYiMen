import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectServiceSource = readFileSync(
  new URL("./project-service.ts", import.meta.url),
  "utf8",
);

test("empty artifact collections cannot complete or open downstream review gates", () => {
  assert.match(
    projectServiceSource,
    /reviewableAssetKeyframes\.length > 0[\s\S]*reviewableAssetKeyframes\.every/,
  );
  assert.match(
    projectServiceSource,
    /reviewableBoundaryKeyframes\.length > 0[\s\S]*reviewableBoundaryKeyframes\.every/,
  );
  assert.match(
    projectServiceSource,
    /project\.segments\.length > 0[\s\S]*boundaryApproved[\s\S]*microNodes\.every/,
  );
  assert.match(
    projectServiceSource,
    /segmentNodes\.length > 0[\s\S]*segmentNodes\.every/,
  );
});

test("downstream review gates retain upstream dependencies before artifacts exist", () => {
  assert.match(
    projectServiceSource,
    /dependencyIds: boundaryNodes\.length[\s\S]*\["review:assets"\]/,
  );
  assert.match(
    projectServiceSource,
    /dependencyIds: segmentNodes\.length[\s\S]*\["review:micro-shots"\]/,
  );
});

test("planning queue returns a snapshot fetched after the durable job is enqueued", () => {
  const queueStart = projectServiceSource.indexOf(
    "export async function queueVideoProjectPlanning",
  );
  const plannerStart = projectServiceSource.indexOf(
    "export async function planVideoProject",
    queueStart,
  );
  const queueSource = projectServiceSource.slice(queueStart, plannerStart);
  const enqueueAt = queueSource.lastIndexOf("await enqueueVideoProductionJob");
  const refetchAt = queueSource.lastIndexOf("return requireVideoProject");

  assert.ok(enqueueAt >= 0);
  assert.ok(refetchAt > enqueueAt);
  assert.doesNotMatch(queueSource, /const queued = await requireVideoProject/);
});
