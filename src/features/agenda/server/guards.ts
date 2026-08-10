import { requireAdmin } from "@/features/auth";
import { eventIdSchema, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { HandlerGuard } from "@/shared/server/handler";

/**
 * Every agenda route's guard.
 *
 * The agenda's routes are keyed by session, not by event, so there is no
 * `[eventId]` route segment to read — the event arrives as `?eventId=`, exactly
 * as the form builder's routes do it. Resolving it *here* rather than in each
 * handler is what makes "no handler queries without an event" structural:
 * `defineHandler` adopts the guard's `eventId`, so a handler that forgot to
 * scope its query would still be running under an authorization that failed
 * without one.
 */
export const agendaAuth = (options?: { role?: "owner" | "organizer" | "reviewer" }): HandlerGuard =>
  async (request, routeEventId) => {
    const raw = routeEventId ?? request.nextUrl.searchParams.get("eventId");
    const parsed = eventIdSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION", "eventId is required");
    const eventId: EventId = parsed.data;
    const session = await requireAdmin(eventId, options?.role ?? "organizer");
    return { actorId: session.userId, role: session.role, eventId };
  };
