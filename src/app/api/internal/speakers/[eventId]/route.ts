import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { createSpeaker, getSpeakerDetail, listContacts, type ContactFilters } from "@/features/portal";
import { createSpeakerInputSchema, eventIdSchema, SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * The Speakers admin table's rows. Filters mirror `SPEAKERS_DEEPLINK_PARAMS`
 * exactly (M02 §9b) so the dashboard's missing-asset links and this route
 * never drift apart on param names.
 */
const listFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  accepted: z.enum(SPEAKERS_DEEPLINK_PARAMS.accepted).optional().transform((value) => value === "1"),
  missing: z.enum(SPEAKERS_DEEPLINK_PARAMS.missing).optional(),
  confirmation: z.enum(SPEAKERS_DEEPLINK_PARAMS.confirmation).optional(),
  sort: z.enum(SPEAKERS_DEEPLINK_PARAMS.sort).optional(),
  dir: z.enum(SPEAKERS_DEEPLINK_PARAMS.dir).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

const list = defineHandler({
  auth: adminAuth(),
  input: listFiltersSchema,
  handler: async ({ eventId, input }) => {
    // Rebuilt rather than passed straight through: zod's `.optional()` types
    // each field `T | undefined`, which `exactOptionalPropertyTypes` treats as
    // a different (wider) shape than `ContactFilters`'s plain `T?` — spreading
    // only the keys actually present keeps the two in sync without loosening
    // the shared type.
    const filters: ContactFilters = {
      ...(input.q ? { q: input.q } : {}),
      accepted: input.accepted,
      ...(input.missing ? { missing: input.missing } : {}),
      ...(input.confirmation ? { confirmation: input.confirmation } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
      ...(input.dir ? { dir: input.dir } : {}),
      ...(input.page ? { page: input.page } : {}),
      ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    };
    return listContacts(eventIdSchema.parse(eventId), filters);
  },
});

/** Manual "Add speaker" (M51, work order step 2). */
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: createSpeakerInputSchema,
  handler: async ({ eventId, input }) => {
    const scopedEventId = eventIdSchema.parse(eventId);
    const contactId = await createSpeaker(scopedEventId, input);
    const detail = await getSpeakerDetail(scopedEventId, contactId);
    if (!detail) throw new AppError("INTERNAL", "Speaker was created but could not be read back");
    return detail;
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return create(request, route);
}
