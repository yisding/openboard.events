import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { copyDemoScaffoldForActor } from "@/features/onboarding";
import { eventIdSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../../_lib";

/**
 * First Fair — "Start from my demo's setup" (design §5.4). The wizard's step
 * 1 checkbox calls this once, right after it creates the real event, so the
 * organizer's new event opens with the vocabulary and CFP form they already
 * built in the demo instead of a blank slate.
 *
 * Deliberately its own endpoint rather than a field on the onboarding event
 * create route: creating an event never depends on a demo existing, and
 * keeping the copy a separate, idempotent call means a failure here degrades
 * to "the checkbox didn't take" rather than losing the event the organizer
 * just named.
 */
const copyScaffoldRequestSchema = z.object({ eventId: eventIdSchema });

const post = defineHandler({
  auth: organizationAuth(),
  input: copyScaffoldRequestSchema,
  rateLimit: {
    limit: 20,
    windowMs: 5 * 60 * 1000,
    key: ({ params }) => `demo-copy-scaffold:${typeof params.organizationId === "string" ? params.organizationId : "unknown"}`,
  },
  handler: ({ session, input, params }) => copyDemoScaffoldForActor(
    userIdSchema.parse(session?.actorId),
    requireOrganizationId(params),
    input.eventId,
  ),
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return post(request, route);
}
