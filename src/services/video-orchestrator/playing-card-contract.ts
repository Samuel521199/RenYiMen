import type {
  VideoAssetImageContract,
  VideoConsistencyAnchor,
  VideoPlayingCardContract,
  VideoPlayingCardContractAuthority,
  VideoPlayingCardRank,
  VideoPlayingCardSuit,
} from "./types";

export interface PlayingCardContractConflict {
  field: "cards" | "overlap" | "cameraAngle" | "face";
  authority: VideoPlayingCardContractAuthority;
  values: string[];
}

export class PlayingCardContractConflictError extends Error {
  readonly anchorId: string;
  readonly conflicts: PlayingCardContractConflict[];

  constructor(anchorId: string, conflicts: PlayingCardContractConflict[]) {
    super(`Playing-card contract conflict for ${anchorId}: ${conflicts
      .map((item) => `${item.field}=${item.values.join(" vs ")}`)
      .join("; ")}`);
    this.name = "PlayingCardContractConflictError";
    this.anchorId = anchorId;
    this.conflicts = conflicts;
  }
}

interface ParsedCardSource {
  authority: VideoPlayingCardContractAuthority;
  cards?: VideoPlayingCardContract["cards"];
  face?: VideoPlayingCardContract["face"];
  overlap?: VideoPlayingCardContract["overlap"];
  cameraAngle?: VideoPlayingCardContract["cameraAngle"];
  background?: string;
  allowedMarkings?: string[];
  conflicts: PlayingCardContractConflict[];
}

const AUTHORITY_PRIORITY: Record<VideoPlayingCardContractAuthority, number> = {
  user_edit: 5,
  user_requirement: 4,
  reference_fact: 3,
  asset_contract: 2,
  category_default: 1,
};

const SUIT_NAMES: Record<VideoPlayingCardSuit, string> = {
  spades: "Spades",
  hearts: "Hearts",
  clubs: "Clubs",
  diamonds: "Diamonds",
};

const RANK_NAMES: Record<VideoPlayingCardRank, string> = {
  A: "Ace",
  K: "King",
  Q: "Queen",
  J: "Jack",
  "10": "10",
  "9": "9",
  "8": "8",
  "7": "7",
  "6": "6",
  "5": "5",
  "4": "4",
  "3": "3",
  "2": "2",
};

const DEFAULT_CONTRACT: VideoPlayingCardContract = {
  cards: [
    { rank: "A", suit: "spades", position: "left" },
    { rank: "K", suit: "hearts", position: "right" },
  ],
  face: "face_up",
  overlap: { mode: "none", percentage: 0 },
  cameraAngle: "top_down_orthographic",
  background: "plain white or light neutral studio background",
  allowedMarkings: ["rank indices", "suit symbols"],
  fieldAuthority: {
    cards: "category_default",
    face: "category_default",
    overlap: "category_default",
    cameraAngle: "category_default",
    background: "category_default",
    allowedMarkings: "category_default",
  },
};

export function isPlayingCardAnchor(anchor: VideoConsistencyAnchor): boolean {
  const searchable = [
    anchor.id,
    anchor.displayNameZh,
    anchor.displayNameEn,
    anchor.descriptionZh,
    anchor.descriptionEn,
    anchor.imagePromptZh,
    anchor.imagePromptEn,
    anchor.assetImageContract?.subjectDescription,
  ].filter(Boolean).join(" ").toLowerCase();
  return /扑克牌|纸牌|playing[\s_-]*cards?|poker[\s_-]*cards?|game[\s_-]*cards?/.test(searchable);
}

export function resolvePlayingCardAssetContract(params: {
  anchor: VideoConsistencyAnchor;
  userPrompt?: string;
  userEditPrompt?: string;
}): {
  anchor: VideoConsistencyAnchor;
  playingCards: VideoPlayingCardContract;
} {
  if (!isPlayingCardAnchor(params.anchor)) {
    throw new Error(`Anchor ${params.anchor.id} is not a playing-card asset.`);
  }
  const sources: ParsedCardSource[] = [];
  if (params.userEditPrompt?.trim()) {
    sources.push(parseNaturalLanguageSource(params.userEditPrompt, "user_edit"));
  }
  if (params.userPrompt?.trim()) {
    sources.push(parseNaturalLanguageSource(params.userPrompt, "user_requirement"));
  }
  const referenceText = (params.anchor.sourceEvidence ?? [])
    .filter((item) => item.source === "reference_fact")
    .map((item) => item.text)
    .join(" ");
  if (referenceText) sources.push(parseNaturalLanguageSource(referenceText, "reference_fact"));

  const existing = params.anchor.assetImageContract;
  if (existing?.playingCards) {
    sources.push(...parseStructuredSources(existing.playingCards));
  } else if (existing) {
    sources.push(parseNaturalLanguageSource(assetContractText(existing), "asset_contract", existing));
  }
  sources.push({
    authority: "category_default",
    cards: DEFAULT_CONTRACT.cards,
    face: DEFAULT_CONTRACT.face,
    overlap: DEFAULT_CONTRACT.overlap,
    cameraAngle: DEFAULT_CONTRACT.cameraAngle,
    background: DEFAULT_CONTRACT.background,
    allowedMarkings: DEFAULT_CONTRACT.allowedMarkings,
    conflicts: [],
  });

  const conflicts = sources.flatMap((source) => source.conflicts);
  if (conflicts.length) throw new PlayingCardContractConflictError(params.anchor.id, conflicts);

  const cards = resolveField(sources, "cards") ?? DEFAULT_CONTRACT.cards;
  const face = resolveField(sources, "face") ?? DEFAULT_CONTRACT.face;
  const overlap = resolveField(sources, "overlap") ?? DEFAULT_CONTRACT.overlap;
  const cameraAngle = resolveField(sources, "cameraAngle") ?? DEFAULT_CONTRACT.cameraAngle;
  const background = resolveField(sources, "background") ?? DEFAULT_CONTRACT.background;
  const allowedMarkings = resolveField(sources, "allowedMarkings") ?? DEFAULT_CONTRACT.allowedMarkings;
  const fieldAuthority = {
    cards: authorityForField(sources, "cards"),
    face: authorityForField(sources, "face"),
    overlap: authorityForField(sources, "overlap"),
    cameraAngle: authorityForField(sources, "cameraAngle"),
    background: authorityForField(sources, "background"),
    allowedMarkings: authorityForField(sources, "allowedMarkings"),
  };
  const playingCards: VideoPlayingCardContract = {
    cards,
    face,
    overlap,
    cameraAngle,
    background,
    allowedMarkings,
    fieldAuthority,
  };
  const canonicalContract = materializePlayingCardContract(existing, playingCards);
  return {
    playingCards,
    anchor: {
      ...params.anchor,
      assetImageContract: canonicalContract,
    },
  };
}

export function validatePlayingCardContract(
  anchor: VideoConsistencyAnchor,
): PlayingCardContractConflict[] {
  if (!isPlayingCardAnchor(anchor) || !anchor.assetImageContract) return [];
  try {
    resolvePlayingCardAssetContract({ anchor });
    return [];
  } catch (error) {
    return error instanceof PlayingCardContractConflictError ? error.conflicts : [];
  }
}

export function normalizePlayingCardContract(value: unknown): VideoPlayingCardContract | undefined {
  if (!isRecord(value)) return undefined;
  const rawCards = Array.isArray(value.cards) ? value.cards : [];
  const cards = rawCards.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const rank = normalizeRank(typeof item.rank === "string" ? item.rank : undefined);
    const suit: VideoPlayingCardSuit | undefined = item.suit === "spades"
      || item.suit === "hearts"
      || item.suit === "clubs"
      || item.suit === "diamonds"
      ? item.suit
      : undefined;
    const position = item.position === "left"
      || item.position === "right"
      || item.position === "center"
      || (typeof item.position === "string" && /^index_\d+$/.test(item.position))
      ? item.position as VideoPlayingCardContract["cards"][number]["position"]
      : `index_${index + 1}` as const;
    return rank && suit ? [{ rank, suit, position }] : [];
  });
  const rawOverlap = isRecord(value.overlap) ? value.overlap : {};
  const mode = rawOverlap.mode === "percentage" ? "percentage" : "none";
  const rawPercentage = typeof rawOverlap.percentage === "number" && Number.isFinite(rawOverlap.percentage)
    ? rawOverlap.percentage
    : 0;
  const rawCameraAngle = value.cameraAngle ?? value.camera_angle;
  const cameraAngle = rawCameraAngle === "top_down_perspective"
    || rawCameraAngle === "front"
    || rawCameraAngle === "low_angle"
    ? rawCameraAngle
    : "top_down_orthographic";
  const rawFieldAuthority = isRecord(value.fieldAuthority)
    ? value.fieldAuthority
    : isRecord(value.field_authority)
      ? value.field_authority
      : undefined;
  const fieldAuthority = rawFieldAuthority
    ? Object.fromEntries(Object.entries(rawFieldAuthority).flatMap(([key, authority]) =>
        isAuthority(authority) ? [[normalizeAuthorityField(key), authority]] : []
      )) as VideoPlayingCardContract["fieldAuthority"]
    : undefined;
  const rawAllowedMarkings = value.allowedMarkings ?? value.allowed_markings;
  return {
    cards,
    face: value.face === "face_down" ? "face_down" : "face_up",
    overlap: { mode, percentage: rawPercentage },
    cameraAngle,
    background: typeof value.background === "string" ? value.background.trim() : "",
    allowedMarkings: Array.isArray(rawAllowedMarkings)
      ? rawAllowedMarkings.filter(
          (item): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : [],
    fieldAuthority,
  };
}

function resolveField<K extends keyof Omit<ParsedCardSource, "authority" | "conflicts">>(
  sources: ParsedCardSource[],
  field: K,
): ParsedCardSource[K] {
  return [...sources]
    .sort((a, b) => AUTHORITY_PRIORITY[b.authority] - AUTHORITY_PRIORITY[a.authority])
    .find((source) => source[field] !== undefined)?.[field];
}

function authorityForField(
  sources: ParsedCardSource[],
  field: keyof Omit<ParsedCardSource, "authority" | "conflicts">,
): VideoPlayingCardContractAuthority {
  return [...sources]
    .sort((a, b) => AUTHORITY_PRIORITY[b.authority] - AUTHORITY_PRIORITY[a.authority])
    .find((source) => source[field] !== undefined)?.authority ?? "category_default";
}

function parseStructuredSources(contract: VideoPlayingCardContract): ParsedCardSource[] {
  const validationSource: ParsedCardSource = {
    authority: highestDeclaredAuthority(contract),
    cards: contract.cards,
    face: contract.face,
    overlap: contract.overlap,
    cameraAngle: contract.cameraAngle,
    background: contract.background,
    allowedMarkings: contract.allowedMarkings,
    conflicts: [],
  };
  if (!contract.cards.length) {
    validationSource.conflicts.push({
      field: "cards",
      authority: validationSource.authority,
      values: ["empty card list"],
    });
  }
  if (contract.overlap.mode === "none" && contract.overlap.percentage !== 0) {
    validationSource.conflicts.push({
      field: "overlap",
      authority: validationSource.authority,
      values: ["mode=none", `percentage=${contract.overlap.percentage}`],
    });
  }
  if (contract.overlap.mode === "percentage" && !(contract.overlap.percentage > 0 && contract.overlap.percentage < 100)) {
    validationSource.conflicts.push({
      field: "overlap",
      authority: validationSource.authority,
      values: ["mode=percentage", `percentage=${contract.overlap.percentage}`],
    });
  }
  const fields = ["cards", "face", "overlap", "cameraAngle", "background", "allowedMarkings"] as const;
  return fields.map((field, index) => ({
    authority: contract.fieldAuthority?.[field] ?? "asset_contract",
    [field]: contract[field],
    conflicts: index === 0 ? validationSource.conflicts : [],
  }));
}

function highestDeclaredAuthority(contract: VideoPlayingCardContract): VideoPlayingCardContractAuthority {
  const declared = Object.values(contract.fieldAuthority ?? {});
  return declared.sort((a, b) => AUTHORITY_PRIORITY[b] - AUTHORITY_PRIORITY[a])[0] ?? "asset_contract";
}

function parseNaturalLanguageSource(
  text: string,
  authority: VideoPlayingCardContractAuthority,
  contract?: VideoAssetImageContract,
): ParsedCardSource {
  const cards = extractCards(text);
  const noOverlap = /\b(?:no|without)\s+overlap|non[- ]overlapping|clear gap|不得重叠|不可重叠|不重叠|留出(?:清晰)?间距/i.test(text);
  const percentageMatches = [...text.matchAll(/(?:overlap(?:ping)?(?:\s+the\s+cards?)?(?:\s+by|\s+about|\s+approximately)?|重叠(?:约|大约)?)\s*(\d{1,2})\s*%/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0 && value < 100);
  const topDownOrthographic = /top[- ]down orthographic|strict top[- ]down|正上方无透视|正上方俯视/i.test(text);
  const topDownPerspective = /top[- ]down perspective|俯拍透视|有透视俯视/i.test(text);
  const lowAngle = /low[- ]angle|低机位|仰拍/i.test(text);
  const front = /front view|eye[- ]level|正面平视/i.test(text);
  const faceUp = /face[- ]up|正面朝上/i.test(text);
  const faceDown = /face[- ]down|背面朝上|牌背朝上/i.test(text);
  const conflicts: PlayingCardContractConflict[] = [];
  const uniquePercentages = [...new Set(percentageMatches)];
  if (noOverlap && uniquePercentages.length) {
    conflicts.push({
      field: "overlap",
      authority,
      values: ["no overlap", ...uniquePercentages.map((value) => `${value}% overlap`)],
    });
  } else if (uniquePercentages.length > 1) {
    conflicts.push({
      field: "overlap",
      authority,
      values: uniquePercentages.map((value) => `${value}% overlap`),
    });
  }
  const cameraValues = [
    topDownOrthographic && "top_down_orthographic",
    topDownPerspective && "top_down_perspective",
    lowAngle && "low_angle",
    front && "front",
  ].filter(Boolean) as VideoPlayingCardContract["cameraAngle"][];
  if (new Set(cameraValues).size > 1) {
    conflicts.push({ field: "cameraAngle", authority, values: [...new Set(cameraValues)] });
  }
  if (faceUp && faceDown) {
    conflicts.push({ field: "face", authority, values: ["face_up", "face_down"] });
  }
  const expectedCount = contract?.subjectCount;
  if (cards.length && expectedCount && cards.length !== expectedCount) {
    conflicts.push({
      field: "cards",
      authority,
      values: [`subjectCount=${expectedCount}`, `${cards.length} distinct card identities`],
    });
  }
  return {
    authority,
    cards: cards.length ? positionCards(cards) : undefined,
    face: faceDown ? "face_down" : faceUp ? "face_up" : undefined,
    overlap: noOverlap
      ? { mode: "none", percentage: 0 }
      : uniquePercentages.length === 1
        ? { mode: "percentage", percentage: uniquePercentages[0] }
        : undefined,
    cameraAngle: cameraValues.length === 1 ? cameraValues[0] : undefined,
    background: contract?.environment?.background?.trim() || undefined,
    allowedMarkings: cards.length ? ["rank indices", "suit symbols"] : undefined,
    conflicts,
  };
}

function extractCards(text: string): Array<{ rank: VideoPlayingCardRank; suit: VideoPlayingCardSuit }> {
  const found: Array<{ rank: VideoPlayingCardRank; suit: VideoPlayingCardSuit; index: number }> = [];
  const patterns: Array<{ regex: RegExp; suit: VideoPlayingCardSuit }> = [
    { regex: /\b(Ace|King|Queen|Jack|10|[2-9]|A|K|Q|J)\s+of\s+Spades\b|(?:黑桃)\s*(A|K|Q|J|10|[2-9])/gi, suit: "spades" },
    { regex: /\b(Ace|King|Queen|Jack|10|[2-9]|A|K|Q|J)\s+of\s+Hearts\b|(?:红桃|紅桃)\s*(A|K|Q|J|10|[2-9])/gi, suit: "hearts" },
    { regex: /\b(Ace|King|Queen|Jack|10|[2-9]|A|K|Q|J)\s+of\s+Clubs\b|(?:梅花)\s*(A|K|Q|J|10|[2-9])/gi, suit: "clubs" },
    { regex: /\b(Ace|King|Queen|Jack|10|[2-9]|A|K|Q|J)\s+of\s+Diamonds\b|(?:方片|方块|方塊)\s*(A|K|Q|J|10|[2-9])/gi, suit: "diamonds" },
    { regex: /\b(A|K|Q|J|10|[2-9])\s*♠/gi, suit: "spades" },
    { regex: /\b(A|K|Q|J|10|[2-9])\s*♥/gi, suit: "hearts" },
    { regex: /\b(A|K|Q|J|10|[2-9])\s*♣/gi, suit: "clubs" },
    { regex: /\b(A|K|Q|J|10|[2-9])\s*♦/gi, suit: "diamonds" },
  ];
  for (const { regex, suit } of patterns) {
    for (const match of text.matchAll(regex)) {
      const rawRank = match.slice(1).find(Boolean);
      const rank = normalizeRank(rawRank);
      if (rank) found.push({ rank, suit, index: match.index ?? 0 });
    }
  }
  const unique = new Map<string, { rank: VideoPlayingCardRank; suit: VideoPlayingCardSuit; index: number }>();
  for (const item of found.sort((a, b) => a.index - b.index)) {
    unique.set(`${item.rank}:${item.suit}`, item);
  }
  return [...unique.values()].sort((a, b) => a.index - b.index).map(({ rank, suit }) => ({ rank, suit }));
}

function normalizeRank(value: string | undefined): VideoPlayingCardRank | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase();
  if (normalized === "ACE") return "A";
  if (normalized === "KING") return "K";
  if (normalized === "QUEEN") return "Q";
  if (normalized === "JACK") return "J";
  return /^(?:A|K|Q|J|10|[2-9])$/.test(normalized)
    ? normalized as VideoPlayingCardRank
    : undefined;
}

function positionCards(
  cards: Array<{ rank: VideoPlayingCardRank; suit: VideoPlayingCardSuit }>,
): VideoPlayingCardContract["cards"] {
  return cards.map((card, index) => ({
    ...card,
    position: cards.length === 1
      ? "center"
      : index === 0
        ? "left"
        : index === 1
          ? "right"
          : `index_${index + 1}` as const,
  }));
}

function assetContractText(contract: VideoAssetImageContract): string {
  return [
    contract.subjectDescription,
    contract.composition?.framing,
    contract.composition?.cameraAngle,
    contract.composition?.placement,
    contract.environment?.background,
    ...(contract.intrinsicDetails ?? []),
    ...(contract.acceptanceCriteria ?? []),
  ].filter(Boolean).join(" ");
}

function materializePlayingCardContract(
  existing: VideoAssetImageContract | undefined,
  playingCards: VideoPlayingCardContract,
): VideoAssetImageContract {
  const cardNames = playingCards.cards.map((card) =>
    `${RANK_NAMES[card.rank]} of ${SUIT_NAMES[card.suit]} at ${card.position}`
  );
  const overlapText = playingCards.overlap.mode === "none"
    ? "side by side with a clear gap and no overlap"
    : `overlap by exactly ${playingCards.overlap.percentage}%`;
  const cameraText: Record<VideoPlayingCardContract["cameraAngle"], string> = {
    top_down_orthographic: "strict top-down orthographic view with no perspective distortion",
    top_down_perspective: "top-down perspective view",
    front: "straight front view",
    low_angle: "low-angle view",
  };
  return {
    ...existing,
    subjectCount: playingCards.cards.length,
    subjectDescription: `${playingCards.cards.length} complete ${playingCards.face === "face_up" ? "face-up" : "face-down"} playing cards: ${cardNames.join(", ")}.`,
    composition: {
      framing: existing?.composition?.framing || "full isolated asset sheet",
      cameraAngle: cameraText[playingCards.cameraAngle],
      placement: `${cardNames.join(", ")}; ${overlapText}`,
      occupancy: existing?.composition?.occupancy || "the complete card set occupies about 70% of the frame",
    },
    environment: {
      background: playingCards.background,
    },
    lighting: {
      direction: existing?.lighting?.direction || "soft frontal studio illumination",
      quality: existing?.lighting?.quality || "even, shadow-controlled light with readable card faces",
      colorTemperature: existing?.lighting?.colorTemperature,
    },
    palette: existing?.palette,
    materialDetails: existing?.materialDetails?.length
      ? existing.materialDetails
      : ["white coated playing-card stock", "thin dark outline and rounded corners"],
    intrinsicDetails: [
      ...cardNames.map((name) => `${name} with matching top-left and bottom-right rank and suit indices`),
      `only these intrinsic markings are allowed: ${playingCards.allowedMarkings.join(", ")}`,
    ],
    forbiddenElements: [
      "extra cards",
      "duplicate cards",
      "card backs unless face-down cards are explicitly required",
      "joker",
      "wrong rank or suit",
      "mismatched corner indices",
      "cropped corners",
      "hands, table, chips, characters, scenery, logo, UI, watermark, or decorative text",
      ...(playingCards.overlap.mode === "none" ? ["overlapping cards"] : []),
    ],
    acceptanceCriteria: [
      `exactly ${playingCards.cards.length} complete cards are visible`,
      `card identities and positions are exactly ${cardNames.join(", ")}`,
      playingCards.overlap.mode === "none"
        ? "the cards do not overlap"
        : `the cards overlap by exactly ${playingCards.overlap.percentage}%`,
      `camera angle is ${playingCards.cameraAngle}`,
    ],
    playingCards,
  };
}

function isAuthority(value: unknown): value is VideoPlayingCardContractAuthority {
  return value === "user_edit"
    || value === "user_requirement"
    || value === "reference_fact"
    || value === "asset_contract"
    || value === "category_default";
}

function normalizeAuthorityField(value: string): string {
  if (value === "camera_angle") return "cameraAngle";
  if (value === "allowed_markings") return "allowedMarkings";
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
