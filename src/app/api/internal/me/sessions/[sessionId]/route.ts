import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticatedAuth, revokeAdminSessionById } from "@/features/auth";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

const revoke = defineHandler({
  auth: authenticatedAuth(),
  input: z.object({}),
  handler: async ({ params, session }) => {
    const sessionId = z.string().min(1).parse(params.sessionId);
    await revokeAdminSessionById(userIdSchema.parse(session?.actorId), sessionId);
    return { revoked: true };
  },
});

type Route = { params: Promise<{ sessionId: string }> };

export function DELETE(request: NextRequest, route: Route): Promise<Response> {
  return revoke(request, route);
}
