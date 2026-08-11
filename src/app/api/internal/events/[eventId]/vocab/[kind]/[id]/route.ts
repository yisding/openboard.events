import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { deleteVocabItem, patchVocabItem, vocabItemPatchSchema, vocabKindSchema } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ kind: vocabKindSchema, id: z.uuid() });

const update = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: vocabItemPatchSchema,
  handler: async ({ eventId, input, params }) => {
    const route = routeParams.parse(params);
    return patchVocabItem(eventIdSchema.parse(eventId), route.kind, route.id, input);
  },
});

const remove = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    const route = routeParams.parse(params);
    await deleteVocabItem(eventIdSchema.parse(eventId), route.kind, route.id);
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
