const SEED_TARGETS = new Set(["local", "preview", "production"]);

/** The database's own answer, or null when nobody has marked it. */
export type DatabaseIdentity = string | null;

/**
 * Neon URLs identify endpoints with opaque hostnames, so a URL substring cannot
 * reliably distinguish production. Make the operator classify every target and
 * require a second, deliberate capability for production.
 *
 * This runs before any connection is opened, so it is a pre-flight check on the
 * operator's *claim* only — `assertDatabaseAllowsSeed` is what verifies it.
 */
export function assertSafeSeedTarget(env: Readonly<Record<string, string | undefined>>): void {
  const target = env.APP_ENV;
  if (!target || !SEED_TARGETS.has(target)) {
    throw new Error("refusing to seed an unclassified database; set APP_ENV to local, preview, or production");
  }
  if (target === "production" && env.SEED_ALLOW_PROD !== "1") {
    throw new Error("refusing to seed production; set SEED_ALLOW_PROD=1 if that is genuinely what you want");
  }
}

/**
 * The claim is `APP_ENV`; the fact is what the database says about itself. They
 * are different things, and only checking the claim means `APP_ENV=local` with a
 * production `DATABASE_URL` truncates production.
 *
 * A verdict, so the decision is testable without a database.
 */
export function decideSeedTarget(input: {
  claimed: string;
  actual: DatabaseIdentity;
  allowProd: boolean;
}): { ok: true; warning?: string } | { ok: false; reason: string } {
  if (input.actual === null) {
    return {
      ok: true,
      warning: `this database does not identify itself; proceeding on APP_ENV=${input.claimed} alone. `
        + "Mark it once with: ALTER DATABASE <name> SET app.environment = '<local|preview|production>'",
    };
  }
  if (input.actual === "production" && !input.allowProd) {
    return { ok: false, reason: "the database identifies itself as production; set SEED_ALLOW_PROD=1 if that is genuinely what you want" };
  }
  if (input.actual !== input.claimed) {
    return {
      ok: false,
      reason: `APP_ENV says ${input.claimed} but the database identifies itself as ${input.actual}; refusing rather than guessing which is right`,
    };
  }
  return { ok: true };
}

/**
 * Runs inside the seed transaction, before the wipe, so a refusal rolls back
 * having changed nothing.
 */
export async function assertDatabaseAllowsSeed(
  read: () => Promise<DatabaseIdentity>,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const verdict = decideSeedTarget({
    claimed: env.APP_ENV ?? "",
    actual: await read(),
    allowProd: env.SEED_ALLOW_PROD === "1",
  });
  if (!verdict.ok) throw new Error(verdict.reason);
  if (verdict.warning) console.warn(`warning: ${verdict.warning}`);
}
