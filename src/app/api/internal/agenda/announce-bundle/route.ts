import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth, getAnnounceBundle } from "@/features/agenda";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const announceBundle = defineHandler({
  auth: agendaAuth(),
  input: z.object({ eventId: eventIdSchema }),
  handler: ({ eventId }) => getAnnounceBundle(eventIdSchema.parse(eventId)),
});

export function GET(request: NextRequest): Promise<Response> {
  return announceBundle(request);
}
