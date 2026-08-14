import type { NextRequest } from "next/server";
import { z } from "zod";
import { agendaAuth } from "@/features/agenda";
import { getAcceptedForScheduling } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

const listAccepted = defineHandler({
  auth: agendaAuth(),
  input: z.object({ eventId: eventIdSchema }),
  handler: ({ eventId }) => getAcceptedForScheduling(eventIdSchema.parse(eventId)),
});

export function GET(request: NextRequest): Promise<Response> {
  return listAccepted(request);
}
