import { z } from "zod";
import { AppError, isAppError } from "@/shared/lib/errors";

const API_KEY_PREFIX = "ob_live_";
export const API_KEY_LABEL_MAX_LENGTH = 120;
export const API_KEY_LABEL_REQUIRED_MESSAGE = "Enter a label for this API key.";
export const API_KEY_LABEL_TOO_LONG_MESSAGE = `Use ${API_KEY_LABEL_MAX_LENGTH} characters or fewer for the label.`;

export const apiKeyCreationLabelSchema = z.string().max(API_KEY_LABEL_MAX_LENGTH).trim().min(1);

export const apiKeyCreationOperationSchema = z.object({
  operationId: z.uuid(),
  label: apiKeyCreationLabelSchema,
  plaintext: z.string().regex(/^ob_live_[A-Za-z0-9_-]{43}$/u, "Invalid API key plaintext"),
});

export type ApiKeyCreationOperation = z.infer<typeof apiKeyCreationOperationSchema>;

export function apiKeyCreationLabelError(label: string): string | null {
  if (label.length > API_KEY_LABEL_MAX_LENGTH) return API_KEY_LABEL_TOO_LONG_MESSAGE;
  if (label.trim().length === 0) return API_KEY_LABEL_REQUIRED_MESSAGE;
  return null;
}

/** 4xx-style domain failures prove the POST did not commit; 5xx/network do not. */
export function isDefinitiveApiKeyCreationError(error: unknown): error is AppError {
  return isAppError(error) && error.code !== "INTERNAL";
}

/** Freeze the caller-owned identity and secret once for one organizer click. */
export function newApiKeyCreationOperation(label: string): ApiKeyCreationOperation {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const secret = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return apiKeyCreationOperationSchema.parse({
    operationId: crypto.randomUUID(),
    label,
    plaintext: `${API_KEY_PREFIX}${secret}`,
  });
}
