const SEED_TARGETS = new Set(["local", "preview", "production"]);

/**
 * Neon URLs identify endpoints with opaque hostnames, so a URL substring cannot
 * reliably distinguish production. Make the operator classify every target and
 * require a second, deliberate capability for production.
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
