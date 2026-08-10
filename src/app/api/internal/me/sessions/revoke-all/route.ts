import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticatedAuth, revokeAdminSessions } from "@/features/auth";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/** "Sign out everywhere" — including the caller's own current session. */
const revokeAll = defineHandler({
  auth: authenticatedAuth(),
  input: z.object({}),
  handler: async ({ session }) => ({ revoked: await revokeAdminSessions(userIdSchema.parse(session?.actorId)) }),
});

export function POST(request: NextRequest): Promise<Response> {
  return revokeAll(request);
}
