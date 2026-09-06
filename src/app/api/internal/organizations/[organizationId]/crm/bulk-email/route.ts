import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { nudgeOutboxAfterCommit } from "@/features/comms";
import { composeCrmBulkEmail } from "@/features/crm";
import { composeCrmBulkEmailInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** Delegates to M51's `composeBulkSpeakerEmailIn` per resolved event — the
 * existing outbox/compliance path, never a second sender. */
const compose = defineHandler({
  auth: organizationAuth(),
  input: composeCrmBulkEmailInputSchema,
  handler: async ({ params, input }) => {
    const result = await composeCrmBulkEmail(requireOrganizationId(params), input);
    if (input.mode === "send") nudgeOutboxAfterCommit();
    return result;
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return compose(request, route);
}
