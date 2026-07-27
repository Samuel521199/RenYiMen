import type {
  ResolvedVideoImageInputs,
  VideoImageInput,
} from "@/services/providers/video-input-contract";
import type { VideoPromptContract } from "./types";

export interface OrderedSubjectActionPromptInput {
  contract: VideoPromptContract;
  resolvedImages: ResolvedVideoImageInputs;
  startState: string;
}

/**
 * Compiles the internal image manifest into the natural subject/action syntax
 * expected by ordered-reference video models. The technical REFERENCE MAP is
 * deliberately kept out of the model-facing prompt.
 */
export function compileOrderedSubjectActionPrompt(
  input: OrderedSubjectActionPromptInput,
): string {
  const numbered = input.resolvedImages.transported.map((image, index) => ({
    image,
    imageNumber: index + 1,
  }));
  if (!numbered.length) return "";

  const first = numbered.find(({ image }) => image.role === "first_frame");
  const last = numbered.find(({ image }) => image.role === "last_frame");
  const actor = numbered.find(({ image }) =>
    image.actionRole === "actor" || image.role === "character_identity"
  );
  const objects = numbered.filter(({ image }) =>
    image.actionRole === "object" || image.role === "product_identity"
  );
  const environment = numbered.find(({ image }) =>
    image.actionRole === "environment" || image.role === "scene_layout"
  );
  const checkpoints = numbered.filter(({ image }) => image.role === "motion_checkpoint");

  const actorSubject = actor
    ? `${subjectName(actor.image, "the main character")} from [Image ${actor.imageNumber}]`
    : "The main subject";
  const sentences: string[] = [];

  if (first) {
    sentences.push(
      `${actorSubject} starts in the approved opening composition from [Image ${first.imageNumber}].`,
    );
  } else {
    sentences.push(`${actorSubject} starts from this approved state: ${ensureSentence(input.startState)}`);
  }

  if (objects.length) {
    sentences.push(
      `During the action, ${actor ? "this character" : "the main subject"} uses ${
        objects
          .map(({ image, imageNumber }) =>
            `${subjectName(image, "the referenced object")} from [Image ${imageNumber}]`
          )
          .join(" and ")
      }.`,
    );
  }

  for (const step of input.contract.motionSteps) {
    sentences.push(ensureSentence(step));
  }

  if (checkpoints.length) {
    sentences.push(
      `The continuous movement passes naturally through ${
        checkpoints
          .map(({ imageNumber }) => `the intermediate action shown in [Image ${imageNumber}]`)
          .join(" and ")
      }, without inserting either image as a cut or freeze-frame.`,
    );
  }

  const destination = [
    last ? `the approved target ending state shown in [Image ${last.imageNumber}]` : "",
    environment
      ? `inside ${subjectName(environment.image, "the referenced setting")} from [Image ${environment.imageNumber}]`
      : "",
  ].filter(Boolean).join(", ");
  if (destination) {
    sentences.push(
      `${actor ? "The character" : "The main subject"} reaches ${destination}.`,
    );
  }

  const preservationSentences = numbered
    .filter(({ image }) =>
      image.role === "character_identity"
      || image.role === "product_identity"
      || image.role === "scene_layout"
    )
    .map(({ image, imageNumber }) => compilePreservationSentence(image, imageNumber))
    .filter(Boolean);

  return [
    "MAIN ACTION",
    sentences.join(" "),
    preservationSentences.join(" "),
  ].filter(Boolean).join("\n\n");
}

function compilePreservationSentence(image: VideoImageInput, imageNumber: number): string {
  const traits = image.allowedUse.map(cleanTrait).filter(Boolean).slice(0, 5);
  if (!traits.length) return "";
  return `Preserve ${possessiveSubjectName(image)} ${formatNaturalList(traits)} from [Image ${imageNumber}].`;
}

function subjectName(image: VideoImageInput, fallback: string): string {
  return normalizeSubjectName(image.entityName) || fallback;
}

function possessiveSubjectName(image: VideoImageInput): string {
  const name = subjectName(image, fallbackSubjectName(image));
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function fallbackSubjectName(image: VideoImageInput): string {
  if (image.role === "character_identity") return "the character";
  if (image.role === "product_identity") return "the product";
  if (image.role === "scene_layout") return "the setting";
  return "the reference";
}

function normalizeSubjectName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return /^(the|a|an)\s/i.test(trimmed) ? trimmed : `the ${trimmed}`;
}

function cleanTrait(value: string): string {
  return value.trim().replace(/[.;]+$/g, "");
}

function formatNaturalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
