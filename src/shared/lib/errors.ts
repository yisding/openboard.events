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
