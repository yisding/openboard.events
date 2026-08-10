import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { revokeApiKey } from "@/features/dashboard/server/api-keys";
import { apiKeyIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

const revoke = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => {
    if (!eventId) throw new AppError("VALIDATION", "eventId is required");
    const id = apiKeyIdSchema.parse(params.id);
    await revokeApiKey(eventId, id);
    return { revoked: true };
  },
});

export function DELETE(request: NextRequest, route: { params: Promise<{ eventId: string; id: string }> }): Promise<Response> {
  return revoke(request, route);
}
