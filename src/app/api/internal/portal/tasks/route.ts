import type { NextRequest } from "next/server";
import { z } from "zod";
import { listMyTasks } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, sessionContactId } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * Everything routed to the signed-in speaker. The contact comes from the
 * session, so this URL returns a different — and correct — list per speaker and
 * carries no id anyone could substitute.
 */
const listMine = defineHandler({
  auth: portalQueryAuth,
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ input, session }) => ({ tasks: await listMyTasks(input.eventId, sessionContactId(session)) }),
});

export const GET = (request: NextRequest) => listMine(request);
