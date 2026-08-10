import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listSpeakerUnavailability, replaceSpeakerUnavailability } from "@/features/portal";
import { contactIdSchema, eventIdSchema, replaceUnavailabilityInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

const get = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const intervals = await listSpeakerUnavailability(eventIdSchema.parse(eventId), [contactId]);
    return { intervals };
  },
});

/**
 * Full-set replace (M51 work order): the editor always sends the complete
 * list of intervals it wants this speaker to have, in the event timezone
 * already converted to UTC ISO strings client-side — add/edit/remove are all
 * the same call. `replaceSpeakerUnavailabilityIn`'s one guarded CTE means
 * this can never leave a partial set even without a ninth `withTx`.
 */
const put = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: replaceUnavailabilityInputSchema,
  handler: async ({ eventId, input, params }) => {
    const { contactId } = routeParams.parse(params);
    const intervals = await replaceSpeakerUnavailability(eventIdSchema.parse(eventId), contactId, input.intervals);
    return { intervals };
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PUT(request: NextRequest, route: Route): Promise<Response> {
  return put(request, route);
}
