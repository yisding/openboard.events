import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { resolveSpeakerSegment } from "@/features/comms";
import { eventIdSchema, speakerSegmentFilterSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * M46 — bulk segmented sends, resolve step. Turns a `SpeakerSegmentFilter`
 * into the `contactIds` the unchanged `POST .../bulk-email` route (M51,
 * one directory up) already accepts, so the UI can show "N speakers match"
 * and a preview before ever calling the send endpoint.
 */
const resolve = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: speakerSegmentFilterSchema,
  handler: ({ eventId, input }) => resolveSpeakerSegment(eventIdSchema.parse(eventId), input),
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return resolve(request, route);
}
