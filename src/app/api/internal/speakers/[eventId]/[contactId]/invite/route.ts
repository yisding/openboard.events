import { NextRequest } from "next/server";
import { z } from "zod";
import { withTx } from "@/db/client";
import { adminAuth } from "@/features/auth";
import { getEvent } from "@/features/events";
import { getSpeakerDetail } from "@/features/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { defineHandler } from "@/shared/server/handler";
import { inviteSpeakerToPortalIn } from "./_lib";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * M51 — explicit portal invitation (work order step 4). This is not a new
 * credential path: it calls M06b's exact `requestPortalLoginIn` inside one
 * route-owned transaction, so token rotation and the durable email outbox
 * commit with the organizer's pipeline marker. That is also why this route
 * lives at the composition layer rather than inside the `portal` feature:
 * `portal` cannot import `auth` (the reverse import already exists —
 * `requestPortalLoginIn` calls `getOrCreateContact` — so a route, not a
 * feature-to-feature import, is where the two meet).
 */
const invite = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const [event, speaker] = await Promise.all([
      getEvent(scopedEventId),
      getSpeakerDetail(scopedEventId, contactId),
    ]);
    if (!event) throw new AppError("NOT_FOUND", "Event not found");
    if (!speaker) throw new AppError("NOT_FOUND", "Speaker not found");
    const env = getEnv();
    const sessionSecret = env.SESSION_SECRET;
    if (!sessionSecret) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal authentication");
    const result = await withTx((tx) => inviteSpeakerToPortalIn(tx, {
      eventId: scopedEventId,
      eventSlug: event.slug,
      contactId,
      email: speaker.contact.email,
      confirmationStatus: speaker.contact.confirmationStatus,
      appBaseUrl: env.APP_BASE_URL,
      sessionSecret,
      fallback: env.APP_ENV !== "production" && env.EMAIL_FALLBACK_UI === "1",
    }));
    return { message: result.message };
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return invite(request, route);
}
