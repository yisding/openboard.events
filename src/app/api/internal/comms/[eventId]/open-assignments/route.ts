import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listOpenAssignmentsForContact } from "@/features/comms";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/** Populates the "Send reminder now" dialog's assignment picker (step 7). */
const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({ contactId: contactIdSchema }),
  handler: async ({ eventId, input }) => listOpenAssignmentsForContact(eventIdSchema.parse(eventId), input.contactId),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}
