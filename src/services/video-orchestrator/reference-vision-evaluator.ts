import { logOnePromptVideo } from "./logger";
import type { ReferenceOrientation, SelectableReferenceCandidate } from "./reference-selector";
import { onePromptRolloutEnabled } from "./rollout-flags";
import {
  readProductionCircuit,
  recordProductionCircuitFailure,
  recordProductionCircuitSuccess,
} from "./production-job-queue";

type VisionEvaluation = {
  artifactId: string;
  conflictScore: number;
  viewMatchScore: number;
  detectedOrientation: ReferenceOrientation;
  reasons: string[];
};

type ReferenceVisionCacheEntry = {
  expiresAt: number;
  evaluations: VisionEvaluation[];
};

type ReferenceVisionFailureCacheEntry = {
  expiresAt: number;
  warning: string;
};

type ReferenceVisionOutcome =
  | { status: "succeeded"; evaluations: VisionEvaluation[]; durationMs: number }
  | { status: "fallback"; warning: string; durationMs: number };

const referenceVisionRuntime = globalThis as typeof globalThis & {
  onePromptReferenceVisionCache?: Map<string, ReferenceVisionCacheEntry>;
  onePromptReferenceVisionFailureCache?: Map<string, ReferenceVisionFailureCacheEntry>;
  onePromptReferenceVisionInFlight?: Map<string, Promise<ReferenceVisionOutcome>>;
};
const referenceVisionCache = referenceVisionRuntime.onePromptReferenceVisionCache
  ?? new Map<string, ReferenceVisionCacheEntry>();
const referenceVisionFailureCache = referenceVisionRuntime.onePromptReferenceVisionFailureCache
  ?? new Map<string, ReferenceVisionFailureCacheEntry>();
const referenceVisionInFlight = referenceVisionRuntime.onePromptReferenceVisionInFlight
  ?? new Map<string, Promise<ReferenceVisionOutcome>>();
referenceVisionRuntime.onePromptReferenceVisionCache = referenceVisionCache;
referenceVisionRuntime.onePromptReferenceVisionFailureCache = referenceVisionFailureCache;
referenceVisionRuntime.onePromptReferenceVisionInFlight = referenceVisionInFlight;

export async function enrichReferenceCandidatesWithVision(params: {
  candidates: SelectableReferenceCandidate[];
  targetOrientation: ReferenceOrientation;
  targetPrompt: string;
  targetArtifactId: string;
}): Promise<{ candidates: SelectableReferenceCandidate[]; warnings: string[] }> {
  if (!referenceVisionEvaluationEnabled()) return { candidates: params.candidates, warnings: ["vision_conflict_eval_disabled"] };
  const eligible = params.candidates
    // Required transition evidence and an authoritative person user upload are
    // contractually selected for their scoped role. A generic whole-image
    // conflict score (for example poster text/background) must not veto them.
    .filter((candidate) => !(
      candidate.hardRequired
      && (candidate.sourceType === "transition_reference" || candidate.sourceType === "user_upload")
    ))
    .filter((candidate) => typeof candidate.url === "string" && /^https?:\/\//i.test(candidate.url))
    .sort((a, b) => Number(Boolean(b.hardRequired)) - Number(Boolean(a.hardRequired)) || b.relevanceScore - a.relevanceScore)
    .slice(0, 8);
  if (!eligible.length) return { candidates: params.candidates, warnings: ["vision_conflict_eval_no_public_candidates"] };
  if (!referenceVisionNeeded(eligible, params.targetOrientation)) {
    return { candidates: params.candidates, warnings: ["vision_conflict_eval_not_needed"] };
  }
  const model = referenceVisionModel();
  const timeoutMs = referenceVisionTimeoutMs();
  const circuitKey = `reference-vision:${model}`;
  const cacheKey = referenceVisionCacheKey(eligible, params.targetOrientation, params.targetArtifactId);
  const cached = referenceVisionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return applyVisionEvaluations(params.candidates, eligible.length, cached.evaluations, ["vision_conflict_eval_cache_hit"]);
  }
  if (cached) referenceVisionCache.delete(cacheKey);
  const failedCached = referenceVisionFailureCache.get(cacheKey);
  if (failedCached && failedCached.expiresAt > Date.now()) {
    await logReferenceVisionFallback({
      targetArtifactId: params.targetArtifactId,
      targetOrientation: params.targetOrientation,
      model,
      timeoutMs,
      candidateCount: eligible.length,
      fallbackReason: "failure_cache_hit",
      message: failedCached.warning,
    });
    return {
      candidates: params.candidates,
      warnings: ["vision_conflict_eval_failure_cache_hit", failedCached.warning],
    };
  }
  if (failedCached) referenceVisionFailureCache.delete(cacheKey);

  const circuit = await readProductionCircuit(circuitKey);
  if (circuit.open && circuit.openUntil) {
    const warning = `vision_conflict_eval_circuit_open_until:${circuit.openUntil.toISOString()}`;
    await logReferenceVisionFallback({
      targetArtifactId: params.targetArtifactId,
      targetOrientation: params.targetOrientation,
      model,
      timeoutMs,
      candidateCount: eligible.length,
      fallbackReason: "circuit_open",
      message: warning,
    });
    return { candidates: params.candidates, warnings: [warning] };
  }

  const existingEvaluation = referenceVisionInFlight.get(cacheKey);
  if (existingEvaluation) {
    const outcome = await existingEvaluation;
    await logOnePromptVideo("reference_selector.vision_eval_joined", {
      targetArtifactId: params.targetArtifactId,
      targetOrientation: params.targetOrientation,
      model,
      timeoutMs,
      candidateCount: eligible.length,
      durationMs: outcome.durationMs,
      selectionMode: outcome.status === "succeeded" ? "vision_singleflight" : "heuristic_fallback",
      fallbackReason: outcome.status === "fallback" ? outcome.warning : undefined,
    });
    return outcome.status === "succeeded"
      ? applyVisionEvaluations(params.candidates, eligible.length, outcome.evaluations, ["vision_conflict_eval_singleflight_joined"])
      : { candidates: params.candidates, warnings: ["vision_conflict_eval_singleflight_joined", outcome.warning] };
  }

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

  const evaluation = (async (): Promise<ReferenceVisionOutcome> => {
    const startedAtMs = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      try {
        response = await fetch(`${compatibleBaseUrl()}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${requireDashScopeApiKey()}`,
          },
          body: JSON.stringify({
            model,
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
      const durationMs = Date.now() - startedAtMs;
      await recordProductionCircuitSuccess(circuitKey);
      referenceVisionFailureCache.delete(cacheKey);
      referenceVisionCache.set(cacheKey, {
        expiresAt: Date.now() + referenceVisionCacheTtlMs(),
        evaluations,
      });
      trimReferenceVisionCaches();
      await logOnePromptVideo("reference_selector.vision_eval", {
        targetArtifactId: params.targetArtifactId,
        targetOrientation: params.targetOrientation,
        model,
        timeoutMs,
        candidateCount: eligible.length,
        evaluationCount: evaluations.length,
        durationMs,
        selectionMode: "vision",
        evaluations,
      });
      return { status: "succeeded", evaluations, durationMs };
    } catch (error) {
      clearTimeout(timeout);
      const durationMs = Date.now() - startedAtMs;
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = controller.signal.aborted
        ? `reference vision timed out after ${timeoutMs}ms`
        : rawMessage;
      const warning = `vision_conflict_eval_failed:${message}`;
      const failure = await recordProductionCircuitFailure({
        key: circuitKey,
        error,
        threshold: referenceVisionCircuitFailureThreshold(),
        cooldownMs: referenceVisionCircuitCooldownMs(),
      });
      referenceVisionFailureCache.set(cacheKey, {
        expiresAt: Date.now() + referenceVisionFailureCacheTtlMs(),
        warning,
      });
      trimReferenceVisionCaches();
      await logReferenceVisionFallback({
        targetArtifactId: params.targetArtifactId,
        targetOrientation: params.targetOrientation,
        model,
        timeoutMs,
        candidateCount: eligible.length,
        durationMs,
        fallbackReason: controller.signal.aborted ? "timeout" : "model_error",
        message,
        consecutiveFailures: failure.consecutiveFailures,
        circuitOpenUntil: failure.openUntil?.toISOString() ?? null,
      });
      return { status: "fallback", warning, durationMs };
    }
  })();
  referenceVisionInFlight.set(cacheKey, evaluation);
  try {
    const outcome = await evaluation;
    return outcome.status === "succeeded"
      ? applyVisionEvaluations(params.candidates, eligible.length, outcome.evaluations)
      : { candidates: params.candidates, warnings: [outcome.warning] };
  } finally {
    if (referenceVisionInFlight.get(cacheKey) === evaluation) {
      referenceVisionInFlight.delete(cacheKey);
    }
  }
}

function referenceVisionEvaluationEnabled(): boolean {
  if (!onePromptRolloutEnabled("ONE_PROMPT_REFERENCE_SELECTOR_V2")) return false;
  if (process.env.ONE_PROMPT_REFERENCE_VISION_EVAL?.trim().toLowerCase() === "false") return false;
  return Boolean(process.env.DASHSCOPE_API_KEY || process.env.BAILIAN_API_KEY || process.env.ALIYUN_API_KEY);
}

function referenceVisionTimeoutMs(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 3000
    ? Math.min(8000, Math.round(value))
    : 8000;
}

function referenceVisionNeeded(
  candidates: SelectableReferenceCandidate[],
  targetOrientation: ReferenceOrientation,
): boolean {
  if (process.env.ONE_PROMPT_REFERENCE_VISION_ALWAYS?.trim().toLowerCase() === "true") return true;
  if (targetOrientation === "unknown") return true;
  if (candidates.some((candidate) =>
    candidate.quotaType === "character"
    && (
      !candidate.assetView
      || candidate.viewMatchScore < 0.5
      || (candidate.detectedOrientation && candidate.detectedOrientation === "unknown")
    )
  )) return true;
  if (candidates.some((candidate) =>
    candidate.conflictScore >= 0.4
    || Boolean(candidate.conflictReasons?.length)
  )) return true;
  const quotaGroups = new Map<string, SelectableReferenceCandidate[]>();
  for (const candidate of candidates) {
    const quota = candidate.quotaType ?? "custom";
    quotaGroups.set(quota, [...(quotaGroups.get(quota) ?? []), candidate]);
  }
  return [...quotaGroups.values()].some((group) =>
    group.length > 1
    && Math.abs((group[0]?.relevanceScore ?? 0) - (group[1]?.relevanceScore ?? 0)) < 0.08
  );
}

function referenceVisionCacheKey(
  candidates: SelectableReferenceCandidate[],
  targetOrientation: ReferenceOrientation,
  targetArtifactId: string,
): string {
  return JSON.stringify({
    targetArtifactId,
    targetOrientation,
    candidates: candidates.map((candidate) => [
      candidate.artifactId,
      candidate.url,
      candidate.assetView ?? "",
      candidate.quotaType ?? "",
      Math.round(candidate.relevanceScore * 1000),
      Math.round(candidate.conflictScore * 1000),
    ]),
  });
}

function applyVisionEvaluations(
  candidates: SelectableReferenceCandidate[],
  eligibleCount: number,
  evaluations: VisionEvaluation[],
  extraWarnings: string[] = [],
): { candidates: SelectableReferenceCandidate[]; warnings: string[] } {
  const byId = new Map(evaluations.map((evaluation) => [evaluation.artifactId, evaluation]));
  return {
    candidates: candidates.map((candidate) => {
      const evaluation = byId.get(candidate.artifactId);
      if (!evaluation) return candidate;
      return {
        ...candidate,
        conflictScore: Math.max(candidate.conflictScore, evaluation.conflictScore),
        viewMatchScore: evaluation.viewMatchScore,
        detectedOrientation: evaluation.detectedOrientation,
        conflictReasons: uniqueStrings([...(candidate.conflictReasons ?? []), ...evaluation.reasons]),
      };
    }),
    warnings: [
      ...extraWarnings,
      ...(evaluations.length < eligibleCount ? ["vision_conflict_eval_partial"] : []),
    ],
  };
}

function referenceVisionCacheTtlMs(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 60_000 ? Math.round(value) : 30 * 60_000;
}

function referenceVisionFailureCacheTtlMs(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_FAILURE_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 5_000
    ? Math.min(5 * 60_000, Math.round(value))
    : 30_000;
}

function referenceVisionCircuitFailureThreshold(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_CIRCUIT_FAILURES);
  return Number.isFinite(value) && value >= 1 ? Math.min(10, Math.round(value)) : 2;
}

function referenceVisionCircuitCooldownMs(): number {
  const value = Number(process.env.ONE_PROMPT_REFERENCE_VISION_CIRCUIT_COOLDOWN_MS);
  return Number.isFinite(value) && value >= 10_000 ? Math.round(value) : 5 * 60_000;
}

function trimReferenceVisionCaches(): void {
  const maxEntries = 200;
  while (referenceVisionCache.size > maxEntries) {
    const oldestKey = referenceVisionCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    referenceVisionCache.delete(oldestKey);
  }
  while (referenceVisionFailureCache.size > maxEntries) {
    const oldestKey = referenceVisionFailureCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    referenceVisionFailureCache.delete(oldestKey);
  }
}

async function logReferenceVisionFallback(data: {
  targetArtifactId: string;
  targetOrientation: ReferenceOrientation;
  model: string;
  timeoutMs: number;
  candidateCount: number;
  durationMs?: number;
  fallbackReason: string;
  message: string;
  consecutiveFailures?: number;
  circuitOpenUntil?: string | null;
}): Promise<void> {
  await logOnePromptVideo("reference_selector.vision_eval_fallback", {
    ...data,
    selectionMode: "heuristic_fallback",
    resultZh: "视觉评估未生效，已立即使用程序规则完成参考图选择",
  }, "warn");
}

function referenceVisionModel(): string {
  return process.env.ALIYUN_REFERENCE_VISION_MODEL?.trim()
    || process.env.ALIYUN_STORYBOARD_VISION_MODEL?.trim()
    || "qwen-vl-max";
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
