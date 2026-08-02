import { createHash, timingSafeEqual } from "node:crypto";

export const PASSWORD_RESET_MIN_PASSWORD = 8;
export const PASSWORD_RESET_MAX_PASSWORD = 128;
export const PASSWORD_RESET_MIN_MASTER_KEY = 16;
export const PASSWORD_RESET_RATE_LIMIT = 5;
export const PASSWORD_RESET_RATE_WINDOW_MS = 15 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

type AttemptStore = Map<string, number[]>;

const resetGlobal = globalThis as typeof globalThis & {
  __passwordResetAttempts?: AttemptStore;
};

function attemptStore(): AttemptStore {
  resetGlobal.__passwordResetAttempts ??= new Map<string, number[]>();
  return resetGlobal.__passwordResetAttempts;
}

export function normalizePasswordResetEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function isValidResetPassword(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length >= PASSWORD_RESET_MIN_PASSWORD
    && value.length <= PASSWORD_RESET_MAX_PASSWORD
  );
}

/** Compare secrets without exposing their length through an early-return comparison. */
export function passwordResetSecretMatches(candidate: string, configured: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

/**
 * Process-local abuse protection. Deployments with multiple web replicas should additionally
 * enforce this endpoint's rate limit at the reverse proxy or a shared Redis-backed limiter.
 */
export function consumePasswordResetAttempt(
  keys: string[],
  now = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  const store = attemptStore();
  const cutoff = now - PASSWORD_RESET_RATE_WINDOW_MS;
  const normalizedKeys = [...new Set(keys.filter(Boolean))];
  let retryAfterMs = 0;

  for (const key of normalizedKeys) {
    const recent = (store.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    store.set(key, recent);
    if (recent.length >= PASSWORD_RESET_RATE_LIMIT) {
      retryAfterMs = Math.max(
        retryAfterMs,
        recent[0] + PASSWORD_RESET_RATE_WINDOW_MS - now
      );
    }
  }

  if (retryAfterMs > 0) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  for (const key of normalizedKeys) {
    const recent = store.get(key) ?? [];
    recent.push(now);
    store.set(key, recent);
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearPasswordResetAttemptsForTests(): void {
  attemptStore().clear();
}
