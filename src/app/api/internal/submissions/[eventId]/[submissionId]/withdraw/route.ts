import { NextRequest } from "next/server";
import { z } from "zod";
import { portalAuth } from "@/features/auth";
import { withdraw } from "@/features/submissions";
import { contactIdSchema, eventIdSchema, submissionIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * A speaker withdrawing their own proposal — the only status change the portal
 * can cause besides submitting a draft.
 *
 * The contact comes from the portal session and the submission id from the path;
 * neither is taken from the body, so the request carries nothing an attacker
 * could aim at somebody else's row. `withdraw` scopes its UPDATE by both, which
 * is what makes another speaker's submission indistinguishable from one that
 * does not exist.
 */
const withdrawSubmission = defineHandler({
  auth: portalAuth(),
  input: z.object({}),
  handler: async ({ eventId, params, session }) => {
    const submissionId = submissionIdSchema.parse(params.submissionId);
    await withdraw(
      eventIdSchema.parse(eventId),
      contactIdSchema.parse(session?.actorId),
      submissionId,
    );
    return { submissionId, status: "withdrawn" as const };
  },
});

export async function POST(request: NextRequest, route: { params: Promise<{ eventId: string; submissionId: string }> }): Promise<Response> {
  return withdrawSubmission(request, route);
}
