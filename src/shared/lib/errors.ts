import type { AppErrorCode } from "@/shared/contracts";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
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
