import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { reorderVocab, reorderVocabBodySchema, vocabKindSchema } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ kind: vocabKindSchema });

const reorder = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: reorderVocabBodySchema,
  handler: async ({ eventId, input, params }) => {
    await reorderVocab(eventIdSchema.parse(eventId), routeParams.parse(params).kind, input.orderedIds);
    return { reordered: true };
  },
});

export function POST(request: NextRequest, route: { params: Promise<{ eventId: string; kind: string }> }): Promise<Response> {
  return reorder(request, route);
}
