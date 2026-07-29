export const EXECUTION_CONTRACT_MISSING = "EXECUTION_CONTRACT_MISSING" as const;
export const REPAIR_CONTRACT = "REPAIR_CONTRACT" as const;

export class ExecutionContractMissingError extends Error {
  readonly code = EXECUTION_CONTRACT_MISSING;
  readonly recoveryAction = REPAIR_CONTRACT;
  readonly targetId?: string;
  readonly artifactId?: string;

  constructor(
    message: string,
    options: {
      targetId?: string;
      artifactId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = EXECUTION_CONTRACT_MISSING;
    this.targetId = options.targetId;
    this.artifactId = options.artifactId;
  }
}

export function executionContractErrorDetails(error: unknown): {
  errorCode: typeof EXECUTION_CONTRACT_MISSING;
  recoveryAction: typeof REPAIR_CONTRACT;
  targetId?: string;
  artifactId?: string;
} | null {
  if (
    error instanceof ExecutionContractMissingError
    || (
      error !== null
      && typeof error === "object"
      && Reflect.get(error, "code") === EXECUTION_CONTRACT_MISSING
    )
  ) {
    return {
      errorCode: EXECUTION_CONTRACT_MISSING,
      recoveryAction: REPAIR_CONTRACT,
      targetId: optionalString(Reflect.get(error, "targetId")),
      artifactId: optionalString(Reflect.get(error, "artifactId")),
    };
  }
  return null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
