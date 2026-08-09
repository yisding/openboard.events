import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { TEST_DATABASE_URL } from "./env";

const SEED_ENTRYPOINT = "scripts/seed/index.ts";

export type SeedOutcome = { ran: boolean; reason?: string };

/**
 * Loads the demo world into `sb-test`. M09 owns the orchestrator; until it
 * exists this reports why it did nothing instead of failing, so the skeleton
 * still runs clean. Callers treat `ran: false` as "assert on nothing seeded".
 */
export function seedReset(wipe = true): SeedOutcome {
  if (process.env.E2E_SEED === "0") return { ran: false, reason: "E2E_SEED=0" };
  if (!existsSync(SEED_ENTRYPOINT)) return { ran: false, reason: `${SEED_ENTRYPOINT} does not exist yet (M09)` };
  if (!TEST_DATABASE_URL) return { ran: false, reason: "NEON_TEST_URL is not set" };

  const result = spawnSync("pnpm", wipe ? ["seed", "--wipe"] : ["seed"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  if (result.status !== 0) {
    throw new Error(`pnpm seed exited ${result.status ?? "with a signal"} — specs would assert on a half-seeded database`);
  }
  return { ran: true };
}
