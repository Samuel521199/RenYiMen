import type { VideoAssetImageContract, VideoConsistencyAnchor, VideoAssetView } from "./types";

function clean(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function labelled(label: string, values: Array<string | undefined>): string {
  const content = unique(values).join(", ");
  return content ? `${label}=${content}` : "";
}

function targetFramingFromState(targetState: string | undefined): string {
  const state = clean(targetState);
  const match = state.match(/\b(full[- ]?body|medium close[- ]?up|close[- ]?up|waist[- ]?up|head[- ]?and[- ]?shoulders|three[- ]?quarter(?: body)?)\b/i);
  return match?.[1]?.replace(/-/g, " ") ?? "";
}

/**
 * A reference usage note declares authority and scope only. Identity details
 * belong to the single textual identity lock compiled into the image prompt.
 */
export function compactPersonReferenceUsageNote(targetId: string): string {
  return `HARD IDENTITY + HARD RENDERING STYLE reference for person asset ${targetId}. Authoritative for identity and rendering style only.`;
}

export function normalizePersonReferenceUsageNotes(
  notes: string[],
  targetId: string,
): string[] {
  return unique([
    ...notes.filter((note) =>
      !/HARD IDENTITY \+ HARD RENDERING STYLE reference for person asset/i.test(note)
      && !/^AUTHORITATIVE ANCHOR CONTRACTS\b/i.test(note.trim())
    ),
    compactPersonReferenceUsageNote(targetId),
  ]);
}

/**
 * character_state owns only the requested view, pose, expression and action.
 * It must not repeat stable identity, wardrobe or rendering facts.
 */
export function compactPersonCharacterState(
  characterState: string | undefined,
  assetView: VideoAssetView | string | undefined,
): string {
  const clauses = clean(characterState)
    .split(/[,;\n]+/)
    .map(clean)
    .filter(Boolean)
    .filter((clause) => !(
      /\b(?:same|preserve|match|copy|identical)\b.*\b(?:identity|face design|horn geometry|outfit|clothing|wardrobe|hairstyle|body proportions?|accessories|colors?|materials?|render(?:ing)?(?: style| medium)?)\b/i.test(clause)
      || /^(?:and\s+)?(?:same\s+)?(?:outfit|clothing|wardrobe|hairstyle|body proportions?|accessories|colors?|materials?|rendering style)[.!?]?$/i.test(clause)
    ));
  const view = clean(assetView);
  if (view && !clauses.some((clause) => new RegExp(`\\b${view.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(clause))) {
    clauses.unshift(`${view} view`);
  }
  return unique(clauses).join(", ");
}

/**
 * source_image_prompt owns composition only for a person asset. Stable
 * identity, wardrobe, palette, materials and rendering style are intentionally
 * excluded even if the legacy provider prompt serialized them.
 */
export function compilePersonCompositionPrompt(
  contract: VideoAssetImageContract | undefined,
  legacySourcePrompt: string,
  targetState?: string,
): string {
  if (contract) {
    return unique([
      labelled("framing", [targetFramingFromState(targetState) || contract.composition?.framing]),
      labelled("camera", [contract.composition?.cameraAngle]),
      labelled("placement", [contract.composition?.placement]),
      labelled("occupancy", [contract.composition?.occupancy]),
      labelled("background", [contract.environment?.background]),
      labelled("lighting", [
        contract.lighting?.direction,
        contract.lighting?.quality,
        contract.lighting?.colorTemperature,
      ]),
    ]).join("; ");
  }

  const ownedLines = legacySourcePrompt
    .split(/\n+/)
    .map(clean)
    .filter((line) => /^(?:Composition|Environment|Lighting)\s*:/i.test(line));
  return ownedLines.length ? unique(ownedLines).join("; ") : clean(legacySourcePrompt);
}

/**
 * The only textual owner of stable visible identity facts. Rendering style,
 * materials, target state and forbidden-drift prose are owned elsewhere.
 */
export function compilePersonIdentityLock(anchor: VideoConsistencyAnchor | undefined): string {
  if (!anchor) return "";
  const intrinsic = anchor.assetImageContract?.intrinsicDetails ?? [];
  const facts = intrinsic.length
    ? intrinsic
    : [
        anchor.visualLock?.shape,
        anchor.visualLock?.color,
        anchor.visualLock?.markings,
        anchor.assetImageContract?.subjectDescription,
      ];
  return unique(facts).slice(0, 8).join("; ");
}
