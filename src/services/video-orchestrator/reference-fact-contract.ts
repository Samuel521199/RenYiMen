import { z } from "zod";

import type { StructuredStageContract } from "./structured-stage-contract";

const referenceFactSchema = z.object({
  image_index: z.number().int().positive(),
  people: z.array(z.string()),
  products: z.array(z.string()),
  objects: z.array(z.string()),
  scene: z.string(),
  spatial_layout: z.array(z.string()),
  readable_text: z.array(z.string()),
  brand_marks: z.array(z.string()),
  colors: z.array(z.string()),
  lighting: z.string(),
  style: z.string(),
  confidence: z.number().min(0).max(1),
}).strict();

export const ReferenceFactsSchema = z.object({
  reference_facts: z.array(referenceFactSchema),
  global_consistency_facts: z.array(z.string()),
}).strict();

export type ReferenceFactsOutput = z.infer<typeof ReferenceFactsSchema>;

export const referenceFactsExample = ReferenceFactsSchema.parse({
  reference_facts: [{
    image_index: 1,
    people: [],
    products: [],
    objects: [],
    scene: "",
    spatial_layout: [],
    readable_text: [],
    brand_marks: [],
    colors: [],
    lighting: "",
    style: "",
    confidence: 0,
  }],
  global_consistency_facts: [],
});

export const referenceFactsPromptExampleJson = JSON.stringify(referenceFactsExample);

export const referenceFactContract: StructuredStageContract<ReferenceFactsOutput> = {
  name: "reference_fact_extractor_contract",
  version: "reference-facts-v2",
  schema: ReferenceFactsSchema,
  example: referenceFactsExample,
  normalize: normalizeReferenceFacts,
};

function normalizeReferenceFacts(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.reference_facts)) return raw;
  return {
    ...raw,
    reference_facts: raw.reference_facts.map((fact) => {
      if (!isRecord(fact)) return fact;
      return {
        ...fact,
        people: normalizeVisibleFactList(fact.people),
        products: normalizeVisibleFactList(fact.products),
        objects: normalizeVisibleFactList(fact.objects),
        spatial_layout: normalizeVisibleFactList(fact.spatial_layout),
        readable_text: normalizeVisibleFactList(fact.readable_text),
        brand_marks: normalizeVisibleFactList(fact.brand_marks),
        colors: normalizeVisibleFactList(fact.colors),
      };
    }),
    global_consistency_facts: normalizeVisibleFactList(
      raw.global_consistency_facts,
    ),
  };
}

/**
 * Vision models frequently return a visible-fact list item as a small object
 * such as `{ type, description, position }`, even when JSON Schema asks for a
 * string. Serializing that item is deterministic and lossless: it changes
 * only the container representation and preserves every observed scalar.
 */
function normalizeVisibleFactList(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? [normalized] : [];
  }
  if (!Array.isArray(value)) return value;
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (
        typeof item === "number"
        || typeof item === "boolean"
        || isRecord(item)
        || Array.isArray(item)
      ) {
        return JSON.stringify(item);
      }
      return "";
    })
    .filter((item) => item.length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
