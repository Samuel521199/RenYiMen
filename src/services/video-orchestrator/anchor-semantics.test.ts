import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorReferenceUsagePolicy,
  hasPhysicalSceneEvidence,
  isReferenceImageEligibleAnchor,
  isVisibleEvidenceAnchor,
  normalizeAnchorSemantics,
  purgePlanSoftAnchorConflicts,
  sanitizePlanSoftAnchorVisibility,
} from "./anchor-semantics";
import type { VideoConsistencyAnchor } from "./types";

function anchor(overrides: Partial<VideoConsistencyAnchor>): VideoConsistencyAnchor {
  return {
    id: "anchor_bg",
    type: "location",
    displayNameZh: "节日感彩色背景",
    mustStayConsistent: true,
    needsReferenceImage: true,
    referenceStrength: "medium",
    descriptionZh: "高饱和模糊节日感光斑与色块",
    assetImageContract: {
      subjectCount: 0,
      subjectDescription: "抽象散景和渐变色块，没有具体物体",
      composition: { framing: "全画幅", occupancy: "100%" },
      environment: {
        background: "模糊节日氛围",
        foreground: "None",
        midground: "柔和渐变",
        backgroundLayer: "虚化光斑",
        spatialRelationships: ["色块柔和重叠", "散景大小变化"],
      },
      palette: ["蓝色", "黄色", "红色"],
    },
    ...overrides,
  };
}

test("abstract color mood is downgraded from location to palette_mood", () => {
  const normalized = normalizeAnchorSemantics(anchor({}));
  assert.equal(normalized.type, "palette_mood");
  assert.equal(normalized.needsReferenceImage, false);
  assert.equal(normalized.referenceStrength, "soft");
  assert.equal(isReferenceImageEligibleAnchor(normalized), false);
  assert.equal(isVisibleEvidenceAnchor(normalized), false);
});

test("a physical scene with stable geometry remains a scene-layout anchor", () => {
  const normalized = normalizeAnchorSemantics(anchor({
    displayNameZh: "游戏节目舞台",
    descriptionZh: "固定舞台，中央牌桌，后方拱门，两侧灯柱",
    assetImageContract: {
      subjectCount: 0,
      subjectDescription: "完整游戏节目舞台",
      environment: {
        background: "后方发光拱门",
        foreground: "中央牌桌",
        midground: "左右两侧灯柱",
        backgroundLayer: "舞台后墙",
        spatialRelationships: ["牌桌位于拱门正前方", "灯柱分列舞台左右"],
      },
    },
  }));
  assert.equal(hasPhysicalSceneEvidence(normalized), true);
  assert.equal(normalized.type, "location");
  assert.equal(isVisibleEvidenceAnchor(normalized), true);
});

test("palette policy inherits color only and explicitly forbids layout copying", () => {
  const policy = anchorReferenceUsagePolicy({ type: "palette_mood" });
  assert.deepEqual(policy.inherit, ["palette", "saturation", "color_temperature", "lighting_mood"]);
  assert.ok(policy.forbidInherit.includes("space_layout"));
  assert.ok(policy.forbidInherit.includes("background_geometry"));
});

test("legacy conflict purge removes soft scene assets, camera gates, and stale references", () => {
  const source = {
    consistencyManifest: { anchors: [anchor({})] },
    consistencyReferences: [{ keyframeNo: -1005, anchorId: "anchor_bg" }],
    assetLibrary: { items: [{ keyframeNo: -1005, anchorId: "anchor_bg" }] },
    cameraGraph: {
      cameras: [{ cameraId: "camera_01", locationId: "anchor_bg", segmentNos: [1] }],
      relations: [],
    },
    transitionReferencePlan: [{ to_camera_id: "camera_01", to_segment_no: 1, mode: "full" }],
    transitionReferenceArtifacts: [{
      id: "transition_reference:camera_01:1",
      toCameraId: "camera_01",
      toSegmentNo: 1,
      mode: "short",
      status: "planned",
    }],
    keyframes: [{
      keyframeNo: 1,
      imagePromptZh: "保留节日感模糊背景(anchor_bg)，不要重新设计环境。",
      effectiveRequiredAnchorIds: ["anchor_bg"],
    }],
    referenceSelectionOutputs: [{
      targetArtifactId: "keyframe:1",
      selectedArtifactIds: ["consistency_reference:-1005"],
      candidates: [{ artifactId: "consistency_reference:-1005", anchorId: "anchor_bg" }],
      finalTextPrompt: "Use the festive mood (anchor_bg).",
    }, {
      targetArtifactId: "consistency_reference:-1005",
      selectedArtifactIds: [],
    }],
    generationQualityReports: [{
      assetId: "keyframe:1",
      expectedAnchorIds: ["anchor_bg"],
      atomicRequirements: [{ id: "soft", referenceAnchorIds: ["anchor_bg"] }, { id: "identity", referenceAnchorIds: ["hero"] }],
    }, {
      assetId: "consistency_reference:-1005",
    }],
  };
  const result = purgePlanSoftAnchorConflicts(source);
  const plan = result.plan;
  assert.deepEqual(result.softAnchorIds, ["anchor_bg"]);
  assert.deepEqual(result.removedReferenceKeyframeNos, [-1005]);
  assert.equal(plan.consistencyManifest.anchors[0]?.type, "palette_mood");
  assert.equal(plan.assetLibrary.items.length, 0);
  assert.equal("locationId" in plan.cameraGraph.cameras[0], false);
  assert.deepEqual(plan.transitionReferencePlan, []);
  assert.deepEqual(plan.transitionReferenceArtifacts, []);
  assert.equal(plan.keyframes[0]?.imagePromptZh, "保留节日感模糊背景，不要重新设计环境。");
  assert.deepEqual(plan.keyframes[0]?.effectiveRequiredAnchorIds, []);
  assert.equal(plan.referenceSelectionOutputs.length, 1);
  assert.deepEqual(plan.referenceSelectionOutputs[0]?.selectedArtifactIds, []);
  assert.deepEqual(plan.referenceSelectionOutputs[0]?.candidates, []);
  assert.equal(plan.referenceSelectionOutputs[0]?.finalTextPrompt, "Use the festive mood .");
  assert.equal(plan.generationQualityReports.length, 1);
  assert.deepEqual(plan.generationQualityReports[0]?.expectedAnchorIds, []);
  assert.deepEqual(plan.generationQualityReports[0]?.atomicRequirements, [{ id: "identity", referenceAnchorIds: ["hero"] }]);
});

test("legacy plans remove palette mood from visible dependencies without rewriting keyframe prose", () => {
  const source = {
    consistencyManifest: { anchors: [anchor({})] },
    consistencyReferences: [{ keyframeNo: -1005, anchorId: "anchor_bg" }],
    assetLibrary: { items: [{ keyframeNo: -1005, anchorId: "anchor_bg" }] },
    keyframes: [{
      keyframeNo: 4,
      imagePromptZh: "环境：模糊的节日感彩色背景。",
      requiredAnchorIds: ["anchor_bg"],
      effectiveRequiredAnchorIds: ["anchor_bg"],
      usesConsistencyAnchors: ["anchor_bg"],
    }],
  };
  const result = sanitizePlanSoftAnchorVisibility(source);
  const plan = result.plan;
  assert.deepEqual(result.reclassifiedAnchorIds, ["anchor_bg"]);
  assert.deepEqual(result.removedReferenceKeyframeNos, [-1005]);
  assert.equal(plan.consistencyManifest.anchors[0]?.type, "palette_mood");
  assert.equal(plan.consistencyReferences.length, 0);
  assert.equal(plan.assetLibrary.items.length, 0);
  assert.deepEqual(plan.keyframes[0]?.effectiveRequiredAnchorIds, []);
  assert.equal(plan.keyframes[0]?.imagePromptZh, "环境：模糊的节日感彩色背景。");
});
