import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth, requestPortalLogin } from "@/features/auth";
import { getEvent } from "@/features/events";
import { getSpeakerDetail, updateSpeakerProfile } from "@/features/portal";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * M51 — explicit portal invitation (work order step 4). This is not a new
 * credential path: it calls M06b's exact `requestPortalLogin` — the same
 * audited `withTx` composition (getOrCreateContact → issue OTP/magic-link →
 * enqueue `portal_login`) a speaker's own "sign in" form triggers — with the
 * organizer supplying the address instead of the speaker typing it. That is
 * also why this route lives at the composition layer rather than inside the
 * `portal` feature: `portal` cannot import `auth` (the reverse import already
 * exists — `requestPortalLoginIn` calls `getOrCreateContact` — so a route,
 * not a feature-to-feature import, is where the two meet).
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
    const result = await requestPortalLogin(event.slug, speaker.contact.email);
    // A pure pipeline bookkeeping bump (drizzle/0008's header comment) — an
    // organizer clicking Invite is the clearest possible "contacted" signal,
    // and it never touches `confirmationStatus` or publication.
    if (speaker.contact.confirmationStatus === "unconfirmed") {
      await updateSpeakerProfile(scopedEventId, contactId, { workflowStatus: "invited" });
    }
    return { message: result.message };
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return invite(request, route);
}
