import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSWORD_RESET_RATE_LIMIT,
  PASSWORD_RESET_RATE_WINDOW_MS,
  clearPasswordResetAttemptsForTests,
  consumePasswordResetAttempt,
  isValidResetPassword,
  normalizePasswordResetEmail,
  passwordResetSecretMatches,
} from "./password-reset";

test("normalizes valid reset emails and rejects invalid input", () => {
  assert.equal(normalizePasswordResetEmail("  User@Example.COM "), "user@example.com");
  assert.equal(normalizePasswordResetEmail("not-an-email"), null);
  assert.equal(normalizePasswordResetEmail(null), null);
});

test("validates password boundaries", () => {
  assert.equal(isValidResetPassword("1234567"), false);
  assert.equal(isValidResetPassword("12345678"), true);
  assert.equal(isValidResetPassword("x".repeat(128)), true);
  assert.equal(isValidResetPassword("x".repeat(129)), false);
});

test("compares the configured reset secret", () => {
  assert.equal(passwordResetSecretMatches("correct-reset-key", "correct-reset-key"), true);
  assert.equal(passwordResetSecretMatches("wrong", "correct-reset-key"), false);
});

test("limits attempts per key inside the configured window", () => {
  clearPasswordResetAttemptsForTests();
  const now = 1_000_000;
  for (let index = 0; index < PASSWORD_RESET_RATE_LIMIT; index += 1) {
    assert.equal(consumePasswordResetAttempt(["ip:test"], now + index).allowed, true);
  }
  assert.equal(consumePasswordResetAttempt(["ip:test"], now + 10).allowed, false);
  assert.equal(
    consumePasswordResetAttempt(["ip:test"], now + PASSWORD_RESET_RATE_WINDOW_MS + 1).allowed,
    true
  );
});
