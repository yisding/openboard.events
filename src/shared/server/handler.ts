import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { AppError, isAppError, toHttp } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";

export type AuthSession = { actorId: string; role: string } | null;
export type AuthGuard = (request: NextRequest, eventId: EventId | null) => Promise<AuthSession>;
export type HandlerGuard = AuthGuard;

type HandlerContext<Input> = {
  eventId: EventId | null;
  session: AuthSession;
  input: Input;
  req: NextRequest;
  requestId: string;
};

export function defineHandler<Input, Output>(options: {
  auth: AuthGuard;
  input: z.ZodType<Input>;
  handler: (context: HandlerContext<Input>) => Promise<Output>;
}) {
  return async (request: NextRequest, route?: { params?: Promise<Record<string, string | string[] | undefined>> }) => {
    const startedAt = Date.now();
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    let eventId: EventId | null = null;
    try {
      const params = await route?.params;
      const rawEventId = params?.eventId;
      if (typeof rawEventId === "string") eventId = eventIdSchema.parse(rawEventId);
      const session = await options.auth(request, eventId);
      const rawInput: unknown = request.method === "GET"
        ? Object.fromEntries(request.nextUrl.searchParams)
        : await request.json();
      const input = options.input.parse(rawInput);
      const data = await options.handler({ eventId, session, input, req: request, requestId });
      log({ level: "info", msg: "request.complete", requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json({ data });
    } catch (error) {
      const appError = isAppError(error)
        ? error
        : error instanceof z.ZodError
          ? new AppError("VALIDATION", "Request validation failed", { fieldErrors: z.flattenError(error).fieldErrors })
          : new AppError("INTERNAL", "Unexpected server error");
      const envelope = apiErrorSchema.parse({ error: { code: appError.code, message: appError.message, data: appError.details } });
      log({ level: appError.code === "INTERNAL" ? "error" : "warn", msg: "request.failed", code: appError.code, requestId, feature: "api", ...(eventId ? { eventId } : {}), durationMs: Date.now() - startedAt });
      return NextResponse.json(envelope, { status: toHttp(appError.code) });
    }
  };
}
