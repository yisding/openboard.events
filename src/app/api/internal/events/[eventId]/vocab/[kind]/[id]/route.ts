import type { NextRequest } from "next/server";
import { z } from "zod";
import { withTx } from "@/db/client";
import { dischargeStrandedScheduleNoticesIn } from "@/features/agenda";
import { adminAuth } from "@/features/auth";
import { deleteVocabItemIn, patchVocabItem, vocabItemPatchSchema, vocabKindSchema } from "@/features/events";
import { revalidatePublicEvent } from "@/features/public/server/revalidate";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ kind: vocabKindSchema, id: z.uuid() });

const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: vocabItemPatchSchema,
  handler: async ({ eventId, input, params, requestId }) => {
    const route = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    const updated = await patchVocabItem(scopedEventId, route.kind, route.id, input);
    if (route.kind !== "tags") await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return updated;
  },
});

const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params, requestId }) => {
    const route = routeParams.parse(params);
    const scopedEventId = eventIdSchema.parse(eventId);
    // Deleting a room strands every published, timed session placed in it, and
    // those speakers are holding a calendar item that now names a room nobody
    // can find. The cascade cannot mail them itself — it is one statement in the
    // events feature, and the notifier belongs to the agenda — so the two halves
    // are composed here, in the deletion's own transaction. Same transaction, not
    // a follow-up call: a committed deletion whose notices were lost is the exact
    // defect this closes (#622), and rolling the delete back on an outbox failure
    // leaves the organizer with a coherent "nothing happened, try again" instead.
    await withTx(async (tx) => {
      await deleteVocabItemIn(tx, scopedEventId, route.kind, route.id);
      if (route.kind === "rooms") await dischargeStrandedScheduleNoticesIn(tx, scopedEventId);
    });
    if (route.kind !== "tags") await revalidatePublicEvent(scopedEventId, ["schedule", "speakers"], requestId);
    return { deleted: true };
  },
});

type Route = { params: Promise<{ eventId: string; kind: string; id: string }> };

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return remove(request, route);
}
