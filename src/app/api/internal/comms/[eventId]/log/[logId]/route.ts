import { NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/features/auth";
import { getLogDetail } from "@/features/comms";
import { commLogIdSchema, eventIdSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

/**
 * Row click → sheet (step 6). The log id is a path segment, not a body field —
 * `params.logId` is read directly rather than folded through the input schema,
 * matching the read-only GET convention the submissions detail route uses.
 */
const detail = defineHandler({
  auth: adminAuth({ role: "organizer" }),
  input: z.object({}),
  handler: async ({ eventId, params }) => getLogDetail(eventIdSchema.parse(eventId), commLogIdSchema.parse(params.logId)),
});

export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string; logId: string }> }): Promise<Response> {
  return detail(request, route);
}
