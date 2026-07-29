import type {
  VideoConsistencyAnchor,
  VideoConsistencyAnchorType,
} from "./types";

export type AnchorInheritanceField =
  | "identity"
  | "product_geometry"
  | "palette"
  | "saturation"
  | "color_temperature"
  | "lighting_mood"
  | "rendering_style"
  | "texture"
  | "graphic_motif"
  | "space_layout"
  | "camera_axis"
  | "background_geometry";

export interface AnchorReferenceUsagePolicy {
  role: "hard_identity" | "scene_layout" | "style_only" | "palette_only" | "graphic_backdrop";
  inherit: AnchorInheritanceField[];
  forbidInherit: AnchorInheritanceField[];
}

const PALETTE_MOOD_PATTERN =
  /(?:主色|配色|色板|色调|氛围|光斑|散景|模糊|虚化|色块|渐变|高饱和|抽象背景|palette|color\s*(?:palette|tone|mood|block|field)|bokeh|blurred|soft[- ]focus|gradient|abstract\s*(?:background|pattern)|festive\s*(?:mood|atmosphere))/i;
const GRAPHIC_BACKDROP_PATTERN =
  /(?:品牌背景|图形背景|背景纹理|装饰图案|品牌图案|graphic\s*backdrop|background\s*(?:texture|motif|pattern)|brand\s*(?:backdrop|motif))/i;
const PHYSICAL_SCENE_PATTERN =
  /(?:舞台|房间|室内|街道|建筑|墙面|地面|天花板|门窗|桌面|牌桌|柜台|道路|广场|森林|海滩|山谷|城市|商店|餐厅|厨房|办公室|车内|stage|room|interior|street|building|wall|floor|ceiling|door|window|table|counter|road|plaza|forest|beach|valley|city|shop|restaurant|kitchen|office|vehicle\s*interior)/i;
const EMPTY_LAYER_PATTERN = /^(?:none|null|empty|n\/a|无|空|留空|不存在)[\s.。]*$/i;

const PURE_PALETTE_BACKGROUND_PATTERN =
  /(?:主色|配色|色板|色调|氛围|光斑|散景|模糊|虚化|色块|渐变|高饱和|抽象背景|彩色背景|色彩背景|渐变背景|模糊背景|palette|color(?:ful)?\s*(?:palette|tone|mood|block|field|background)|bokeh|blurred|soft[- ]focus|gradient|abstract\s*(?:background|pattern)|festive\s*(?:mood|atmosphere))/i;

export function normalizeAnchorSemantics(anchor: VideoConsistencyAnchor): VideoConsistencyAnchor {
  const type = inferAnchorSemanticType(anchor);
  if (type === "palette_mood") {
    return {
      ...anchor,
      type,
      semanticRole: "palette_mood",
      mustStayConsistent: true,
      needsReferenceImage: false,
      referenceStrength: "soft",
      referenceUsage: anchorReferenceUsagePolicy({ type }),
    };
  }
  if (type === "graphic_backdrop") {
    return {
      ...anchor,
      type,
      semanticRole: "graphic_backdrop",
      referenceStrength: anchor.referenceStrength === "hard" ? "medium" : anchor.referenceStrength ?? "soft",
      referenceUsage: anchorReferenceUsagePolicy({ type }),
    };
  }
  if (type === "style") {
    return {
      ...anchor,
      semanticRole: "rendering_style",
      needsReferenceImage: false,
      referenceStrength: "soft",
      referenceUsage: anchorReferenceUsagePolicy({ type }),
    };
  }
  if (type === "location" || type === "space_layout") {
    return {
      ...anchor,
      semanticRole: "physical_scene",
      referenceUsage: anchorReferenceUsagePolicy(anchor),
    };
  }
  return {
    ...anchor,
    semanticRole: anchor.semanticRole ?? "identity",
    referenceUsage: anchor.referenceUsage ?? anchorReferenceUsagePolicy(anchor),
  };
}

export function inferAnchorSemanticType(anchor: VideoConsistencyAnchor): VideoConsistencyAnchorType {
  if (anchor.type === "palette_mood" || anchor.type === "graphic_backdrop") return anchor.type;
  if (anchor.type === "style") return "style";
  if (anchor.type !== "location" && anchor.type !== "space_layout") return anchor.type;
  const text = anchorSemanticText(anchor);
  if (GRAPHIC_BACKDROP_PATTERN.test(text) && !hasPhysicalSceneEvidence(anchor)) return "graphic_backdrop";
  if ((PALETTE_MOOD_PATTERN.test(text) || PURE_PALETTE_BACKGROUND_PATTERN.test(text)) && !hasPhysicalSceneEvidence(anchor)) return "palette_mood";
  return anchor.type;
}

export function hasPhysicalSceneEvidence(anchor: VideoConsistencyAnchor): boolean {
  const contract = anchor.assetImageContract;
  const environment = contract?.environment;
  const layers = [
    environment?.foreground,
    environment?.midground,
    environment?.backgroundLayer,
  ].map((value) => value?.trim() ?? "").filter((value) => value && !EMPTY_LAYER_PATTERN.test(value));
  const physicalLayers = layers.filter((value) => PHYSICAL_SCENE_PATTERN.test(value));
  const relationships = environment?.spatialRelationships ?? [];
  const physicalRelationships = relationships.filter((value) => PHYSICAL_SCENE_PATTERN.test(value));
  return PHYSICAL_SCENE_PATTERN.test(anchorSemanticText(anchor))
    || physicalLayers.length >= 2
    || (physicalLayers.length >= 1 && physicalRelationships.length >= 1);
}

export function isPaletteOrStyleOnlyAnchor(anchor: Pick<VideoConsistencyAnchor, "type">): boolean {
  return anchor.type === "palette_mood" || anchor.type === "style";
}

export function isVisibleEvidenceAnchor(anchor: Pick<VideoConsistencyAnchor, "type">): boolean {
  return anchor.type !== "palette_mood"
    && anchor.type !== "style"
    && anchor.type !== "graphic_backdrop";
}

export function isReferenceImageEligibleAnchor(anchor: VideoConsistencyAnchor): boolean {
  if (anchor.type === "palette_mood") return false;
  if (anchor.type === "style") return false;
  if (anchor.type === "graphic_backdrop") {
    return anchor.needsReferenceImage === true;
  }
  return anchor.mustStayConsistent || anchor.needsReferenceImage;
}

export interface AssetVisualSpecEligibility {
  anchor: VideoConsistencyAnchor;
  eligible: boolean;
  reason:
    | "eligible_visible_asset"
    | "palette_or_mood_only"
    | "rendering_style_only"
    | "reference_image_not_required"
    | "not_reference_eligible";
}

/**
 * Final deterministic gate before a paid per-anchor visual-spec call.
 * Preliminary planner flags cannot make pure palette/style anchors billable.
 */
export function assessAssetVisualSpecEligibility(
  anchor: VideoConsistencyAnchor,
): AssetVisualSpecEligibility {
  const normalized = normalizeAnchorSemantics(anchor);
  if (normalized.type === "palette_mood") {
    return { anchor: normalized, eligible: false, reason: "palette_or_mood_only" };
  }
  if (normalized.type === "style") {
    return { anchor: normalized, eligible: false, reason: "rendering_style_only" };
  }
  if (!normalized.needsReferenceImage) {
    return { anchor: normalized, eligible: false, reason: "reference_image_not_required" };
  }
  if (!isReferenceImageEligibleAnchor(normalized)) {
    return { anchor: normalized, eligible: false, reason: "not_reference_eligible" };
  }
  return { anchor: normalized, eligible: true, reason: "eligible_visible_asset" };
}

export function anchorReferenceUsagePolicy(
  anchor: Pick<VideoConsistencyAnchor, "type">,
): AnchorReferenceUsagePolicy {
  if (anchor.type === "palette_mood") {
    return {
      role: "palette_only",
      inherit: ["palette", "saturation", "color_temperature", "lighting_mood"],
      forbidInherit: ["space_layout", "camera_axis", "background_geometry", "graphic_motif"],
    };
  }
  if (anchor.type === "style") {
    return {
      role: "style_only",
      inherit: ["rendering_style", "texture", "palette"],
      forbidInherit: ["space_layout", "camera_axis", "background_geometry", "graphic_motif"],
    };
  }
  if (anchor.type === "graphic_backdrop") {
    return {
      role: "graphic_backdrop",
      inherit: ["graphic_motif", "palette", "texture"],
      forbidInherit: ["space_layout", "camera_axis", "background_geometry"],
    };
  }
  if (anchor.type === "location" || anchor.type === "space_layout") {
    return {
      role: "scene_layout",
      inherit: ["space_layout", "camera_axis", "background_geometry", "lighting_mood"],
      forbidInherit: ["identity", "product_geometry"],
    };
  }
  return {
    role: "hard_identity",
    inherit: ["identity", "product_geometry"],
    forbidInherit: ["space_layout", "camera_axis", "background_geometry"],
  };
}

export function anchorSemanticText(anchor: VideoConsistencyAnchor): string {
  const contract = anchor.assetImageContract;
  return [
    anchor.displayNameZh,
    anchor.displayNameEn,
    anchor.descriptionZh,
    anchor.descriptionEn,
    anchor.imagePromptZh,
    anchor.imagePromptEn,
    contract?.subjectDescription,
    contract?.environment?.background,
    contract?.environment?.foreground,
    contract?.environment?.midground,
    contract?.environment?.backgroundLayer,
    ...(contract?.environment?.spatialRelationships ?? []),
    ...(contract?.palette ?? []),
  ].filter(Boolean).join(" ");
}

export function sanitizePlanSoftAnchorVisibility<T>(planValue: T): {
  plan: T;
  reclassifiedAnchorIds: string[];
  removedReferenceKeyframeNos: number[];
} {
  if (!isRecord(planValue)) {
    return { plan: planValue, reclassifiedAnchorIds: [], removedReferenceKeyframeNos: [] };
  }
  const plan = clone(planValue) as Record<string, unknown>;
  const planningManifest = record(plan.planningManifest ?? plan.planning_manifest);
  const directManifest = record(plan.consistencyManifest ?? plan.consistency_manifest);
  const nestedManifest = record(planningManifest.consistencyManifest ?? planningManifest.consistency_manifest);
  const manifest = Object.keys(directManifest).length ? directManifest : nestedManifest;
  const anchors = arrayRecords(manifest.anchors);
  const normalizedAnchors = anchors.map((source) => ({
    ...source,
    ...normalizeAnchorSemantics(anchorFromUnknown(source)),
  }));
  const softIds = new Set(
    normalizedAnchors
      .filter((anchor) => !isVisibleEvidenceAnchor(anchor))
      .map((anchor) => anchor.id)
      .filter(Boolean),
  );
  const reclassifiedAnchorIds = normalizedAnchors
    .filter((anchor, index) => anchor.type !== anchors[index]?.type)
    .map((anchor) => anchor.id);
  const nextManifest = { ...manifest, anchors: normalizedAnchors };
  plan.consistencyManifest = nextManifest;
  delete plan.consistency_manifest;
  if (Object.keys(planningManifest).length) {
    planningManifest.consistencyManifest = nextManifest;
    delete planningManifest.consistency_manifest;
    plan.planningManifest = planningManifest;
    delete plan.planning_manifest;
  }

  const references = arrayRecords(plan.consistencyReferences ?? plan.consistency_references);
  const removedReferenceKeyframeNos: number[] = [];
  const filteredReferences = references.filter((reference) => {
    const anchorId = text(reference.anchorId ?? reference.anchor_id);
    const remove = Boolean(anchorId && softIds.has(anchorId));
    if (remove) {
      const keyframeNo = Number(reference.keyframeNo ?? reference.keyframe_no);
      if (Number.isInteger(keyframeNo)) removedReferenceKeyframeNos.push(keyframeNo);
    }
    return !remove;
  });
  if (Array.isArray(plan.consistencyReferences) || Array.isArray(plan.consistency_references)) {
    plan.consistencyReferences = filteredReferences;
    delete plan.consistency_references;
  }

  const assetLibrary = record(plan.assetLibrary ?? plan.asset_library);
  if (Object.keys(assetLibrary).length) {
    assetLibrary.items = arrayRecords(assetLibrary.items).filter((item) => {
      const anchorId = text(item.anchorId ?? item.anchor_id);
      return !anchorId || !softIds.has(anchorId);
    });
    plan.assetLibrary = assetLibrary;
    delete plan.asset_library;
  }

  sanitizeVisibilityFields(plan, softIds);
  const warnings = stringArray(plan.plannerWarnings ?? plan.planner_warnings);
  const migrationWarning = reclassifiedAnchorIds.length
    ? `Reclassified abstract palette/mood anchors as soft non-scene guides: ${reclassifiedAnchorIds.join(", ")}. Existing keyframe environment prose was preserved.`
    : "";
  if (migrationWarning && !warnings.includes(migrationWarning)) warnings.push(migrationWarning);
  if (warnings.length) {
    plan.plannerWarnings = warnings;
    delete plan.planner_warnings;
  }
  return {
    plan: plan as T,
    reclassifiedAnchorIds,
    removedReferenceKeyframeNos,
  };
}

export function purgePlanSoftAnchorConflicts<T>(planValue: T): {
  plan: T;
  softAnchorIds: string[];
  removedReferenceKeyframeNos: number[];
  removedArtifactIds: string[];
  removedTransitionArtifactIds: string[];
} {
  const sanitized = sanitizePlanSoftAnchorVisibility(planValue);
  if (!isRecord(sanitized.plan)) {
    return {
      plan: sanitized.plan,
      softAnchorIds: [],
      removedReferenceKeyframeNos: sanitized.removedReferenceKeyframeNos,
      removedArtifactIds: [],
      removedTransitionArtifactIds: [],
    };
  }
  const plan = sanitized.plan as Record<string, unknown>;
  const manifest = record(plan.consistencyManifest);
  const anchors = arrayRecords(manifest.anchors);
  const softAnchors = anchors
    .map(anchorFromUnknown)
    .filter((anchor) => !isVisibleEvidenceAnchor(anchor));
  const softAnchorIds = new Set(softAnchors.map((anchor) => anchor.id).filter(Boolean));
  const softDisplayNames = new Set(
    softAnchors
      .flatMap((anchor) => [anchor.displayNameZh, anchor.displayNameEn])
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const removedArtifactIds = new Set(
    sanitized.removedReferenceKeyframeNos.flatMap((keyframeNo) => [
      `consistency_reference:${keyframeNo}`,
      `consistency_reference:${keyframeNo}:image`,
      `consistency_reference:${keyframeNo}:reference_selection`,
      `consistency_reference:${keyframeNo}:prompt`,
    ]),
  );

  const cameraGraph = record(plan.cameraGraph ?? plan.camera_graph);
  const softCameraIds = new Set<string>();
  if (Array.isArray(cameraGraph.cameras)) {
    cameraGraph.cameras = cameraGraph.cameras.map((rawCamera) => {
      if (!isRecord(rawCamera)) return rawCamera;
      const camera = { ...rawCamera };
      const locationId = text(camera.locationId ?? camera.location_id);
      if (locationId && softAnchorIds.has(locationId)) {
        const cameraId = text(camera.cameraId ?? camera.camera_id);
        if (cameraId) softCameraIds.add(cameraId);
        delete camera.locationId;
        delete camera.location_id;
      }
      return camera;
    });
    plan.cameraGraph = cameraGraph;
    delete plan.camera_graph;
  }

  const removedTransitionArtifactIds: string[] = [];
  for (const key of ["transitionReferenceArtifacts", "transition_reference_artifacts"]) {
    if (!Array.isArray(plan[key])) continue;
    plan.transitionReferenceArtifacts = arrayRecords(plan[key]).filter((artifact) => {
      const remove = softCameraIds.has(text(artifact.toCameraId ?? artifact.to_camera_id))
        || !Number.isInteger(Number(artifact.parentKeyframeNo ?? artifact.parent_keyframe_no));
      if (remove) {
        const id = text(artifact.id ?? artifact.artifactId ?? artifact.artifact_id);
        if (id) removedTransitionArtifactIds.push(id);
      }
      return !remove;
    });
    delete plan.transition_reference_artifacts;
  }
  for (const key of ["transitionReferencePlan", "transition_reference_plan"]) {
    if (!Array.isArray(plan[key])) continue;
    plan.transitionReferencePlan = arrayRecords(plan[key]).filter((request) =>
      !softCameraIds.has(text(request.toCameraId ?? request.to_camera_id ?? request.cameraId ?? request.camera_id))
    );
    delete plan.transition_reference_plan;
  }

  for (const key of ["referenceSelectionOutputs", "reference_selection_outputs"]) {
    if (!Array.isArray(plan[key])) continue;
    plan.referenceSelectionOutputs = arrayRecords(plan[key]).filter((item) =>
      !removedArtifactIds.has(text(item.targetArtifactId ?? item.target_artifact_id))
    );
    delete plan.reference_selection_outputs;
  }
  for (const key of ["promptDebugArtifacts", "prompt_debug_artifacts"]) {
    if (!Array.isArray(plan[key])) continue;
    plan.promptDebugArtifacts = arrayRecords(plan[key]).filter((item) =>
      !removedArtifactIds.has(text(item.targetArtifactId ?? item.target_artifact_id))
    );
    delete plan.prompt_debug_artifacts;
  }
  for (const key of ["generationQualityReports", "generation_quality_reports"]) {
    if (!Array.isArray(plan[key])) continue;
    plan.generationQualityReports = arrayRecords(plan[key]).filter((item) =>
      !removedArtifactIds.has(text(item.assetId ?? item.asset_id ?? item.targetArtifactId ?? item.target_artifact_id))
    );
    delete plan.generation_quality_reports;
  }

  const artifactMetadata = record(plan.artifactMetadata ?? plan.artifact_metadata);
  for (const artifactId of [...removedArtifactIds, ...removedTransitionArtifactIds]) {
    delete artifactMetadata[artifactId];
  }
  if (Object.keys(artifactMetadata).length) plan.artifactMetadata = artifactMetadata;
  delete plan.artifact_metadata;

  purgeSoftReferences(plan, {
    softAnchorIds,
    softDisplayNames,
    removedArtifactIds: new Set([...removedArtifactIds, ...removedTransitionArtifactIds]),
    removedMediaUrls: new Set(),
  });
  const assetContract = record(plan.assetContract ?? plan.asset_contract);
  if (Object.keys(assetContract).length) {
    delete assetContract.referenceFactFingerprint;
    delete assetContract.reference_fact_fingerprint;
    plan.assetContract = assetContract;
    delete plan.asset_contract;
  }

  return {
    plan: plan as T,
    softAnchorIds: [...softAnchorIds],
    removedReferenceKeyframeNos: sanitized.removedReferenceKeyframeNos,
    removedArtifactIds: [...removedArtifactIds],
    removedTransitionArtifactIds,
  };
}

export function purgeSoftAnchorReferencesFromValue<T>(
  value: T,
  options: {
    softAnchorIds: string[];
    softDisplayNames?: string[];
    removedArtifactIds?: string[];
    removedMediaUrls?: string[];
  },
): T {
  const next = clone(value);
  purgeSoftReferences(next, {
    softAnchorIds: new Set(options.softAnchorIds),
    softDisplayNames: new Set(options.softDisplayNames ?? []),
    removedArtifactIds: new Set(options.removedArtifactIds ?? []),
    removedMediaUrls: new Set(options.removedMediaUrls ?? []),
  });
  return next;
}

function purgeSoftReferences(
  value: unknown,
  context: {
    softAnchorIds: Set<string>;
    softDisplayNames: Set<string>;
    removedArtifactIds: Set<string>;
    removedMediaUrls: Set<string>;
  },
): void {
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const item = value[index];
      if (isRecord(item) && recordDirectlyReferencesSoftAnchor(item, context)) {
        value.splice(index, 1);
        continue;
      }
      purgeSoftReferences(item, context);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if ((key === "locationId" || key === "location_id") && typeof child === "string" && context.softAnchorIds.has(child)) {
      delete value[key];
      continue;
    }
    if (key === "expectedVisibleEntities" || key === "expected_visible_entities") {
      if (Array.isArray(child)) {
        value[key] = child.filter((item) =>
          typeof item !== "string"
          || ![...context.softDisplayNames].some((name) => item.includes(name))
        );
      }
      continue;
    }
    if (Array.isArray(child)) {
      value[key] = child.filter((item) =>
        typeof item !== "string"
        || (!context.softAnchorIds.has(item) && !context.removedArtifactIds.has(item) && !context.removedMediaUrls.has(item))
      );
      purgeSoftReferences(value[key], context);
      continue;
    }
    if (typeof child === "string" && !isIdentityField(key)) {
      value[key] = scrubSoftAnchorTokens(child, context.softAnchorIds, context.removedArtifactIds, context.removedMediaUrls);
      continue;
    }
    purgeSoftReferences(child, context);
  }
}

function recordDirectlyReferencesSoftAnchor(
  value: Record<string, unknown>,
  context: {
    softAnchorIds: Set<string>;
    removedArtifactIds: Set<string>;
  },
): boolean {
  const anchorId = text(value.anchorId ?? value.anchor_id ?? value.sourceAnchorId ?? value.source_anchor_id);
  if (anchorId && context.softAnchorIds.has(anchorId)) return true;
  const artifactId = text(value.artifactId ?? value.artifact_id);
  if (artifactId && context.removedArtifactIds.has(artifactId)) return true;
  const referenceAnchorIds = stringArray(value.referenceAnchorIds ?? value.reference_anchor_ids);
  return referenceAnchorIds.some((id) => context.softAnchorIds.has(id));
}

function scrubSoftAnchorTokens(
  source: string,
  softAnchorIds: Set<string>,
  removedArtifactIds: Set<string>,
  removedMediaUrls: Set<string>,
): string {
  let result = source;
  for (const token of [...softAnchorIds, ...removedArtifactIds, ...removedMediaUrls]) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(`\\(\\s*${escaped}\\s*\\)`, "g"), "")
      .replace(new RegExp(escaped, "g"), "");
  }
  return result.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

function isIdentityField(key: string): boolean {
  return key === "id"
    || key === "anchorId"
    || key === "anchor_id"
    || key === "sourceAnchorId"
    || key === "source_anchor_id";
}

function sanitizeVisibilityFields(value: unknown, softIds: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => sanitizeVisibilityFields(item, softIds));
    return;
  }
  if (!isRecord(value)) return;
  const visibilityKeys = [
    "requiredAnchorIds",
    "required_anchor_ids",
    "visibleAnchorIds",
    "visible_anchor_ids",
    "usesConsistencyAnchors",
    "uses_consistency_anchors",
    "declaredAnchorIds",
    "declared_anchor_ids",
    "derivedAnchorIds",
    "derived_anchor_ids",
    "effectiveRequiredAnchorIds",
    "effective_required_anchor_ids",
    "requiredVisibleEvidence",
    "required_visible_evidence",
    "approvedAssetReferenceIds",
    "approved_asset_reference_ids",
    "expectedAnchorIds",
    "expected_anchor_ids",
  ];
  for (const key of visibilityKeys) {
    if (!Array.isArray(value[key])) continue;
    value[key] = value[key].filter((item) => typeof item !== "string" || !softIds.has(item));
  }
  for (const child of Object.values(value)) sanitizeVisibilityFields(child, softIds);
}

function anchorFromUnknown(source: Record<string, unknown>): VideoConsistencyAnchor {
  const contract = record(source.assetImageContract ?? source.asset_image_contract);
  const composition = record(contract.composition);
  const environment = record(contract.environment);
  const lighting = record(contract.lighting);
  return {
    id: text(source.id ?? source.anchorId ?? source.anchor_id),
    type: (text(source.type) || "custom") as VideoConsistencyAnchorType,
    displayNameZh: text(source.displayNameZh ?? source.display_name_zh),
    displayNameEn: text(source.displayNameEn ?? source.display_name_en),
    mustStayConsistent: source.mustStayConsistent !== false && source.must_stay_consistent !== false,
    needsReferenceImage: source.needsReferenceImage === true || source.needs_reference_image === true,
    referenceStrength: text(source.referenceStrength ?? source.reference_strength) as VideoConsistencyAnchor["referenceStrength"],
    descriptionZh: text(source.descriptionZh ?? source.description_zh),
    descriptionEn: text(source.descriptionEn ?? source.description_en),
    imagePromptZh: text(source.imagePromptZh ?? source.image_prompt_zh),
    imagePromptEn: text(source.imagePromptEn ?? source.image_prompt_en),
    assetImageContract: Object.keys(contract).length ? {
      subjectCount: numberOrUndefined(contract.subjectCount ?? contract.subject_count),
      subjectDescription: text(contract.subjectDescription ?? contract.subject_description),
      composition: {
        framing: text(composition.framing),
        cameraAngle: text(composition.cameraAngle ?? composition.camera_angle),
        placement: text(composition.placement),
        occupancy: text(composition.occupancy),
      },
      environment: {
        background: text(environment.background),
        foreground: text(environment.foreground),
        midground: text(environment.midground),
        backgroundLayer: text(environment.backgroundLayer ?? environment.background_layer),
        spatialRelationships: stringArray(environment.spatialRelationships ?? environment.spatial_relationships),
      },
      lighting: {
        direction: text(lighting.direction),
        quality: text(lighting.quality),
        colorTemperature: text(lighting.colorTemperature ?? lighting.color_temperature),
      },
      palette: stringArray(contract.palette),
      materialDetails: stringArray(contract.materialDetails ?? contract.material_details),
      intrinsicDetails: stringArray(contract.intrinsicDetails ?? contract.intrinsic_details),
      forbiddenElements: stringArray(contract.forbiddenElements ?? contract.forbidden_elements),
      acceptanceCriteria: stringArray(contract.acceptanceCriteria ?? contract.acceptance_criteria),
    } : undefined,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
