import { seedReset } from "./helpers/seed";

/**
 * One reset per run, before any spec. The seed wipe is followed by the operator
 * bootstrap so Better Auth credentials exist for the identities the seed
 * recreates.
 */
export default function globalSetup(): void {
  const outcome = seedReset(true);
  console.log(outcome.ran ? "e2e: seeded and bootstrapped sb-test" : `e2e: seed skipped — ${outcome.reason}`);
}
