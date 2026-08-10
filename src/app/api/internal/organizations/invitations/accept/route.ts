import type { NextRequest } from "next/server";
import { authenticatedAuth, getAdminSession } from "@/features/auth";
import { acceptOrganizationInvitationByToken, acceptOrganizationInvitationInputSchema } from "@/features/organizations";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

/**
 * `/join?token=…`'s server half. No `organizationId` in the URL on purpose —
 * the token names its own organization, and the whole point of an invitation
 * is that the caller does not already know it (`authenticatedAuth`, not
 * `organizationAuth`). The identity's own email has to match the invitation's
 * — enforced inside `acceptOrganizationInvitationByTokenIn` — so a second
 * lookup of the full identity (not just `session.actorId`) happens here.
 */
const accept = defineHandler({
  auth: authenticatedAuth(),
  input: acceptOrganizationInvitationInputSchema,
  handler: async ({ input }) => {
    const identity = await getAdminSession();
    if (!identity) throw new AppError("UNAUTHORIZED", "Sign in required");
    return acceptOrganizationInvitationByToken(input.token, identity);
  },
});

export function POST(request: NextRequest): Promise<Response> {
  return accept(request);
}
