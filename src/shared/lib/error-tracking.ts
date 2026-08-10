import type { LogEntry } from "./log";

export type ErrorCaptureContext = {
  requestId: string;
  feature: string;
  eventId?: string;
  code?: string;
};

/**
 * The single seam between the AppError/logger boundary and an error-tracking
 * provider (PLAN P3-OPS). `defineHandler`'s catch block and the job routes'
 * catch block both call this for every INTERNAL-coded failure — a raw,
 * unmapped `error`, before it becomes the generic "Unexpected server error"
 * the caller sees — so every production 500 and every failed cron tick is
 * captured with its real message and stack, not just an error code.
 *
 * Console-only today. Wiring a real provider later is confined to this one
 * file:
 *   1. `pnpm add @sentry/cloudflare` (check `pnpm worker:size` /
 *      `scripts/check-worker-size.sh` after — this is the only place the
 *      dependency would be imported).
 *   2. Provision a `SENTRY_DSN` secret and read it via `getEnv()`.
 *   3. Call `Sentry.init({ dsn })` once, guarded on the DSN being set, and
 *      replace the `console.error` below with
 *      `Sentry.captureException(normalized, { extra: context })`.
 * No other file in the repo should import a tracking SDK directly — every
 * unexpected error already flows through `captureError`, so that
 * replacement is the entire migration.
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
  };
  // The one sink this module owns. A provider swap replaces this line only.
  console.error(JSON.stringify({ ...entry, error: normalized.message, stack: normalized.stack }));
}
