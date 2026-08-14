import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { LogEntry } from "./log";
import type { OperationalErrorContext } from "@/shared/server/operational-errors";

export type ErrorCaptureContext = OperationalErrorContext;

/**
 * The single seam between the AppError/logger boundary and an error-tracking
 * provider (PLAN P3-OPS). `defineHandler`'s catch block and the private job adapter's
 * catch block both call this for every INTERNAL-coded failure — a raw,
 * unmapped `error`, before it becomes the generic "Unexpected server error"
 * the caller sees — so every production 500 and every failed cron tick is
 * captured with its real message and stack, not just an error code.
 *
 * Raw diagnostics go to Cloudflare Workers Logs. Deployed invocations also
 * schedule a privacy-safe aggregate write through `ctx.waitUntil()`: only a
 * fingerprint, feature, code, minute, and count are persisted, and the health
 * endpoint exposes only the recent aggregate count. A logging-provider export
 * can still be added later without changing callers.
 */
export function captureError(error: unknown, context: ErrorCaptureContext): void {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const entry: LogEntry = {
    level: "error",
    msg: "error.captured",
    requestId: context.requestId,
    feature: context.feature,
    ...(context.eventId ? { eventId: context.eventId } : {}),
    ...(context.code ? { code: context.code } : {}),
    ...(context.route ? { route: context.route } : {}),
  };
  console.error(JSON.stringify({ ...entry, error: normalized.message, stack: normalized.stack }));

  // Next dev/test/build has no request-scoped Cloudflare context and should
  // remain credential-free. A deployed Worker supplies both the environment
  // discriminator and a real waitUntil, which prevents the aggregate write
  // from being canceled after the 500 response is returned.
  try {
    const { env, ctx } = getCloudflareContext();
    const bindings = env as unknown as Record<string, unknown>;
    if ((env.APP_ENV !== "preview" && env.APP_ENV !== "production") || typeof bindings.DATABASE_URL !== "string") return;
    const persistence = import("@/shared/server/operational-errors")
      .then(({ recordOperationalError }) => recordOperationalError(normalized, context))
      .catch((persistenceError: unknown) => {
        const failure = persistenceError instanceof Error ? persistenceError : new Error(String(persistenceError));
        console.error(JSON.stringify({
          level: "error",
          msg: "error.persistence_failed",
          requestId: context.requestId,
          feature: "observability",
          error: failure.message,
        }));
      });
    ctx.waitUntil(persistence);
  } catch {
    // Absence of a Cloudflare request context is the normal local path. The
    // diagnostic log above is still emitted, and no floating promise exists.
  }
}
