import { NextRequest } from "next/server";
import { z } from "zod";
import { apiKeyAuth } from "@/features/auth";
import { listLog } from "@/features/comms";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { corsPreflight, v1RateLimit, withV1PrivateHeaders } from "../../../_lib";
import { toPublicCommLogRow } from "../../../server/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

/**
 * `listLog` returns `CommLogRow`, which does not carry the rendered body at
 * all (`CommLogDetail` is M37-only, admin-side). `toPublicCommLogRow`
 * additionally drops `subjectRendered` and every internal id — a rendered
 * subject can itself carry a live magic link (`portal_login`), and none of
 * those ids are this audience's business.
 */
const commsLog = defineHandler({
  auth: apiKeyAuth(),
  input: z.object({
    limit: z.coerce.number().int().positive().optional(),
  }),
  rateLimit: v1RateLimit("comms-log"),
  handler: async ({ eventId, input }) => {
    if (!eventId) throw new AppError("UNAUTHORIZED", "Invalid API key");
    const limit = Math.min(input.limit ?? 50, 200);
    const rows = await listLog(eventId, { limit });
    return rows.map(toPublicCommLogRow);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ slug: string }> }): Promise<Response> {
  return withV1PrivateHeaders(await commsLog(request, route));
}
