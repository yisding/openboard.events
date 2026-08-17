import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getRoomDeletionImpact, vocabKindSchema } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

/**
 * What deleting this vocabulary item would do, asked before it is done.
 *
 * Only rooms answer. Tracks and formats already state their consequences by
 * refusing the delete and naming the blockers, and a tag's is one sentence that
 * needs no count — so a shared "impact" endpoint that returned zeros for them
 * would be inventing a reassurance the caller never earned. An explicit refusal
 * keeps a future caller from reading that zero as "nothing is affected".
 */
const routeParams = z.object({ kind: vocabKindSchema, id: z.uuid() });

const impact = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const route = routeParams.parse(params);
    if (route.kind !== "rooms") throw new AppError("VALIDATION", "Only rooms report a deletion impact");
    return getRoomDeletionImpact(eventIdSchema.parse(eventId), route.id);
  },
});

type Route = { params: Promise<{ eventId: string; kind: string; id: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return impact(request, route);
}
