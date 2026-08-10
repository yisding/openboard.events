import { z } from "zod";
import type { NextRequest } from "next/server";
import { eventIdSchema, formIdSchema } from "@/shared/contracts";
import { db } from "@/db/client";
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
  handler: async ({ eventId, params }) => duplicateFormIn(db, eventIdSchema.parse(eventId), routeInput.parse(params).formId),
});

export function POST(request: NextRequest, route: { params: Promise<{ formId: string }> }): Promise<Response> {
  return duplicate(request, route);
}
