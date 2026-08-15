/**
 * The one module in the product that is allowed to call `console`.
 *
 * Every diagnostic line — request completion, a degraded rate limiter, a
 * captured 500, a failed health probe, a client error boundary — is a single
 * JSON object with the same key names, so Cloudflare Workers Logs can filter
 * on `level`, `feature`, and `requestId` instead of on prose. `scripts/check-source-invariants.ts`
 * enforces the ownership with the `console-owner` rule; the only exemption is
 * the deliberate devtools branding greeting.
 *
 * `level` also selects the console method. It used to be data only, which meant
 * `log({ level: "error" })` printed on `console.log` while `captureError`
 * printed the same shape on `console.error` — the two halves of one error
 * landed in different streams.
 */
export type LogEntry = {
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  /**
   * Correlation key. Server paths use the `cf-ray` header; paths with no
   * request to key against use a fixed sentinel (`"health"` for the unauthenticated
   * probes, `"client"` for browser error boundaries) so they stay greppable as
   * a class rather than each inventing an id.
   */
  requestId: string;
  feature: string;
  code?: string;
  eventId?: string;
  route?: string;
  durationMs?: number;
  /** Job counters (rows claimed, sent, deleted) kept queryable alongside the tick. */
  stats?: Record<string, number>;
  error?: string;
  stack?: string;
  componentStack?: string;
};

const CONSOLE_METHOD: Record<LogEntry["level"], "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

export function log(entry: LogEntry): void {
  console[CONSOLE_METHOD[entry.level]](JSON.stringify(entry));
}

/** Narrow an unknown throw to the message field of a `LogEntry`. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
