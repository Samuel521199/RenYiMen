import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { normalizeAnchorSemantics } from "../src/services/video-orchestrator/anchor-semantics";
import { validateOnePromptVideoPlan } from "../src/services/video-orchestrator/plan-validator";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Object.keys(record(item)).length > 0) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : [];
}

async function main(): Promise<void> {
  const projectId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!projectId) throw new Error("Usage: migrate-one-prompt-scene-contract.ts <projectId> [--apply]");

  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      planJson: true,
      keyframes: {
        where: { keyframeNo: { gt: 0 } },
        orderBy: { keyframeNo: "asc" },
        select: { keyframeNo: true, imageUrl: true, locked: true, status: true },
      },
    },
  });
  if (!project) throw new Error(`Video project ${projectId} not found`);

  const plan = structuredClone(record(project.planJson));
  const existingSceneContracts = records(plan.sceneContracts ?? plan.scene_contracts);
  const graphKey = Object.keys(record(plan.cameraGraph)).length ? "cameraGraph" : "camera_graph";
  const graph = record(plan[graphKey]);
  const cameras = records(graph.cameras ?? graph.nodes);
  if (!cameras.length) throw new Error("Project has no camera graph; migration refused");

  const approvedRoot = project.keyframes.find((frame) =>
    Boolean(frame.imageUrl) && (frame.locked || frame.status === "IMAGE_APPROVED")
  );
  if (!approvedRoot) throw new Error("Project has no approved positive boundary frame; migration refused");

  const sceneId = `scene_${project.id}_01`;
  const cameraIds = cameras.map((camera, index) =>
    text(camera.cameraId ?? camera.camera_id ?? camera.id) || `camera_${index + 1}`
  );
  const segmentNos = [...new Set(cameras.flatMap((camera) =>
    numbers(camera.segmentNos ?? camera.segment_nos ?? camera.segments)
  ))].sort((a, b) => a - b);
  const spatialLocks = [...new Set(cameras.map((camera) =>
    text(camera.spatialLayoutLock ?? camera.spatial_layout_lock)
  ).filter(Boolean))];
  const axisLocks = [...new Set(cameras.map((camera) =>
    text(camera.axisDescription ?? camera.axis_description)
  ).filter(Boolean))];

  graph.cameras = cameras.map((camera) => ({ ...camera, sceneId }));
  plan[graphKey] = graph;

  const sceneContract = {
    version: "scene-contract-v1",
    sceneId,
    displayNameZh: "已审核边界帧场景",
    displayNameEn: "Approved boundary scene",
    cameraIds,
    segmentNos,
    continuityMode: "single_space",
    spatialLayoutLock: spatialLocks.join("；") || "继承已审核根边界帧中的固定物体、主体站位区、景深层次和背景几何",
    cameraAxis: axisLocks.join("；") || undefined,
    fixedLandmarks: spatialLocks.length ? spatialLocks : ["已审核根边界帧中的固定背景几何"],
    authority: { kind: "approved_root_boundary", keyframeNo: approvedRoot.keyframeNo },
    migration: {
      reason: "legacy_project_missing_scene_contract",
      preservesGeneratedMedia: true,
      migratedAt: new Date().toISOString(),
    },
  };
  plan.sceneContracts = [sceneContract];

  // Normalize legacy palette/style anchors without creating or deleting media.
  for (const manifest of [
    record(plan.consistencyManifest),
    record(record(plan.planningManifest).consistencyManifest),
  ]) {
    if (!Array.isArray(manifest.anchors)) continue;
    manifest.anchors = records(manifest.anchors).map((anchor) =>
      normalizeAnchorSemantics(anchor as never)
    );
  }

  const sceneValidationErrors = validateOnePromptVideoPlan(plan, { stage: "video_generation" })
    .filter((issue) =>
      issue.severity === "error"
      && (issue.code.startsWith("SCENE_") || issue.code === "CAMERA_SCENE_BINDING_BROKEN")
    );
  if (sceneValidationErrors.length) {
    throw new Error(`Scene-contract migration failed validation: ${JSON.stringify(sceneValidationErrors)}`);
  }

  const summary = {
    projectId,
    status: project.status,
    apply,
    sceneId,
    cameraIds,
    segmentNos,
    authorityKeyframeNo: approvedRoot.keyframeNo,
    generatedMediaChanged: false,
    sceneValidationErrors: [],
    existingSceneContractIds: existingSceneContracts.map((contract) => text(contract.sceneId ?? contract.scene_id)).filter(Boolean),
  };
  if (apply) {
    await prisma.videoProject.update({
      where: { id: projectId },
      data: { planJson: plan as Prisma.InputJsonValue },
    });
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
