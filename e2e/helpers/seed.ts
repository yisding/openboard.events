import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { seededAdminBootstrapPassword } from "./admin-credentials";
import { TEST_DATABASE_URL } from "./env";
import { EVENTS } from "./seeded";

const SEED_ENTRYPOINT = "scripts/seed/index.ts";

export type SeedOutcome = { ran: boolean; reason?: string };
type CommandOptions = { stdio: "inherit"; env: Record<string, string | undefined> };
export type SeedDependencies = {
  databaseUrl: string;
  entrypointExists: (path: string) => boolean;
  env: Record<string, string | undefined>;
  run: (command: string, args: string[], options: CommandOptions) => { status: number | null };
};

function defaultDependencies(): SeedDependencies {
  return {
    databaseUrl: TEST_DATABASE_URL,
    entrypointExists: existsSync,
    env: process.env,
    // Wrangler's generated ProcessEnv makes unrelated bindings required at
    // type level. spawnSync only consumes the ordinary string map we provide.
    run: (command, args, options) => spawnSync(command, args, {
      ...options,
      env: options.env as NodeJS.ProcessEnv,
    }),
  };
}

/**
 * Loads the demo world into `sb-test`, then recreates the Better Auth
 * credentials the wipe removed. Callers treat `ran: false` as "assert on
 * nothing seeded".
 */
export function seedReset(wipe = true, dependencies: SeedDependencies = defaultDependencies()): SeedOutcome {
  const { databaseUrl, entrypointExists, env, run } = dependencies;
  if (env.E2E_SEED === "0") return { ran: false, reason: "E2E_SEED=0" };
  if (!entrypointExists(SEED_ENTRYPOINT)) return { ran: false, reason: `${SEED_ENTRYPOINT} does not exist yet (M09)` };
  if (!databaseUrl) return { ran: false, reason: "NEON_TEST_URL is not set" };

  // Resolve both before the destructive wipe. A missing secret must leave the
  // existing test database untouched rather than fail between seed and login.
  const organizerPassword = seededAdminBootstrapPassword("organizer", env);
  const reviewerPassword = seededAdminBootstrapPassword("reviewer", env);
  const commandEnv = { ...env, DATABASE_URL: databaseUrl };

  const result = run("pnpm", wipe ? ["seed", "--wipe"] : ["seed"], {
    stdio: "inherit",
    env: commandEnv,
  });
  if (result.status !== 0) {
    throw new Error(`pnpm seed exited ${result.status ?? "with a signal"} — specs would assert on a half-seeded database`);
  }

  const bootstrap = run("pnpm", ["admin:bootstrap"], {
    stdio: "inherit",
    env: {
      ...commandEnv,
      BOOTSTRAP_EVENT_ID: EVENTS.main.id,
      BOOTSTRAP_ADMIN_PASSWORD: organizerPassword,
      BOOTSTRAP_REVIEWER_PASSWORD: reviewerPassword,
    },
  });
  if (bootstrap.status !== 0) {
    throw new Error(
      `pnpm admin:bootstrap exited ${bootstrap.status ?? "with a signal"} — seeded admin credentials are unavailable`,
    );
  }
  return { ran: true };
}
