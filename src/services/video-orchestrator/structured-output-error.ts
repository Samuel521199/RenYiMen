export type StructuredOutputErrorClassification = "stage_repairable";

export class StructuredOutputSyntaxError extends Error {
  readonly code = "STRUCTURED_OUTPUT_SYNTAX_ERROR";
  readonly classification: StructuredOutputErrorClassification = "stage_repairable";
  readonly stage: string;
  readonly stageRetryable = true;
  readonly jobRetryable = false;

  constructor(
    stage: string,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "StructuredOutputSyntaxError";
    this.stage = stage;
  }
}

export function isStructuredOutputSyntaxError(
  error: unknown,
): error is StructuredOutputSyntaxError {
  if (error instanceof StructuredOutputSyntaxError) return true;
  if (!error || typeof error !== "object") return false;
  return Reflect.get(error, "name") === "StructuredOutputSyntaxError"
    && Reflect.get(error, "code") === "STRUCTURED_OUTPUT_SYNTAX_ERROR"
    && Reflect.get(error, "classification") === "stage_repairable";
}
