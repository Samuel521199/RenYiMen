import {
  z,
  type StructuredStageContract,
} from "./structured-stage-contract";

const nonEmptyString = z.string().min(1);
const nonEmptyRecord = z.record(z.unknown()).refine(
  (value) => Object.keys(value).length > 0,
  { message: "contract object must contain at least one field" },
);
export const segmentCameraMotionTypes = [
  "static",
  "pan",
  "tilt",
  "dolly_in",
  "dolly_out",
  "truck_left",
  "truck_right",
  "pedestal_up",
  "pedestal_down",
  "orbit",
  "zoom_in",
  "zoom_out",
  "handheld_follow",
  "crane",
] as const;

const evidenceRefSchema = z.object({
  type: z.enum(["user_input", "story_contract", "approved_end_frame", "planner_artifact"]),
  id: nonEmptyString,
  quote: z.string(),
}).strict();

const terminalRequirementSchema = z.object({
  requirement_id: nonEmptyString,
  priority: z.enum(["hard", "soft"]),
  observable_fact: nonEmptyString,
  acceptance_criteria: nonEmptyString,
  evidence_refs: z.array(evidenceRefSchema).min(1).max(5),
}).strict();

const videoPromptContractSchema = z.object({
  version: z.literal("video-prompt-contract-v1"),
  terminal_requirements: z.array(terminalRequirementSchema).min(1).max(3),
  motion_steps: z.array(nonEmptyString).min(1).max(3),
  preserve_requirements: z.array(nonEmptyString).max(5),
  forbidden_outcomes: z.array(nonEmptyString).max(5),
  narrative_boundary: z.string(),
  shot_intent: z.string(),
}).strict();

const motionContractSchema = z.object({
  version: z.literal("continuous-motion-contract-v1"),
  subject_actions: z.array(z.object({
    subject: nonEmptyString,
    action: nonEmptyString,
  }).strict()).min(1),
  camera_motion: z.object({
    type: z.enum(segmentCameraMotionTypes),
    start: z.string(),
    end: z.string(),
  }).strict(),
  prop_paths: z.array(z.string()),
  continuous_time: z.literal(true),
}).strict();

const renderDescriptionSchema = z.object({
  segment_no: z.number().int().min(1),
  end_frame_requirement_level: z.enum(["hard_exact", "hard_semantic", "soft_directional", "editorial"]),
  video_prompt_contract: videoPromptContractSchema,
  start_frame_contract: nonEmptyRecord,
  end_frame_contract: nonEmptyRecord,
  motion_contract: motionContractSchema,
  single_take_contract: nonEmptyRecord,
  motion_checkpoints: z.array(z.unknown()),
  requires_cut: z.boolean(),
  risk_level: z.enum(["low", "medium", "high"]),
}).passthrough();

export const segmentShotDecomposerSchema = z.object({
  shot_decomposer_plan: z.object({
    segment_render_descriptions: z.array(renderDescriptionSchema).length(1),
    keyframes: z.array(z.record(z.unknown())).length(2),
    segments: z.array(z.record(z.unknown())).length(1),
  }).strict(),
}).strict();

export type SegmentShotDecomposerOutput = z.infer<typeof segmentShotDecomposerSchema>;

export const segmentShotDecomposerExample: SegmentShotDecomposerOutput = {
  shot_decomposer_plan: {
    segment_render_descriptions: [{
      segment_no: 1,
      end_frame_requirement_level: "hard_semantic",
      video_prompt_contract: {
        version: "video-prompt-contract-v1",
        terminal_requirements: [{
          requirement_id: "terminal.primary_result",
          priority: "hard",
          observable_fact: "The win result is clearly visible.",
          acceptance_criteria: "The final frame visibly shows the approved win state.",
          evidence_refs: [{
            type: "approved_end_frame",
            id: "keyframe:2",
            quote: "",
          }],
        }],
        motion_steps: [
          "The character raises the playing cards into view.",
          "The playing cards move continuously to the center of the table.",
          "The camera pushes in and holds on the visible win result.",
        ],
        preserve_requirements: [],
        forbidden_outcomes: [],
        narrative_boundary: "",
        shot_intent: "",
      },
      visible_anchor_ids: [],
      start_frame_contract: {
        observable_state: "The character holds the playing cards behind the table.",
      },
      end_frame_contract: {
        observable_state: "The approved win result is visible at the center of the table.",
      },
      motion_contract: {
        version: "continuous-motion-contract-v1",
        subject_actions: [{
          subject: "main_character",
          action: "Raises the playing cards continuously.",
        }],
        camera_motion: {
          type: "dolly_in",
          start: "medium shot",
          end: "medium close-up",
        },
        prop_paths: [
          "The playing cards move from the character's hand to the center of the table.",
        ],
        continuous_time: true,
      },
      single_take_contract: {
        continuous_time: true,
        requires_cut: false,
        risk_level: "low",
        camera_path: "Continuous dolly in.",
        subject_path: "Character remains behind the table.",
        prop_paths: [],
      },
      motion_checkpoints: [],
      requires_cut: false,
      risk_level: "low",
      timeline_change_request: null,
      recommended_split: [],
      warnings: [],
    }],
    keyframes: [
      {
        keyframe_no: 1,
        frame_id: "kf_01",
        frame_role: "segment_start",
        time_seconds: 0,
        purpose_zh: "动作开始",
        purpose_en: "Action begins",
        scene: "game table",
        character_state: "ready",
        product_state: "cards in hand",
        frame_design: {},
        uses_consistency_anchors: [],
        negative_prompt: {},
      },
      {
        keyframe_no: 2,
        frame_id: "kf_02",
        frame_role: "segment_end",
        time_seconds: 5,
        purpose_zh: "展示胜利结果",
        purpose_en: "Show the win result",
        scene: "game table",
        character_state: "celebrating",
        product_state: "cards visible",
        frame_design: {},
        uses_consistency_anchors: [],
        negative_prompt: {},
      },
    ],
    segments: [{
      segment_no: 1,
      start_keyframe_no: 1,
      end_keyframe_no: 2,
      start_time_seconds: 0,
      end_time_seconds: 5,
      duration_seconds: 5,
      boundary_mode: "continuous",
      purpose_zh: "展示获胜动作",
      purpose_en: "Show the winning action",
      motion: "One continuous winning gesture.",
      camera: "Continuous dolly in.",
      subject_motion: "Character raises the cards.",
      environment_motion: "Subtle ambient motion.",
      subtitle: "",
      audio_plan: {},
      output_mode: "mixed",
      linked_beat_ids: ["beat_1"],
      story_function: "payoff",
      emotional_beat_zh: "胜利",
      cause: "The final card is played.",
      effect: "The character wins.",
      information_unit: "The game rewards skilled play.",
      key_evidence_ids: [],
      depends_on_beat_ids: [],
      evidence_from_beat_ids: [],
      resolves_conflict_beat_id: "",
      action_continuity: {
        motivation_or_preparation: "The character prepares the cards.",
        execution: "The cards are raised.",
        result_or_reaction: "The win result is shown.",
      },
      reaction_beat: "The character celebrates.",
      power_shift: "The character gains the advantage.",
      constraints: [],
      timed_prompts: [],
      micro_shots: [],
      uses_consistency_anchors: [],
      negative_prompt: "",
    }],
  },
};

export const segmentShotDecomposerContract: StructuredStageContract<SegmentShotDecomposerOutput> = {
  name: "segment_shot_decomposer_contract",
  version: "segment-shot-decomposer-v1",
  schema: segmentShotDecomposerSchema,
  example: segmentShotDecomposerExample,
  normalize: normalizeSegmentShotDecomposerAliases,
};

function normalizeSegmentShotDecomposerAliases(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const root = structuredClone(raw);
  const plan = isRecord(root.shot_decomposer_plan) ? root.shot_decomposer_plan : undefined;
  const descriptions = Array.isArray(plan?.segment_render_descriptions)
    ? plan.segment_render_descriptions
    : [];
  for (const value of descriptions) {
    if (!isRecord(value)) continue;
    renameAlias(value, "videoPromptContract", "video_prompt_contract");
    renameAlias(value, "video prompt contract", "video_prompt_contract");
    renameAlias(value, "motionContract", "motion_contract");
    renameAlias(value, "motion contract", "motion_contract");
    const videoContract = isRecord(value.video_prompt_contract) ? value.video_prompt_contract : undefined;
    if (videoContract) renameAlias(videoContract, "motionSteps", "motion_steps");
    if (videoContract) renameAlias(videoContract, "motion steps", "motion_steps");
    const motionContract = isRecord(value.motion_contract) ? value.motion_contract : undefined;
    if (!motionContract) continue;
    renameAlias(motionContract, "propPaths", "prop_paths");
    renameAlias(motionContract, "prop paths", "prop_paths");
    renameAlias(motionContract, "cameraMotion", "camera_motion");
    renameAlias(motionContract, "camera motion", "camera_motion");
    renameAlias(motionContract, "continuousTime", "continuous_time");
    renameAlias(motionContract, "continuous time", "continuous_time");
    const cameraMotion = isRecord(motionContract.camera_motion)
      ? motionContract.camera_motion
      : undefined;
    if (cameraMotion?.type === "pull_back") cameraMotion.type = "dolly_out";
    if (Array.isArray(motionContract.prop_paths)) {
      motionContract.prop_paths = motionContract.prop_paths.map((item) =>
        isRecord(item)
        && Object.keys(item).length === 1
        && typeof item.path === "string"
          ? item.path
          : item
      );
    }
  }
  return root;
}

function renameAlias(record: Record<string, unknown>, alias: string, canonical: string): void {
  if (!(canonical in record) && alias in record) record[canonical] = record[alias];
  delete record[alias];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
