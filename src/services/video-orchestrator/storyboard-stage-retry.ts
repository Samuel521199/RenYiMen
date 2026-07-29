export type StoryboardStageErrorCode =
  | "first_chunk_timeout"
  | "stream_idle_timeout"
  | "max_stream_timeout"
  | "request_timeout"
  | "batch_cancelled"
  | "upstream_http_error"
  | "network_error"
  | "contract_validation_error";

export class StoryboardStageError extends Error {
  readonly code: StoryboardStageErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly validationErrors?: readonly string[];
  readonly stage?: string;

  constructor(
    message: string,
    options: {
      code: StoryboardStageErrorCode;
      retryable: boolean;
      httpStatus?: number;
      validationErrors?: readonly string[];
      stage?: string;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StoryboardStageError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
    this.validationErrors = options.validationErrors;
    this.stage = options.stage;
  }
}

export function storyboardStageErrorCode(error: unknown): StoryboardStageErrorCode | undefined {
  if (error instanceof StoryboardStageError) return error.code;
  if (!error || typeof error !== "object") return undefined;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && [
    "first_chunk_timeout",
    "stream_idle_timeout",
    "max_stream_timeout",
    "request_timeout",
    "batch_cancelled",
    "upstream_http_error",
    "network_error",
    "contract_validation_error",
  ].includes(code)
    ? code as StoryboardStageErrorCode
    : undefined;
}

export function storyboardContractValidationFeedback(error: unknown): string | undefined {
  if (!(error instanceof StoryboardStageError) || error.code !== "contract_validation_error") {
    return undefined;
  }
  if (error.validationErrors?.length) return error.validationErrors.join("; ");
  return error.message || undefined;
}

export function isRetryableStoryboardStageError(error: unknown): boolean {
  if (isStructuredOutputSyntaxError(error)) return true;
  if (error instanceof StoryboardStageError) return error.retryable;
  if (!(error instanceof Error)) return false;
  return /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed)\b/i.test(error.message);
}

export function storyboardStageHttpStatus(error: unknown): number {
  if (isStructuredOutputSyntaxError(error)) return 422;
  if (error instanceof StoryboardStageError) {
    if (error.code.endsWith("timeout")) return 504;
    if (error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500)) return 503;
    return 502;
  }
  if (error instanceof Error && /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed)\b/i.test(error.message)) return 503;
  return 400;
}

function cancelledStageError(stage: string, signal: AbortSignal, suffix: string): StoryboardStageError {
  return new StoryboardStageError(
    `Storyboard stage ${stage} was cancelled ${suffix}.`,
    {
      code: "batch_cancelled",
      retryable: false,
      stage,
      cause: signal.reason,
    },
  );
}

async function sleepUntilRetryOrAbort(
  stage: string,
  delayMs: number,
  sleep: (delayMs: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) {
    await sleep(delayMs);
    return;
  }
  if (signal.aborted) throw cancelledStageError(stage, signal, "before retry");
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(cancelledStageError(stage, signal, "before retry"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    sleep(delayMs).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function runStoryboardStageWithRetry<T>(options: {
  stage: string;
  maxAttempts: number;
  baseDelayMs: number;
  run: (attempt: number) => Promise<T>;
  signal?: AbortSignal;
  onRetry?: (event: { stage: string; attempt: number; nextAttempt: number; delayMs: number; error: unknown }) => Promise<void> | void;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts));
  const baseDelayMs = Math.max(0, Math.round(options.baseDelayMs));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw cancelledStageError(
        options.stage,
        options.signal,
        "because another task in the same batch failed",
      );
    }
    try {
      return await options.run(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableStoryboardStageError(error)) throw error;
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      await options.onRetry?.({ stage: options.stage, attempt, nextAttempt: attempt + 1, delayMs, error });
      if (delayMs > 0) {
        await sleepUntilRetryOrAbort(
          options.stage,
          delayMs,
          sleep,
          options.signal,
        );
      }
    }
  }

  throw new Error(`Storyboard stage ${options.stage} retry loop ended unexpectedly`);
}
import { isStructuredOutputSyntaxError } from "./structured-output-error";
