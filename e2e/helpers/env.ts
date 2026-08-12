/**
 * Everything the suite needs from the outside world, in one place, so a spec
 * never has to decide whether it is safe to run.
 */

/** The deployed target. Specs only run when this is set deliberately. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "";

/** The Neon `sb-test` branch the seed loads into and the specs read back. */
export const TEST_DATABASE_URL = process.env.NEON_TEST_URL ?? "";

/** Dedicated allowlisted mailbox used only by the public self-service journey. */
export const SIGNUP_EMAIL = process.env.E2E_SIGNUP_EMAIL?.trim().toLowerCase() ?? "";

/**
 * Read-capable key for the preview Resend account. The test retrieves only the
 * provider message id written by its own outbox row; the key is never sent to
 * the application or browser context.
 */
export const E2E_RESEND_API_KEY = process.env.E2E_RESEND_API_KEY ?? "";

/** Explicit local-only escape hatch; deployed preview proof always uses Resend. */
export const E2E_FALLBACK_ACTIVATION = process.env.E2E_FALLBACK_ACTIVATION === "1";

/**
 * The whole suite is opt-in. With no target configured, `pnpm e2e` reports the
 * specs as skipped and exits successfully, which is exactly the CP1 gate: the
 * skeleton runs.
 * Pointing E2E_BASE_URL at a deployed preview is what turns it on.
 */
export function targetConfigured(): boolean {
  return BASE_URL.length > 0;
}

export const NO_TARGET = "set E2E_BASE_URL to a deployed preview to run this spec";

/** Specs read `communication_logs` and seeded counts back out of the database. */
export function databaseConfigured(): boolean {
  return TEST_DATABASE_URL.length > 0;
}

export const NO_DATABASE = "set NEON_TEST_URL to the sb-test branch for the database assertions";

export function signupMailboxConfigured(): boolean {
  return SIGNUP_EMAIL.length > 0 && (E2E_RESEND_API_KEY.length > 0 || E2E_FALLBACK_ACTIVATION);
}

export const NO_SIGNUP_MAILBOX = "set E2E_SIGNUP_EMAIL and E2E_RESEND_API_KEY for preview, or explicitly enable local E2E_FALLBACK_ACTIVATION=1";
