/**
 * Everything the suite needs from the outside world, in one place, so a spec
 * never has to decide whether it is safe to run.
 */

/** The deployed target. Specs only run when this is set deliberately. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "";

/** The Neon `sb-test` branch the seed loads into and the specs read back. */
export const TEST_DATABASE_URL = process.env.NEON_TEST_URL ?? "";

/**
 * The whole suite is opt-in. Unset, `pnpm e2e` reports six specs with every test
 * skipped and zero failures, which is exactly the CP1 gate: the skeleton runs.
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
