import type {
  VideoAssetImageContract,
  VideoConsistencyAnchor,
  VideoConsistencyAnchorType,
} from "./types";

export interface AssetImageContractIssue {
  anchorId: string;
  field: string;
  message: string;
}

const GENERIC_ONLY_PHRASES = [
  "固定空间布局",
  "光线方向",
  "色彩氛围",
  "主要背景结构",
  "空间关系",
  "清晰呈现",
  "高质量",
  "细节丰富",
  "明亮卡通风格",
  "cinematic",
  "high quality",
  "detailed",
  "fixed spatial layout",
  "lighting direction",
  "color atmosphere",
];

const EXECUTABLE_ASSET_TYPES = new Set<VideoConsistencyAnchorType>([
  "person",
  "product",
  "prop",
  "location",
  "task_object",
  "vehicle",
  "food",
  "space_layout",
]);

function present(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length >= 3 : value != null;
}

function concrete(value: unknown): boolean {
  if (!present(value)) return false;
  if (typeof value !== "string") return true;
  const normalized = value.trim().toLowerCase();
  return !GENERIC_ONLY_PHRASES.some((phrase) => {
    const generic = phrase.toLowerCase();
    return normalized === generic || (normalized.includes(generic) && normalized.length <= generic.length + 6);
  });
}

function listSize(value: unknown): number {
  return Array.isArray(value) ? value.filter(concrete).length : 0;
}

function addMissing(
  issues: AssetImageContractIssue[],
  anchor: VideoConsistencyAnchor,
  field: string,
  value: unknown,
): void {
  if (!concrete(value)) {
    issues.push({ anchorId: anchor.id, field, message: `${field} is missing or too vague` });
  }
}

export function validateAssetImageContract(anchor: VideoConsistencyAnchor): AssetImageContractIssue[] {
  if (!anchor.needsReferenceImage || !EXECUTABLE_ASSET_TYPES.has(anchor.type)) return [];
  const contract = anchor.assetImageContract;
  if (!contract) {
    return [{ anchorId: anchor.id, field: "assetImageContract", message: "structured asset image contract is missing" }];
  }

  const issues: AssetImageContractIssue[] = [];
  addMissing(issues, anchor, "subjectDescription", contract.subjectDescription);
  addMissing(issues, anchor, "composition.framing", contract.composition?.framing);
  addMissing(issues, anchor, "composition.cameraAngle", contract.composition?.cameraAngle);
  addMissing(issues, anchor, "composition.placement", contract.composition?.placement);
  addMissing(issues, anchor, "composition.occupancy", contract.composition?.occupancy);
  addMissing(issues, anchor, "environment.background", contract.environment?.background);
  addMissing(issues, anchor, "lighting.direction", contract.lighting?.direction);
  addMissing(issues, anchor, "lighting.quality", contract.lighting?.quality);

  if (!Number.isInteger(contract.subjectCount) || (contract.subjectCount ?? 0) < 0) {
    issues.push({ anchorId: anchor.id, field: "subjectCount", message: "subjectCount must be an explicit non-negative integer" });
  }

  const sceneLike = anchor.type === "location" || anchor.type === "space_layout";
  if (sceneLike) {
    addMissing(issues, anchor, "environment.foreground", contract.environment?.foreground);
    addMissing(issues, anchor, "environment.midground", contract.environment?.midground);
    addMissing(issues, anchor, "environment.backgroundLayer", contract.environment?.backgroundLayer);
    if (listSize(contract.environment?.spatialRelationships) < 2) {
      issues.push({ anchorId: anchor.id, field: "environment.spatialRelationships", message: "scene assets require at least two explicit relative positions or distances" });
    }
    if (listSize(contract.palette) < 2) {
      issues.push({ anchorId: anchor.id, field: "palette", message: "scene assets require at least two named palette colors" });
    }
  } else {
    if ((contract.subjectCount ?? 0) < 1) {
      issues.push({ anchorId: anchor.id, field: "subjectCount", message: "isolated subject assets require at least one explicit subject" });
    }
    if (anchor.type === "person" && contract.subjectCount !== 1) {
      issues.push({ anchorId: anchor.id, field: "subjectCount", message: "person reference assets must contain exactly one character" });
    }
    const requiredIntrinsicDetails = anchor.type === "person" ? 3 : 2;
    if (listSize(contract.intrinsicDetails) + listSize(contract.materialDetails) < requiredIntrinsicDetails) {
      issues.push({ anchorId: anchor.id, field: "intrinsicDetails", message: `asset requires at least ${requiredIntrinsicDetails} concrete identity, geometry, marking, clothing, or material details` });
    }
  }

  if (listSize(contract.forbiddenElements) < (sceneLike ? 3 : 5)) {
    issues.push({ anchorId: anchor.id, field: "forbiddenElements", message: "forbiddenElements does not define a usable isolation boundary" });
  }
  if (listSize(contract.acceptanceCriteria) < 2) {
    issues.push({ anchorId: anchor.id, field: "acceptanceCriteria", message: "at least two visually verifiable acceptance criteria are required" });
  }

  return issues;
}

export function validatePlanningAssetImageContracts(anchors: VideoConsistencyAnchor[]): AssetImageContractIssue[] {
  return anchors.flatMap(validateAssetImageContract);
}

function join(values: Array<string | undefined>, separator = "；"): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}

export function compileAssetImagePromptZh(anchor: VideoConsistencyAnchor): string {
  const contract = anchor.assetImageContract;
  if (!contract) return anchor.imagePromptZh?.trim() || anchor.descriptionZh?.trim() || "";
  const sceneLike = anchor.type === "location" || anchor.type === "space_layout";
  const subjectCount = sceneLike
    ? `可见主体数量：${contract.subjectCount ?? 0}`
    : `严格只显示 ${contract.subjectCount ?? 1} 个主体`;
  return join([
    `资产参考图，目标资产：${anchor.displayNameZh || anchor.id}`,
    `${subjectCount}，${contract.subjectDescription ?? ""}`,
    `构图：${join([
      contract.composition?.framing,
      contract.composition?.cameraAngle,
      contract.composition?.placement,
      contract.composition?.occupancy,
    ], "，")}`,
    `空间：${join([
      `背景=${contract.environment?.background ?? ""}`,
      contract.environment?.foreground ? `前景=${contract.environment.foreground}` : "",
      contract.environment?.midground ? `中景=${contract.environment.midground}` : "",
      contract.environment?.backgroundLayer ? `远景=${contract.environment.backgroundLayer}` : "",
      ...(contract.environment?.spatialRelationships ?? []),
    ], "，")}`,
    `光线：${join([
      contract.lighting?.direction,
      contract.lighting?.quality,
      contract.lighting?.colorTemperature,
    ], "，")}`,
    contract.palette?.length ? `固定色板：${contract.palette.join("、")}` : "",
    contract.materialDetails?.length ? `材质与表面：${contract.materialDetails.join("、")}` : "",
    contract.intrinsicDetails?.length ? `不可漂移的固有细节：${contract.intrinsicDetails.join("、")}` : "",
    `禁止出现：${(contract.forbiddenElements ?? []).join("、")}`,
    `验收标准：${(contract.acceptanceCriteria ?? []).join("；")}`,
  ]);
}

export function compileAssetImagePromptEn(anchor: VideoConsistencyAnchor): string {
  const contract = anchor.assetImageContract;
  if (!contract) return anchor.imagePromptEn?.trim() || anchor.descriptionEn?.trim() || "";
  return join([
    `Asset reference sheet for ${anchor.displayNameEn || anchor.id}`,
    `Exact visible subject count: ${contract.subjectCount ?? 0}. ${contract.subjectDescription ?? ""}`,
    `Composition: ${join([
      contract.composition?.framing,
      contract.composition?.cameraAngle,
      contract.composition?.placement,
      contract.composition?.occupancy,
    ], ", ")}`,
    `Environment: ${join([
      `background=${contract.environment?.background ?? ""}`,
      contract.environment?.foreground ? `foreground=${contract.environment.foreground}` : "",
      contract.environment?.midground ? `midground=${contract.environment.midground}` : "",
      contract.environment?.backgroundLayer ? `far background=${contract.environment.backgroundLayer}` : "",
      ...(contract.environment?.spatialRelationships ?? []),
    ], ", ")}`,
    `Lighting: ${join([
      contract.lighting?.direction,
      contract.lighting?.quality,
      contract.lighting?.colorTemperature,
    ], ", ")}`,
    contract.palette?.length ? `Locked palette: ${contract.palette.join(", ")}` : "",
    contract.materialDetails?.length ? `Materials and surfaces: ${contract.materialDetails.join(", ")}` : "",
    contract.intrinsicDetails?.length ? `Identity-locked details: ${contract.intrinsicDetails.join(", ")}` : "",
    `Forbidden: ${(contract.forbiddenElements ?? []).join(", ")}`,
    `Acceptance criteria: ${(contract.acceptanceCriteria ?? []).join("; ")}`,
  ]);
}
