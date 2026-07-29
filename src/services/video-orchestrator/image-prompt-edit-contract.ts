import type { ImagePromptEditContract, VideoAssetImageContract } from "./types";
import { normalizePlayingCardContract } from "./playing-card-contract";

export type ImagePromptContractLocale = "zh" | "en";
export type { ImagePromptEditContract } from "./types";

export function createImagePromptEditContract(params: {
  imagePromptZh?: string;
  imagePromptEn?: string;
  providerPrompt?: string;
  assetContract?: VideoAssetImageContract;
  locale?: ImagePromptContractLocale;
}): ImagePromptEditContract {
  const source = params.assetContract;
  const sourceDescription = source?.subjectDescription?.trim() ?? "";
  const sourceIsZh = containsCjk(sourceDescription);
  return {
    version: "image-prompt-edit-v1",
    lastEditedLocale: params.locale ?? "zh",
    localizedDescription: {
      zh: params.imagePromptZh?.trim() || (containsCjk(params.providerPrompt ?? "") ? params.providerPrompt!.trim() : ""),
      en: params.imagePromptEn?.trim() || (!containsCjk(params.providerPrompt ?? "") ? params.providerPrompt?.trim() ?? "" : ""),
    },
    subject: {
      count: finiteNonNegativeInteger(source?.subjectCount),
      descriptionZh: sourceIsZh ? sourceDescription : "",
      descriptionEn: sourceIsZh ? "" : sourceDescription,
    },
    composition: {
      framing: source?.composition?.framing?.trim() ?? "",
      cameraAngle: source?.composition?.cameraAngle?.trim() ?? "",
      placement: source?.composition?.placement?.trim() ?? "",
      occupancy: source?.composition?.occupancy?.trim() ?? "",
    },
    environment: {
      backgroundZh: containsCjk(source?.environment?.background ?? "") ? source?.environment?.background?.trim() ?? "" : "",
      backgroundEn: containsCjk(source?.environment?.background ?? "") ? "" : source?.environment?.background?.trim() ?? "",
      foreground: source?.environment?.foreground?.trim() ?? "",
      midground: source?.environment?.midground?.trim() ?? "",
      backgroundLayer: source?.environment?.backgroundLayer?.trim() ?? "",
      spatialRelationships: cleanStrings(source?.environment?.spatialRelationships),
    },
    lighting: {
      direction: source?.lighting?.direction?.trim() ?? "",
      quality: source?.lighting?.quality?.trim() ?? "",
      colorTemperature: source?.lighting?.colorTemperature?.trim() ?? "",
    },
    palette: cleanStrings(source?.palette),
    materialDetails: cleanStrings(source?.materialDetails),
    intrinsicDetails: cleanStrings(source?.intrinsicDetails),
    forbiddenElements: cleanStrings(source?.forbiddenElements),
    acceptanceCriteria: cleanStrings(source?.acceptanceCriteria),
    creativeOverride: { zh: "", en: "" },
  };
}

export function normalizeVideoAssetImageContract(value: unknown): VideoAssetImageContract | undefined {
  if (!isRecord(value)) return undefined;
  const composition = record(value.composition);
  const environment = record(value.environment);
  const lighting = record(value.lighting);
  return {
    subjectCount: finiteNonNegativeInteger(value.subjectCount ?? value.subject_count),
    subjectDescription: stringValue(value.subjectDescription ?? value.subject_description),
    composition: {
      framing: stringValue(composition.framing),
      cameraAngle: stringValue(composition.cameraAngle ?? composition.camera_angle),
      placement: stringValue(composition.placement),
      occupancy: stringValue(composition.occupancy),
    },
    environment: {
      background: stringValue(environment.background),
      foreground: stringValue(environment.foreground),
      midground: stringValue(environment.midground),
      backgroundLayer: stringValue(environment.backgroundLayer ?? environment.background_layer),
      spatialRelationships: cleanStrings(environment.spatialRelationships ?? environment.spatial_relationships),
    },
    lighting: {
      direction: stringValue(lighting.direction),
      quality: stringValue(lighting.quality),
      colorTemperature: stringValue(lighting.colorTemperature ?? lighting.color_temperature),
    },
    palette: cleanStrings(value.palette),
    materialDetails: cleanStrings(value.materialDetails ?? value.material_details),
    intrinsicDetails: cleanStrings(value.intrinsicDetails ?? value.intrinsic_details),
    forbiddenElements: cleanStrings(value.forbiddenElements ?? value.forbidden_elements),
    acceptanceCriteria: cleanStrings(value.acceptanceCriteria ?? value.acceptance_criteria),
    playingCards: normalizePlayingCardContract(value.playingCards ?? value.playing_cards),
  };
}

export function applyImagePromptEditContractToAssetContract(
  contract: ImagePromptEditContract,
  previous?: VideoAssetImageContract,
): VideoAssetImageContract {
  const locale = contract.lastEditedLocale;
  return {
    ...previous,
    subjectCount: contract.subject.count,
    subjectDescription: locale === "zh"
      ? contract.subject.descriptionZh
      : contract.subject.descriptionEn,
    composition: { ...contract.composition },
    environment: {
      background: locale === "zh"
        ? contract.environment.backgroundZh
        : contract.environment.backgroundEn,
      foreground: contract.environment.foreground,
      midground: contract.environment.midground,
      backgroundLayer: contract.environment.backgroundLayer,
      spatialRelationships: [...contract.environment.spatialRelationships],
    },
    lighting: { ...contract.lighting },
    palette: [...contract.palette],
    materialDetails: [...contract.materialDetails],
    intrinsicDetails: [...contract.intrinsicDetails],
    forbiddenElements: [...contract.forbiddenElements],
    acceptanceCriteria: [...contract.acceptanceCriteria],
  };
}

export function normalizeImagePromptEditContract(
  value: unknown,
  fallback?: Parameters<typeof createImagePromptEditContract>[0],
): ImagePromptEditContract {
  if (!isRecord(value) || value.version !== "image-prompt-edit-v1") {
    return createImagePromptEditContract(fallback ?? {});
  }
  const localized = record(value.localizedDescription);
  const subject = record(value.subject);
  const composition = record(value.composition);
  const environment = record(value.environment);
  const lighting = record(value.lighting);
  const creativeOverride = record(value.creativeOverride);
  return {
    version: "image-prompt-edit-v1",
    lastEditedLocale: value.lastEditedLocale === "en" ? "en" : "zh",
    localizedDescription: {
      zh: stringValue(localized.zh),
      en: stringValue(localized.en),
    },
    subject: {
      count: finiteNonNegativeInteger(subject.count),
      descriptionZh: stringValue(subject.descriptionZh),
      descriptionEn: stringValue(subject.descriptionEn),
    },
    composition: {
      framing: stringValue(composition.framing),
      cameraAngle: stringValue(composition.cameraAngle),
      placement: stringValue(composition.placement),
      occupancy: stringValue(composition.occupancy),
    },
    environment: {
      backgroundZh: stringValue(environment.backgroundZh),
      backgroundEn: stringValue(environment.backgroundEn),
      foreground: stringValue(environment.foreground),
      midground: stringValue(environment.midground),
      backgroundLayer: stringValue(environment.backgroundLayer),
      spatialRelationships: cleanStrings(environment.spatialRelationships),
    },
    lighting: {
      direction: stringValue(lighting.direction),
      quality: stringValue(lighting.quality),
      colorTemperature: stringValue(lighting.colorTemperature),
    },
    palette: cleanStrings(value.palette),
    materialDetails: cleanStrings(value.materialDetails),
    intrinsicDetails: cleanStrings(value.intrinsicDetails),
    forbiddenElements: cleanStrings(value.forbiddenElements),
    acceptanceCriteria: cleanStrings(value.acceptanceCriteria),
    creativeOverride: {
      zh: stringValue(creativeOverride.zh),
      en: stringValue(creativeOverride.en),
    },
  };
}

export function updateLocalizedImagePromptDescription(
  contract: ImagePromptEditContract,
  locale: ImagePromptContractLocale,
  description: string,
): ImagePromptEditContract {
  return {
    ...contract,
    lastEditedLocale: locale,
    localizedDescription: {
      ...contract.localizedDescription,
      [locale]: description,
    },
  };
}

export function compileImagePromptDisplay(
  contract: ImagePromptEditContract,
  locale: ImagePromptContractLocale,
): string {
  const localized = contract.localizedDescription[locale].trim();
  if (localized) return localized;
  const subject = locale === "zh" ? contract.subject.descriptionZh : contract.subject.descriptionEn;
  const background = locale === "zh" ? contract.environment.backgroundZh : contract.environment.backgroundEn;
  const labels = locale === "zh"
    ? {
        subject: "主体",
        count: "数量",
        composition: "构图",
        environment: "环境",
        lighting: "光线",
        details: "固定细节",
        forbidden: "禁止出现",
        acceptance: "验收标准",
      }
    : {
        subject: "Subject",
        count: "Count",
        composition: "Composition",
        environment: "Environment",
        lighting: "Lighting",
        details: "Locked details",
        forbidden: "Forbidden",
        acceptance: "Acceptance",
      };
  const separator = locale === "zh" ? "；" : "; ";
  return [
    subject ? `${labels.subject}：${subject}` : "",
    contract.subject.count != null ? `${labels.count}：${contract.subject.count}` : "",
    joinNamed(labels.composition, Object.values(contract.composition), locale),
    joinNamed(labels.environment, [
      background,
      contract.environment.foreground,
      contract.environment.midground,
      contract.environment.backgroundLayer,
      ...contract.environment.spatialRelationships,
    ], locale),
    joinNamed(labels.lighting, Object.values(contract.lighting), locale),
    joinNamed(labels.details, [...contract.materialDetails, ...contract.intrinsicDetails], locale),
    joinNamed(labels.forbidden, contract.forbiddenElements, locale),
    joinNamed(labels.acceptance, contract.acceptanceCriteria, locale),
    contract.creativeOverride[locale].trim(),
  ].filter(Boolean).join(separator);
}

export function compileImagePromptForProvider(contract: ImagePromptEditContract): string {
  const locale = contract.lastEditedLocale;
  const executionDescription = contract.localizedDescription[locale].trim()
    || compileImagePromptDisplay(contract, locale);
  return [
    executionDescription,
    "IMAGE_GENERATION_CONTRACT_JSON:",
    JSON.stringify({
      version: contract.version,
      subject: {
        count: contract.subject.count,
        description: locale === "zh" ? contract.subject.descriptionZh : contract.subject.descriptionEn,
      },
      composition: contract.composition,
      environment: {
        background: locale === "zh" ? contract.environment.backgroundZh : contract.environment.backgroundEn,
        foreground: contract.environment.foreground,
        midground: contract.environment.midground,
        backgroundLayer: contract.environment.backgroundLayer,
        spatialRelationships: contract.environment.spatialRelationships,
      },
      lighting: contract.lighting,
      palette: contract.palette,
      materialDetails: contract.materialDetails,
      intrinsicDetails: contract.intrinsicDetails,
      forbiddenElements: contract.forbiddenElements,
      acceptanceCriteria: contract.acceptanceCriteria,
      creativeOverride: contract.creativeOverride[locale],
    }),
  ].filter(Boolean).join("\n");
}

export function validateImagePromptEditContract(contract: ImagePromptEditContract): string[] {
  const errors: string[] = [];
  if (!contract.localizedDescription.zh.trim() && !contract.subject.descriptionZh.trim()) {
    errors.push("missing_chinese_display_description");
  }
  if (!contract.localizedDescription.en.trim() && !contract.subject.descriptionEn.trim()) {
    errors.push("missing_english_display_description");
  }
  if (contract.subject.count != null && (!Number.isInteger(contract.subject.count) || contract.subject.count < 0)) {
    errors.push("invalid_subject_count");
  }
  return errors;
}

function joinNamed(label: string, values: string[], locale: ImagePromptContractLocale): string {
  const items = values.map((value) => value.trim()).filter(Boolean);
  if (!items.length) return "";
  return `${label}${locale === "zh" ? "：" : ": "}${items.join(locale === "zh" ? "，" : ", ")}`;
}

function cleanStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)))
    : [];
}

function finiteNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
