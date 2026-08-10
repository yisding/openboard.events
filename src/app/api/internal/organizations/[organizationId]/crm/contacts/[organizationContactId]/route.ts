import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { getOrganizationContactHistory, updateOrganizationContact } from "@/features/crm";
import { updateOrganizationContactInputSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationContactId, requireOrganizationId } from "../../_lib";

/** One contact's complete cross-event history (AC: "inspect a contact's
 * complete event/session/activity history without leaking another
 * organization") and its field-scoped edit. */

const get = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => {
    const history = await getOrganizationContactHistory(requireOrganizationId(params), requireOrganizationContactId(params));
    if (!history) throw new AppError("NOT_FOUND", "Contact not found");
    return history;
  },
});

const update = defineHandler({
  auth: organizationAuth(),
  input: updateOrganizationContactInputSchema,
  handler: async ({ params, input }) => {
    await updateOrganizationContact(requireOrganizationId(params), requireOrganizationContactId(params), input);
    return { updated: true };
  },
});

type Route = { params: Promise<{ organizationId: string; organizationContactId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}

export function PATCH(request: NextRequest, route: Route): Promise<Response> {
  return update(request, route);
}
