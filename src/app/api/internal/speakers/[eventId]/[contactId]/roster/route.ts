import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getSpeakerRosterExtras, updateSpeakerProfile } from "@/features/portal";
import { contactIdSchema, eventIdSchema, updateSpeakerProfileInputSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * M51 — everything the speaker editor's roster panel needs beyond M27's
 * `SpeakerDetailDTO`: logistics field definitions/values, declared
 * unavailability and organizer-visible uploaded assets, composed into one
 * read (`getSpeakerRosterExtras`) rather than four round trips.
 */
const get = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const extras = await getSpeakerRosterExtras(eventIdSchema.parse(eventId), contactId);
    if (!extras) throw new AppError("NOT_FOUND", "Speaker not found");
    return extras;
  },
});

const patch = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: updateSpeakerProfileInputSchema,
  handler: async ({ eventId, input, params }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    await updateSpeakerProfile(scopedEventId, contactId, input);
    const extras = await getSpeakerRosterExtras(scopedEventId, contactId);
    if (!extras) throw new AppError("NOT_FOUND", "Speaker not found");
    return extras;
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return patch(request, route);
}
