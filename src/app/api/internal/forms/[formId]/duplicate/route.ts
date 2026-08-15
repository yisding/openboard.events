import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { withTx } from "@/db/client";
import { duplicateFormIn } from "@/features/forms/server/builder-mutations";
import { formBuilderAuth } from "@/features/forms/server/guards";
import { defineHandler } from "@/shared/server/handler";

const routeInput = z.object({ formId: formIdSchema });

// M24 §7: "duplicate settings only" (plan/modules/M24-portal-form-builder.md),
// generic across context — the CFP builder and M24's portal builder both use
// this one endpoint, never a portal-only parallel path.
const duplicate = defineHandler({
  auth: formBuilderAuth(),
  input: z.object({}),
  // Four sequential inserts (form, sections, fields, version snapshot): a
  // failure partway leaves a form with no fields, which the builder renders as
  // an empty copy the organizer has to notice and delete by hand.
  handler: async ({ eventId, params }) => withTx(
    (tx) => duplicateFormIn(tx, eventIdSchema.parse(eventId), routeInput.parse(params).formId),
  ),
});

export function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return duplicate(request, route);
}
