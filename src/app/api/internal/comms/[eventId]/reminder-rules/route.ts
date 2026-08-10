import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listReminderRules, reminderRulesInputSchema, saveReminderRules } from "@/features/comms";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => listReminderRules(eventIdSchema.parse(eventId)),
});

/** Replaces the whole ladder; returns the saved set so the UI never has to re-fetch. */
const save = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: reminderRulesInputSchema,
  handler: async ({ eventId, input }) => {
    const event = eventIdSchema.parse(eventId);
    await saveReminderRules(event, input.rules);
    return listReminderRules(event);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return list(request, route);
}

export async function PUT(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  return save(request, route);
}
