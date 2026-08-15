import { z } from "zod";
import { apiDataSchema, apiErrorSchema } from "@/shared/contracts";
import { AppError } from "./errors";

/**
 * The one reader of the wire envelope's per-field half.
 *
 * The server states field errors three ways and a form cannot tell them apart,
 * so all three are normalized here rather than in each caller:
 *
 *   - `error.fieldErrors` — zod's flattened map, from `defineHandler`.
 *   - `error.data.fieldErrors` — the same map, nested by some handlers.
 *   - `error.data.field` — a *domain* `AppError` naming one input, which is how
 *     every hand-thrown message the /events/new form actually hits arrives
 *     ("That slug is taken", "…is a reserved word…", "Unknown timezone", "Ends
 *     At must be after Starts At"). Its message is the error's own, since that
 *     shape carries no per-field text.
 *
 * Readers that handled only one branch dropped the others silently: the
 * offending input was never highlighted and the organizer saw a bare "Request
 * validation failed" with nothing to act on.
 */
export function readFieldErrors(
  error: {
    message?: string | undefined;
    fieldErrors?: Record<string, string> | undefined;
    data?: unknown;
  } | null | undefined,
): Record<string, string> | undefined {
  if (!error) return undefined;
  const data = error.data as { fieldErrors?: Record<string, string>; field?: unknown } | undefined;
  const single = typeof data?.field === "string" && typeof error.message === "string"
    ? { [data.field]: error.message }
    : undefined;
  return error.fieldErrors ?? data?.fieldErrors ?? single;
}

export async function api<T>(path: string, output: z.ZodType<T>, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/internal/${path.replace(/^\//, "")}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      // `fieldErrors` is the half of the envelope that used to be dropped here,
      // which is why a rejected form showed the generic "Request validation
      // failed" instead of the message belonging to the offending input.
      const fieldErrors = readFieldErrors(parsed.data.error);
      throw new AppError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.data, fieldErrors);
    }
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  return apiDataSchema(output).parse(payload).data;
}
