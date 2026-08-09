import { z } from "zod";
import { apiErrorSchema } from "@/shared/contracts";
import { AppError } from "./errors";

export async function api<T>(path: string, output: z.ZodType<T>, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/internal/${path.replace(/^\//, "")}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) throw new AppError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.data);
    throw new AppError("INTERNAL", `Unexpected API response (${response.status})`);
  }
  return output.parse(payload);
}
