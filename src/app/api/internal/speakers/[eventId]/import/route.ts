import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { importSpeakersCsv } from "@/features/portal";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { eventIdSchema, importSpeakersCsvInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * M51 — CSV import (work order step 3). One route for both halves: `mode:
 * "preview"` parses and validates without writing (the "row-level errors,
 * downloadable" AC), `mode: "commit"` performs exactly the writes the most
 * recent preview described. The client sends the raw CSV text (read via
 * `FileReader`) rather than a multipart upload — `defineHandler` only parses
 * JSON bodies, and a speaker roster file is well within that budget.
 */
const importRoute = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: importSpeakersCsvInputSchema,
  handler: async ({ eventId, input, requestId }) => {
    const parsedEventId = eventIdSchema.parse(eventId);
    const result = await importSpeakersCsv(parsedEventId, input);
    if (input.mode === "commit") {
      await revalidatePublicEvent(parsedEventId, ["schedule", "speakers"], requestId);
    }
    return result;
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return importRoute(request, route);
}
