import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { AppError, isAppError, toHttp } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";

export type RouteParams = Record<string, string | string[] | undefined>;
export type AuthSession = { actorId: string; role: string; eventId?: EventId } | null;
export type AuthGuard = (request: NextRequest, eventId: EventId | null, params: RouteParams) => Promise<AuthSession>;
export type HandlerGuard = AuthGuard;

type HandlerContext<Input> = {
  eventId: EventId | null;
  session: AuthSession;
  input: Input;
  params: RouteParams;
  req: NextRequest;
  requestId: string;
};

function queryInput(searchParams: URLSearchParams): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    input[key] = values.length === 1 ? values[0] ?? "" : values;
  }
  return input;
}

async function bodyInput(request: NextRequest): Promise<unknown> {
  const body = await request.text();
  if (body.trim().length === 0) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new AppError("VALIDATION", "Request body must be valid JSON");
  }
}

function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const flattened = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  return Object.fromEntries(
    Object.entries(flattened).flatMap(([field, messages]) => messages?.[0] ? [[field, messages[0]]] : []),
  );
}

export function defineHandler<Input, Output>(options: {
  auth: AuthGuard;
  input: z.ZodType<Input>;
  handler: (context: HandlerContext<Input>) => Promise<Output>;
}) {
  return async (request: NextRequest, route?: { params?: Promise<RouteParams> }) => {
    const startedAt = Date.now();
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    let eventId: EventId | null = null;
    try {
      const params = await route?.params ?? {};
      const rawEventId = params?.eventId;
      if (typeof rawEventId === "string") eventId = eventIdSchema.parse(rawEventId);
      const session = await options.auth(request, eventId, params);
      eventId ??= session?.eventId ?? null;
      const rawInput: unknown = request.method === "GET"
        ? queryInput(request.nextUrl.searchParams)
        : await bodyInput(request);
      const input = options.input.parse(rawInput);
      const data = await options.handler({ eventId, session, input, params, req: request, requestId });
      log({ level: "info", msg: "request.complete", requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json({ data });
    } catch (error) {
      const appError = isAppError(error)
        ? error
        : error instanceof z.ZodError
          ? new AppError("VALIDATION", "Request validation failed")
          : new AppError("INTERNAL", "Unexpected server error");
      const envelope = apiErrorSchema.parse({
        error: error instanceof z.ZodError
          ? { code: appError.code, message: appError.message, fieldErrors: zodFieldErrors(error) }
          : { code: appError.code, message: appError.message, data: appError.details },
      });
      log({ level: appError.code === "INTERNAL" ? "error" : "warn", msg: "request.failed", code: appError.code, requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json(envelope, { status: toHttp(appError.code) });
    }
  };
}
