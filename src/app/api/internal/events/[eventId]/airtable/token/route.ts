import type { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { airtableTokenInputSchema, validateAirtableToken } from "@/features/airtable";
import { userIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The one request in the product that carries a customer's Airtable personal
 * access token, and the only one that ever will.
 *
 * It crosses the wire once, in this POST body, over the same origin-checked
 * cookie-authed channel every other settings mutation uses, and is sealed
 * server-side before the response is written. `defineHandler` logs
 * `request.complete` with a request id and a duration — never a body — so the
 * token is not in a log line either. Nothing this route returns has a shape
 * that could carry it back.
 *
 * Rate limited because it is an *outbound-call* endpoint: unbounded, it is a
 * free authenticated proxy for probing Airtable tokens. Ten a minute is
 * generous for a person typing into one field and useless for a script.
 */
const validate = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: airtableTokenInputSchema,
  rateLimit: {
    limit: 10,
    windowMs: 60_000,
    key: ({ eventId, session }) => `airtable-token:${eventId ?? "none"}:${session?.actorId ?? "anon"}`,
  },
  handler: async ({ eventId, input, session }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    const connectedByUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    const { summary, verdict } = await validateAirtableToken(eventId, { pat: input.token, connectedByUserId });
    return { connection: summary, verdict };
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return validate(request, route);
}
