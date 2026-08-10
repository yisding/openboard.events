import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema } from "@/shared/contracts";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { createForm } from "@/features/forms/server/builder-mutations";
import { listForms } from "@/features/forms/server/builder-queries";
import { defineHandler } from "@/shared/server/handler";

const createInput = z.object({
  internalName: z.string().trim().min(1).max(255),
  kind: z.enum(["abstract", "session"]),
  collectParticipants: z.boolean(),
});

const list = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({ eventId: eventIdSchema }),
  handler: async ({ eventId }) => listForms(eventIdSchema.parse(eventId)),
});

const create = defineHandler({
  auth: formBuilderAuth(),
  input: createInput,
  handler: async ({ eventId, input }) => createForm(eventIdSchema.parse(eventId), input),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return create(request);
}
