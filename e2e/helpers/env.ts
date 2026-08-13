/**
 * Everything the suite needs from the outside world, in one place, so a spec
 * never has to decide whether it is safe to run.
 */

/** The deployed target. Specs only run when this is set deliberately. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "";

/** The Neon `sb-test` branch the seed loads into and the specs read back. */
export const TEST_DATABASE_URL = process.env.NEON_TEST_URL ?? "";

/**
 * Read-capable key for the preview Resend account. The test retrieves only the
 * provider message id written by its own outbox row; the key is never sent to
 * the application or browser context.
 */
export const E2E_RESEND_API_KEY = process.env.E2E_RESEND_API_KEY ?? "";

/** Explicit non-production escape hatch for local or preview demo journeys. */
export const E2E_FALLBACK_ACTIVATION = process.env.E2E_FALLBACK_ACTIVATION === "1";

/**
 * Delivery-probe runs use their configured mailbox. Preview fallback runs use
 * a reserved, non-deliverable address even if only half of the provider pair
 * was configured, so they can never collide with a customer account.
 */
export const SIGNUP_EMAIL = E2E_FALLBACK_ACTIVATION
  ? "e2e-self-service@openboard.invalid"
  : process.env.E2E_SIGNUP_EMAIL?.trim().toLowerCase() ?? "";

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

export function signupJourneyConfigured(): boolean {
  return SIGNUP_EMAIL.length > 0 && (E2E_RESEND_API_KEY.length > 0 || E2E_FALLBACK_ACTIVATION);
}

export const NO_SIGNUP_JOURNEY = "set E2E_SIGNUP_EMAIL with E2E_RESEND_API_KEY, or use explicit non-production E2E_FALLBACK_ACTIVATION=1";
