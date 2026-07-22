export type StoryboardStageErrorCode =
  | "first_chunk_timeout"
  | "stream_idle_timeout"
  | "max_stream_timeout"
  | "request_timeout"
  | "upstream_http_error"
  | "network_error";

export class StoryboardStageError extends Error {
  readonly code: StoryboardStageErrorCode;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    message: string,
    options: {
      code: StoryboardStageErrorCode;
      retryable: boolean;
      httpStatus?: number;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StoryboardStageError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
  }
}

export function isRetryableStoryboardStageError(error: unknown): boolean {
  if (error instanceof StoryboardStageError) return error.retryable;
  if (!(error instanceof Error)) return false;
  return /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed)\b/i.test(error.message);
}

export function storyboardStageHttpStatus(error: unknown): number {
  if (error instanceof StoryboardStageError) {
    if (error.code.endsWith("timeout")) return 504;
    if (error.httpStatus === 429 || (error.httpStatus !== undefined && error.httpStatus >= 500)) return 503;
    return 502;
  }
  if (error instanceof Error && /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed)\b/i.test(error.message)) return 503;
  return 400;
}

export async function runStoryboardStageWithRetry<T>(options: {
  stage: string;
  maxAttempts: number;
  baseDelayMs: number;
  run: (attempt: number) => Promise<T>;
  onRetry?: (event: { stage: string; attempt: number; nextAttempt: number; delayMs: number; error: unknown }) => Promise<void> | void;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts));
  const baseDelayMs = Math.max(0, Math.round(options.baseDelayMs));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await options.run(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableStoryboardStageError(error)) throw error;
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      await options.onRetry?.({ stage: options.stage, attempt, nextAttempt: attempt + 1, delayMs, error });
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw new Error(`Storyboard stage ${options.stage} retry loop ended unexpectedly`);
}
