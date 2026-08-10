import { NextRequest } from "next/server";
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

/**
 * `defineHandler` takes a non-GET request's whole body as its input, so a path
 * parameter has to be folded into that body before it is parsed. Rebuilding the
 * request keeps each route on one validated input object instead of a
 * schema-checked body plus a hand-read, unchecked path string.
 *
 * The path always wins: `/tasks/A` may not complete task B because the body
 * said so.
 */
export async function requestWithPathValues(
  request: NextRequest,
  values: Record<string, string>,
): Promise<NextRequest> {
  const text = await request.text();
  const headers = new Headers(request.headers);
  headers.delete("content-length");

  let parsed: unknown = {};
  try {
    if (text.trim().length > 0) parsed = JSON.parse(text);
  } catch {
    // Let the handler report the malformed JSON rather than throwing here,
    // where it would surface as a 500 instead of a 400.
    return new NextRequest(request.url, { method: request.method, headers, body: text });
  }

  const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? { ...parsed, ...values }
    : values;
  return new NextRequest(request.url, { method: request.method, headers, body: JSON.stringify(body) });
}
