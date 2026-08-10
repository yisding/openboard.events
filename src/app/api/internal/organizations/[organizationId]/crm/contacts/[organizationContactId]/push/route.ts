import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { pushOrganizationContactToEvent } from "@/features/crm";
import { pushOrganizationContactToEventInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationContactId, requireOrganizationId } from "../../../_lib";

/** AC: "Push an existing organization contact into a new event; M51 shows
 * the speaker without duplicating the organization identity." */
const push = defineHandler({
  auth: organizationAuth(),
  input: pushOrganizationContactToEventInputSchema,
  handler: ({ params, input }) =>
    pushOrganizationContactToEvent(requireOrganizationId(params), requireOrganizationContactId(params), input.eventId),
});

type Route = { params: Promise<{ organizationId: string; organizationContactId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return push(request, route);
}
