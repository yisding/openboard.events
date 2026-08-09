import { z } from "zod";
import { formSnapshotSchema } from "./forms";

export const APP_ERROR_CODES = [
  "FORM_CLOSED",
  "LIMIT_REACHED",
  "FORM_LOCKED",
  "FORM_VERSION_STALE",
  "STALE_WRITE",
  "STALE_STATUS",
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "VALIDATION",
  "TEMPLATE_VAR_MISSING",
  "RATE_LIMITED",
  "CONFLICT",
  "INTERNAL",
] as const;

export const appErrorCodeSchema = z.enum(APP_ERROR_CODES);
export type AppErrorCode = z.infer<typeof appErrorCodeSchema>;

export const formVersionStaleDataSchema = z.object({
  snapshot: formSnapshotSchema,
  version: z.int().positive(),
});
export type FormVersionStaleData = z.infer<typeof formVersionStaleDataSchema>;
