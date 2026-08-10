import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticatedAuth, listAdminSessions } from "@/features/auth";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/** M44 — admin session views over M42's revocable session store. Self only: see `authenticatedAuth`'s doc comment. */
const list = defineHandler({
  auth: authenticatedAuth(),
  input: z.object({}),
  handler: async ({ session }) => listAdminSessions(userIdSchema.parse(session?.actorId)),
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}
