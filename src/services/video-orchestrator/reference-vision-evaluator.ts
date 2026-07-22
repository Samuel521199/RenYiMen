import { logOnePromptVideo } from "./logger";
import type { ReferenceOrientation, SelectableReferenceCandidate } from "./reference-selector";
import { onePromptRolloutEnabled } from "./rollout-flags";

type VisionEvaluation = {
  artifactId: string;
  conflictScore: number;
  viewMatchScore: number;
  detectedOrientation: ReferenceOrientation;
  reasons: string[];
};

export async function enrichReferenceCandidatesWithVision(params: {
  candidates: SelectableReferenceCandidate[];
  targetOrientation: ReferenceOrientation;
  targetPrompt: string;
  targetArtifactId: string;
}): Promise<{ candidates: SelectableReferenceCandidate[]; warnings: string[] }> {
  if (!referenceVisionEvaluationEnabled()) return { candidates: params.candidates, warnings: ["vision_conflict_eval_disabled"] };
  const eligible = params.candidates
    // A required transition reference is contractually selected for scene
    // layout only. Generic identity/text conflict scoring must not veto it.
    .filter((candidate) => !(candidate.sourceType === "transition_reference" && candidate.hardRequired))
    .filter((candidate) => typeof candidate.url === "string" && /^https?:\/\//i.test(candidate.url))
    .sort((a, b) => Number(Boolean(b.hardRequired)) - Number(Boolean(a.hardRequired)) || b.relevanceScore - a.relevanceScore)
    .slice(0, 8);
  if (!eligible.length) return { candidates: params.candidates, warnings: ["vision_conflict_eval_no_public_candidates"] };

  const content: Array<Record<string, unknown>> = [{
    type: "text",
    text: [
      "You are a reference-image conflict evaluator. Inspect each candidate image only; do not select the final references.",
      `Target artifact: ${params.targetArtifactId}`,
      `Target orientation: ${params.targetOrientation}`,
      `Target prompt: ${params.targetPrompt.slice(0, 1800)}`,
      "Return JSON only with evaluations[]. For each candidate return artifactId, conflictScore 0..1, viewMatchScore 0..1, detectedOrientation front|side|back|unknown, and reasons[].",
      "conflictScore must increase for wrong identity, wrong product/logo, accidental/wrong text, conflicting scene layout, duplicate subject/product, or a reference whose visual content contradicts its intended usage.",
      "viewMatchScore must increase when the visible person orientation matches the target orientation. A style reference cannot become an identity reference.",
    ].join("\n"),
  }];
  for (const candidate of eligible) {
    content.push({
      type: "text",
      text: `Candidate artifactId=${candidate.artifactId}; intendedUsage=${candidate.quotaType ?? "custom"}; purpose=${candidate.purpose}; expectedView=${candidate.assetView ?? "unknown"}; hardRequired=${Boolean(candidate.hardRequired)}`,
    });
    content.push({ type: "image_url", image_url: { url: candidate.url } });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), referenceVisionTimeoutMs());
    let response: Response;
    try {
      response = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${requireDashScopeApiKey()}`,
        },
        body: JSON.stringify({
          model: process.env.ALIYUN_REFERENCE_VISION_MODEL?.trim() || process.env.ALIYUN_STORYBOARD_VISION_MODEL?.trim() || "qwen-vl-max",
          messages: [
            { role: "system", content: "Evaluate reference image conflicts and view match. Output strict JSON." },
            { role: "user", content },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(extractError(raw) || `HTTP ${response.status}`);
    const evaluations = normalizeVisionEvaluations(parseResponseContent(raw));
    const byId = new Map(evaluations.map((evaluation) => [evaluation.artifactId, evaluation]));
    const candidates = params.candidates.map((candidate) => {
      const evaluation = byId.get(candidate.artifactId);
      if (!evaluation) return candidate;
      return {
        ...candidate,
        conflictScore: Math.max(candidate.conflictScore, evaluation.conflictScore),
        viewMatchScore: evaluation.viewMatchScore,
        detectedOrientation: evaluation.detectedOrientation,
        conflictReasons: uniqueStrings([...(candidate.conflictReasons ?? []), ...evaluation.reasons]),
      };
    });
    await logOnePromptVideo("reference_selector.vision_eval", {
      targetArtifactId: params.targetArtifactId,
      targetOrientation: params.targetOrientation,
      candidateCount: eligible.length,
      evaluationCount: evaluations.length,
      evaluations,
    });
    return {
      candidates,
      warnings: evaluations.length < eligible.length ? ["vision_conflict_eval_partial"] : [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOnePromptVideo("reference_selector.vision_eval_failed", {
      targetArtifactId: params.targetArtifactId,
      message,
    }, "warn");
    return { candidates: params.candidates, warnings: [`vision_conflict_eval_failed:${message}`] };
  }
}

function referenceVisionEvaluationEnabled(): boolean {
  if (!onePromptRolloutEnabled("ONE_PROMPT_REFERENCE_SELECTOR_V2")) return false;
  if (process.env.ONE_PROMPT_REFERENCE_VISION_EVAL?.trim().toLowerCase() === "false") return false;
  return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY);
}

function referenceVisionTimeoutMs(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 5000 ? Math.round(value) : 30000;
}

function compatibleBaseUrl(): string {
  return (process.env.DASHSCOPE_COMPATIBLE_BASE_URL || process.env.ALIYUN_COMPATIBLE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, "");
}

function requireDashScopeApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY;
  if (!key) throw new Error("missing DashScope API key for reference vision evaluation");
  return key;
}

function parseResponseContent(raw: Record<string, unknown>): unknown {
  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object") return {};
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return {};
  const content = (message as Record<string, unknown>).content;
  if (typeof content !== "string") return {};
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned) as unknown;
}

function normalizeVisionEvaluations(value: unknown): VisionEvaluation[] {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = Array.isArray(root.evaluations) ? root.evaluations : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const artifactId = typeof record.artifactId === "string" ? record.artifactId : typeof record.artifact_id === "string" ? record.artifact_id : "";
    if (!artifactId) return [];
    const orientation = record.detectedOrientation ?? record.detected_orientation;
    return [{
      artifactId,
      conflictScore: clamp01(Number(record.conflictScore ?? record.conflict_score)),
      viewMatchScore: clamp01(Number(record.viewMatchScore ?? record.view_match_score)),
      detectedOrientation: orientation === "front" || orientation === "side" || orientation === "back" ? orientation : "unknown",
      reasons: uniqueStrings(Array.isArray(record.reasons) ? record.reasons : []),
    }];
  });
}

function extractError(raw: Record<string, unknown>): string {
  if (typeof raw.message === "string") return raw.message;
  if (raw.error && typeof raw.error === "object" && typeof (raw.error as Record<string, unknown>).message === "string") {
    return (raw.error as Record<string, unknown>).message as string;
  }
  return "reference vision evaluation failed";
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))];
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
