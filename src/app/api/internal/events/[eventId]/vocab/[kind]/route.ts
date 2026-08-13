import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { createVocabItem, listVocab, vocabItemInputSchema, vocabKindSchema } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const routeParams = z.object({ kind: vocabKindSchema });

const list = defineHandler({
  auth: adminAuth(),
  input: z.object({}),
  handler: async ({ eventId, params }) => listVocab(eventIdSchema.parse(eventId), routeParams.parse(params).kind),
});

// A supplied id is a create-request correlation token, not an update. Updates
// still go exclusively through `PATCH .../vocab/[kind]/[id]`.
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: vocabItemInputSchema,
  handler: async ({ eventId, input, params }) => createVocabItem(eventIdSchema.parse(eventId), routeParams.parse(params).kind, input),
});

type Route = { params: Promise<{ eventId: string; kind: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
