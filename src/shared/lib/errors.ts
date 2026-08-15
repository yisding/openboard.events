import type { AppErrorCode } from "@/shared/contracts";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: unknown;
  /**
   * Per-field messages, keyed by the input field the message belongs to.
   * `defineHandler` puts a zod failure's flattened `fieldErrors` on the wire
   * envelope; carrying them here is what lets a form show "Slug is already
   * taken" under the slug input instead of a bare "Request validation failed".
   */
  readonly fieldErrors: Record<string, string> | undefined;

  constructor(code: AppErrorCode, message: string, details?: unknown, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.fieldErrors = fieldErrors;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Did a failed write definitely *not* commit?
 *
 * This is the highest-stakes question the client asks about a failure, because
 * the answer decides whether a retry is safe. A coded `AppError` other than
 * `INTERNAL` is the server refusing the write on its merits — a validation
 * failure, a conflict, a stale baseline, a closed form — and proves nothing
 * was written, so the caller may surface the reason and let the organizer fix
 * it. Everything else is genuinely unknown: a transport failure, an
 * unparseable response, or an `INTERNAL` that may well have committed before
 * it threw. Those must go into a recovery flow rather than a blind retry, or
 * one click becomes two sessions, two prospects, or two API keys.
 *
 * `INTERNAL` is the pivot on purpose: `defineHandler` maps every unrecognized
 * throw to it (`shared/server/handler.ts`), so it is exactly the set of
 * failures the server cannot vouch for.
 *
 * Narrows to `AppError`, so a definitive failure's own `message` and
 * `fieldErrors` are available without a second guard.
 */
export function isDefinitiveWriteFailure(error: unknown): error is AppError {
  return isAppError(error) && error.code !== "INTERNAL";
}

export function toHttp(code: AppErrorCode): number {
  switch (code) {
    case "FORM_CLOSED":
    case "LIMIT_REACHED":
    case "FORM_LOCKED":
    case "VALIDATION":
    case "TEMPLATE_VAR_MISSING":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "FORM_VERSION_STALE":
    case "STALE_WRITE":
    case "STALE_STATUS":
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "INTERNAL":
      return 500;
  }
}
