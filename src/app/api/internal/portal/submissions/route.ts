import type { NextRequest } from "next/server";
import { z } from "zod";
import { listMySubmissions } from "@/features/portal";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { portalQueryAuth, sessionContactId } from "../_lib";

export const dynamic = "force-dynamic";

/**
 * The speaker's own submissions. The query joins through
 * submission_participants, so there is no id here a caller could substitute.
 */
const listMine = defineHandler({
  auth: portalQueryAuth,
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ input, session }) => ({
    submissions: await listMySubmissions(input.eventId, sessionContactId(session)),
  }),
});

export const GET = (request: NextRequest) => listMine(request);
