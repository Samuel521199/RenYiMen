import type {
  VideoAssetImageContract,
  VideoConsistencyAnchor,
  VideoConsistencyAnchorType,
} from "./types";
import { ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS } from "@/lib/one-prompt-video-limits";
import {
  isPlayingCardAnchor,
  PlayingCardContractConflictError,
  validatePlayingCardContract,
} from "./playing-card-contract";

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

export const ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS = 2400;

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
  for (const conflict of validatePlayingCardContract(anchor)) {
    issues.push({
      anchorId: anchor.id,
      field: `playingCards.${conflict.field}`,
      message: `conflicting ${conflict.authority} values: ${conflict.values.join(" vs ")}`,
    });
  }
  const serializedContractLength = JSON.stringify(contract).length;
  if (serializedContractLength > ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS) {
    issues.push({
      anchorId: anchor.id,
      field: "assetImageContract",
      message: `structured contract is ${serializedContractLength} characters; the first-pass budget is ${ASSET_IMAGE_CONTRACT_MAX_JSON_CHARS}`,
    });
  }
  addMissing(issues, anchor, "subjectDescription", contract.subjectDescription);
  addMissing(issues, anchor, "composition.framing", contract.composition?.framing);
  addMissing(issues, anchor, "composition.cameraAngle", contract.composition?.cameraAngle);
  addMissing(issues, anchor, "composition.placement", contract.composition?.placement);
  addMissing(issues, anchor, "composition.occupancy", contract.composition?.occupancy);
  addMissing(issues, anchor, "environment.background", contract.environment?.background);
  addMissing(issues, anchor, "lighting.direction", contract.lighting?.direction);
  addMissing(issues, anchor, "lighting.quality", contract.lighting?.quality);
  if (anchor.type === "person") {
    addMissing(issues, anchor, "renderingStyle.medium", contract.renderingStyle?.medium);
    addMissing(issues, anchor, "renderingStyle.shading", contract.renderingStyle?.shading);
    addMissing(issues, anchor, "renderingStyle.edgeTreatment", contract.renderingStyle?.edgeTreatment);
    if (!contract.renderingStyle?.dimensionality) {
      issues.push({ anchorId: anchor.id, field: "renderingStyle.dimensionality", message: "person assets require an explicit 2d, 2.5d, 3d, or mixed dimensionality lock" });
    }
  }

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

/**
 * Production gate for reusable asset prompts.
 *
 * The structured contract and its compiled English prompt are the only
 * generation inputs. Chinese copy is presentation-only and must never block
 * planning, repair, retries, or provider submission.
 */
export function validatePlanningAssetExecutionPrompts(anchors: VideoConsistencyAnchor[]): AssetImageContractIssue[] {
  return anchors
    .filter((anchor) => anchor.needsReferenceImage)
    .flatMap((anchor) => {
      const issues: AssetImageContractIssue[] = [];
      if (!isEnglishPromptDisplayCopy(anchor.imagePromptEn)) {
        issues.push({ anchorId: anchor.id, field: "imagePromptEn", message: "English execution prompt must be complete and must not contain Chinese prose" });
      } else if ((anchor.imagePromptEn?.length ?? 0) > ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS) {
        issues.push({
          anchorId: anchor.id,
          field: "imagePromptEn",
          message: `imagePromptEn exceeds the ${ONE_PROMPT_IMAGE_PROMPT_GENERATION_TARGET_CHARS}-character planning budget`,
        });
      }
      return issues;
    });
}

function join(values: Array<string | undefined>, separator = "；"): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(separator);
}

export function isChinesePromptDisplayCopy(value: string | undefined): boolean {
  const prompt = value?.trim() ?? "";
  if (!/[\u3400-\u9fff]/.test(prompt)) return false;
  // Proper nouns such as TONGITS KING and model identifiers are allowed, but
  // a natural-language English clause indicates the execution contract leaked
  // into the Chinese presentation field.
  return !/(?:\b[A-Za-z][A-Za-z'-]*\b[\s,.:;]*){5,}/.test(prompt);
}

export function isEnglishPromptDisplayCopy(value: string | undefined): boolean {
  const prompt = value?.trim() ?? "";
  return /[A-Za-z]/.test(prompt) && !/[\u3400-\u9fff]/.test(prompt);
}

export function compileAssetImagePromptZh(anchor: VideoConsistencyAnchor): string {
  // Presentation-only legacy helper. Production code must use
  // compileAssetImagePromptEn and must not gate on this localized copy.
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
    contract.renderingStyle ? `渲染风格硬锁：${join([
      contract.renderingStyle.medium,
      contract.renderingStyle.dimensionality ? `维度=${contract.renderingStyle.dimensionality}` : "",
      contract.renderingStyle.shading ? `明暗塑造=${contract.renderingStyle.shading}` : "",
      contract.renderingStyle.edgeTreatment ? `边缘处理=${contract.renderingStyle.edgeTreatment}` : "",
      contract.renderingStyle.surfaceTreatment ? `表面质感=${contract.renderingStyle.surfaceTreatment}` : "",
      contract.renderingStyle.depthTreatment ? `空间深度=${contract.renderingStyle.depthTreatment}` : "",
      contract.renderingStyle.authority ? `依据=${contract.renderingStyle.authority}` : "",
      contract.renderingStyle.forbiddenDrift?.length ? `禁止漂移=${contract.renderingStyle.forbiddenDrift.join("、")}` : "",
    ], "，")}` : "",
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
  if (isPlayingCardAnchor(anchor)) {
    const conflicts = validatePlayingCardContract(anchor);
    if (conflicts.length) throw new PlayingCardContractConflictError(anchor.id, conflicts);
  }
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
    contract.renderingStyle ? `Hard rendering-style lock: ${join([
      contract.renderingStyle.medium,
      contract.renderingStyle.dimensionality ? `dimensionality=${contract.renderingStyle.dimensionality}` : "",
      contract.renderingStyle.shading ? `shading=${contract.renderingStyle.shading}` : "",
      contract.renderingStyle.edgeTreatment ? `edge treatment=${contract.renderingStyle.edgeTreatment}` : "",
      contract.renderingStyle.surfaceTreatment ? `surface treatment=${contract.renderingStyle.surfaceTreatment}` : "",
      contract.renderingStyle.depthTreatment ? `depth treatment=${contract.renderingStyle.depthTreatment}` : "",
      contract.renderingStyle.authority ? `authority=${contract.renderingStyle.authority}` : "",
      contract.renderingStyle.forbiddenDrift?.length ? `forbidden drift=${contract.renderingStyle.forbiddenDrift.join(", ")}` : "",
    ], ", ")}` : "",
    contract.palette?.length ? `Locked palette: ${contract.palette.join(", ")}` : "",
    contract.materialDetails?.length ? `Materials and surfaces: ${contract.materialDetails.join(", ")}` : "",
    contract.intrinsicDetails?.length ? `Identity-locked details: ${contract.intrinsicDetails.join(", ")}` : "",
    `Forbidden: ${(contract.forbiddenElements ?? []).join(", ")}`,
    `Acceptance criteria: ${(contract.acceptanceCriteria ?? []).join("; ")}`,
  ]);
}
