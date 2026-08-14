import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { deleteVocabItem, patchVocabItem, vocabItemPatchSchema, vocabKindSchema } from "@/features/events";
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
    await deleteVocabItem(scopedEventId, route.kind, route.id);
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
