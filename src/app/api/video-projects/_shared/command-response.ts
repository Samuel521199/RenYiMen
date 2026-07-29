import { NextResponse } from "next/server";

import {
  structuredProductionErrorFromUnknown,
  type StructuredProductionError,
} from "@/services/video-orchestrator/structured-production-error";

export function commandErrorResponse(
  error: unknown,
  status = 400,
  fallback: Partial<Omit<StructuredProductionError, "displayMessage">> = {},
) {
  const contract = structuredProductionErrorFromUnknown(error, fallback);
  return NextResponse.json({
    ok: false,
    ...contract,
    // Keep `error` during the compatibility window. It is display-only and
    // must never be used to choose a recovery command.
    error: contract.displayMessage.en,
  }, { status });
}

export function unauthorizedCommandResponse() {
  return commandErrorResponse(new Error("Unauthorized"), 401, {
    errorCode: "UNAUTHORIZED",
    category: "authorization",
    retryable: false,
    recoveryAction: "SIGN_IN",
  });
}

export function migrationFrozenCommandResponse() {
  if (process.env.NEXT_PUBLIC_ONE_PROMPT_MIGRATION_FROZEN !== "true") return null;
  return commandErrorResponse(new Error("One-prompt video migration is frozen"), 503, {
    errorCode: "ONE_PROMPT_MIGRATION_FROZEN",
    category: "state",
    retryable: false,
    recoveryAction: "WAIT_FOR_MIGRATION",
  });
}
