import type { NextRequest } from "next/server";
import { z } from "zod";
import { authenticatedAuth } from "@/features/auth";
import { listOrganizationsForUser } from "@/features/organizations";
import { userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

/** The organizations the signed-in identity belongs to, with their role in each — the "which workspace am I in" list, not scoped to any one of them. */
const list = defineHandler({
  auth: authenticatedAuth(),
  input: z.object({}),
  handler: async ({ session }) => {
    const userId = userIdSchema.parse(session?.actorId);
    const memberships = await listOrganizationsForUser(userId);
    return memberships.map(({ organization, role }) => ({ ...organization, role }));
  },
});

export function GET(request: NextRequest): Promise<Response> {
  return list(request);
}
