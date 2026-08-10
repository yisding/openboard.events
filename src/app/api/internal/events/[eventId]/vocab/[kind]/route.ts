import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { listVocab, saveVocabItem, vocabItemInputSchema, vocabKindSchema } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ kind: vocabKindSchema });

const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => listVocab(eventIdSchema.parse(eventId), routeParams.parse(params).kind),
});

// `id` is dropped so this route can only ever create — updates go through
// `PATCH .../vocab/[kind]/[id]`, which is where an id is meaningful.
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: vocabItemInputSchema.omit({ id: true }),
  handler: async ({ eventId, input, params }) => saveVocabItem(eventIdSchema.parse(eventId), routeParams.parse(params).kind, input),
});

type Route = { params: Promise<{ eventId: string; kind: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
