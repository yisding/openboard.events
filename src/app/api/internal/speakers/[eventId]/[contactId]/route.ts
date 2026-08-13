import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth, requireOrganizationAdmin } from "@/features/auth";
import { eraseContactData } from "@/features/data-lifecycle";
import { getEventOrganization } from "@/features/organizations";
import { getSpeakerDetail, setConfirmationStatus, updateSpeakerBio, updateSpeakerEmail, updateSpeakerHeadshot } from "@/features/portal";
import { CONFIRMATION_STATUSES, contactIdSchema, type EventId, eventIdSchema, fileIdSchema } from "@/shared/contracts";
import { AppError, isAppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { revalidatePublicEvent } from "@/shared/server/revalidate-public";

export const dynamic = "force-dynamic";

const routeParams = z.object({ contactId: contactIdSchema });

/**
 * Organizer-only, by `adminAuth`'s default: this row carries the speaker's name
 * and email beside the codes and titles of every submission they are on, which
 * is exactly the join that would undo an anonymized review round. The Speakers
 * page has always required organizer; the route now agrees with it.
 */
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
 * Every field is an independent single-column write through
 * `updateContactFields` (resolution #13); a request may send any subset.
 * Neither is one of the eight `withTx`-audited functions.
 */
const patchSchema = z.object({
  email: z.email().optional(),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES).optional(),
  // M52 — organizer-edited bio/headshot, through the same contact/file paths
  // the speaker's own portal profile uses.
  bioHtml: z.string().max(20_000).optional(),
  headshotFileId: fileIdSchema.nullable().optional(),
}).refine(
  (input) => input.email !== undefined || input.confirmationStatus !== undefined
    || input.bioHtml !== undefined || input.headshotFileId !== undefined,
  { message: "Provide at least one field to update" },
);

const patch = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: patchSchema,
  handler: async ({ eventId, input, params, requestId }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    if (input.email !== undefined) await updateSpeakerEmail(scopedEventId, contactId, input.email);
    // Setting `declined` removes this speaker from `published_speakers_v`
    // (resolution #15's manual counterpart) — the UI carries the warning, this
    // route just performs the write.
    if (input.confirmationStatus !== undefined) await setConfirmationStatus(scopedEventId, contactId, input.confirmationStatus);
    if (input.bioHtml !== undefined) await updateSpeakerBio(scopedEventId, contactId, input.bioHtml);
    if (input.headshotFileId !== undefined) await updateSpeakerHeadshot(scopedEventId, contactId, input.headshotFileId);
    // Confirmation decides membership of `published_speakers_v`, and the
    // bio/headshot are what the public speaker page renders, so the public
    // surfaces are asked back rather than left to the 60s ISR window.
    if (input.confirmationStatus !== undefined || input.bioHtml !== undefined || input.headshotFileId !== undefined) {
      await revalidatePublicEvent(scopedEventId, ["speakers", "schedule"], requestId);
    }
    const detail = await getSpeakerDetail(scopedEventId, contactId);
    if (!detail) throw new AppError("NOT_FOUND", "Speaker not found");
    return detail;
  },
});

/**
 * Does the caller hold organizer rights over the *organization* this event
 * files under, and not merely over the event? A non-member gets FORBIDDEN from
 * `requireOrganizationAdmin`, which is an answer here rather than a failure —
 * it downgrades the erasure below to event scope instead of rejecting it, so an
 * event-only organizer keeps a working erasure path for their own event.
 */
async function holdsOrganizationAuthority(eventId: EventId): Promise<boolean> {
  const organizationId = await getEventOrganization(eventId);
  if (!organizationId) return false;
  try {
    await requireOrganizationAdmin(organizationId, "organizer");
    return true;
  } catch (error) {
    if (isAppError(error) && (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")) return false;
    throw error;
  }
}

/**
 * M47 — right-to-erasure. `eraseContactData` is the audited, all-or-nothing
 * deletion (see its own doc comment); organizer-only, matching PATCH above
 * and for the same reason — this is the most destructive action available
 * on a speaker's record, not less sensitive than editing it.
 *
 * The guard above is `adminAuth`, which reads `event_members` and nothing
 * else, so it establishes event authority only — and erasure's step 5 reaches
 * *organization* scope: the CRM profile, its notes/pipeline/activity/tags/merge
 * snapshots, and every other event's link to it. An event organizer who holds
 * no `organization_members` row cannot so much as read the CRM
 * (`organizationAuth` -> FORBIDDEN), so they must not be able to destroy it
 * from here either. The organization half is therefore authorized separately,
 * against the event's own organization: hold organization organizer and the
 * erasure is the full one it always was; hold only the event role and it is
 * event-scoped — this event's contact and its CRM link go, the organization's
 * profile for that person stays. The receipt's `deletedCounts` says which
 * happened (`organizationContacts` is 0 for the event-only erasure).
 */
const del = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params, requestId }) => {
    const { contactId } = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const eraseOrganizationProfile = await holdsOrganizationAuthority(scopedEventId);
    const receipt = await eraseContactData(scopedEventId, contactId, { eraseOrganizationProfile });
    // An erased contact may have been a confirmed/published speaker — ask
    // the public surfaces back rather than wait out the 60s ISR window, the
    // same pattern PATCH already uses above.
    await revalidatePublicEvent(scopedEventId, ["speakers", "schedule"], requestId);
    return receipt;
  },
});

type Route = { params: Promise<{ eventId: string; contactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return patch(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return del(request, route);
}
