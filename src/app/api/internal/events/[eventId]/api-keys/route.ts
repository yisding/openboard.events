import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { apiKeyCreationOperationSchema } from "@/features/dashboard/api-key-creation";
import { createApiKey, listApiKeys } from "@/features/dashboard/server/api-keys";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const list = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return listApiKeys(eventId);
  },
});

// Returns the caller's frozen plaintext only for a new create or its exact
// receipt-backed replay. `listApiKeys` never carries it, and it is never logged
// or stored (`api-keys.ts`).
const create = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: apiKeyCreationOperationSchema,
  handler: async ({ eventId, input }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    return createApiKey(eventId, input);
  },
});

type Route = { params: Promise<{ eventId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return create(request, route);
}
