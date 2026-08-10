import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getSpeakerDetail, setConfirmationStatus, updateSpeakerEmail } from "@/features/portal";
import { CONFIRMATION_STATUSES, contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

const get = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const detail = await getSpeakerDetail(scopedEventId, contactId);
    // (eventId, contactId) scoped together (R4) — a contact id from another
    // event resolves to nothing here, never that event's row.
    if (!detail) throw new AppError("NOT_FOUND", "Speaker not found");
    return detail;
  },
});

/**
 * Both fields are independent single-column writes through
 * `updateContactFields` (resolution #13); a request may send either or both.
 * Neither is one of the eight `withTx`-audited functions.
 */
const patchSchema = z.object({
  email: z.email().optional(),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES).optional(),
}).refine((input) => input.email !== undefined || input.confirmationStatus !== undefined, {
  message: "Provide at least one field to update",
});

const patch = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: patchSchema,
  handler: async ({ eventId, input, params }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    if (input.email !== undefined) await updateSpeakerEmail(scopedEventId, contactId, input.email);
    // Setting `declined` removes this speaker from `published_speakers_v`
    // (resolution #15's manual counterpart) — the UI carries the warning, this
    // route just performs the write.
    if (input.confirmationStatus !== undefined) await setConfirmationStatus(scopedEventId, contactId, input.confirmationStatus);
    const detail = await getSpeakerDetail(scopedEventId, contactId);
    if (!detail) throw new AppError("NOT_FOUND", "Speaker not found");
    return detail;
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return patch(request, route);
}
