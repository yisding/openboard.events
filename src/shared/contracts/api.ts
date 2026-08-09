import { z } from "zod";
import { appErrorCodeSchema } from "./errors";

export function apiDataSchema<T extends z.ZodType>(data: T) {
  return z.object({ data, meta: z.record(z.string(), z.unknown()).optional() });
}

export const apiErrorSchema = z.object({
  error: z.object({
    code: appErrorCodeSchema,
    message: z.string(),
    data: z.unknown().optional(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
