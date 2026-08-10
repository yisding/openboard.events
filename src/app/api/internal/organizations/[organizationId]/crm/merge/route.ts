import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { mergeOrganizationContacts } from "@/features/crm";
import { mergeCrmContactsInputSchema, userIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** Guardrail: merge is high-risk — the transactional commit (`withTx`,
 * `mergeOrganizationContactsIn`) reassigns references and tombstones the
 * losing identity in one all-or-nothing transaction; an audit row is always
 * written alongside it. Requires at least `organizer` (the default this
 * guard already enforces). */
const merge = defineHandler({
  auth: organizationAuth(),
  input: mergeCrmContactsInputSchema,
  handler: ({ params, session, input }) => {
    const actorUserId = session?.actorId ? userIdSchema.parse(session.actorId) : null;
    return mergeOrganizationContacts(requireOrganizationId(params), input, actorUserId);
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return merge(request, route);
}
