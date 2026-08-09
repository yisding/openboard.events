import type { NextRequest } from "next/server";
import { portalAuth } from "@/features/auth";
import { contactIdSchema, eventIdSchema, type ContactId } from "@/shared/contracts";
import type { AuthGuard, RouteParams } from "@/shared/server/handler";

/**
 * Portal routes are scoped by an event in the query string rather than in the
 * path, so the guard has to read it before it can authorize. Shared by every
 * portal endpoint so the parameter name and the failure behaviour are decided in
 * one place — two copies drift the moment one of them changes.
 */
export const portalQueryAuth: AuthGuard = async (request: NextRequest, _eventId, params: RouteParams) => {
  const eventId = eventIdSchema.parse(new URL(request.url).searchParams.get("eventId"));
  const session = await portalAuth()(request, eventId, params);
  return session ? { ...session, eventId } : null;
};

/** The signed-in contact. Throws rather than returning a nullable id no caller can use. */
export function sessionContactId(session: { actorId: string } | null): ContactId {
  return contactIdSchema.parse(session?.actorId);
}
