import { seedReset } from "./helpers/seed";

/**
 * One seed per run, before any spec. `pnpm seed --wipe` against NEON_TEST_URL is
 * the intended behaviour; while M09's orchestrator is missing this prints why it
 * did nothing rather than failing the run, so the CP1 skeleton stays green.
 */
export default function globalSetup(): void {
  const outcome = seedReset(true);
  console.log(outcome.ran ? "e2e: seeded sb-test" : `e2e: seed skipped — ${outcome.reason}`);
}
