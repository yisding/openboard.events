import { NextRequest } from "next/server";
import { z } from "zod";
import { apiKeyAuth } from "@/features/auth";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { corsPreflight, v1RateLimit, withV1PrivateHeaders } from "../../../../_lib";
import { listOutstandingTasks } from "../../../../server/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

/**
 * Reads `speaker_outstanding_v` — the same view the dashboard's Speaker
 * Tracking panel and the portal's task counts read — so a judge's number here
 * can never disagree with what an organizer sees in the admin.
 */
const outstandingTasks = defineHandler({
  auth: apiKeyAuth(),
  input: z.object({}),
  rateLimit: v1RateLimit("outstanding-tasks"),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("UNAUTHORIZED", "Invalid API key");
    return listOutstandingTasks(eventId);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ slug: string }> }): Promise<Response> {
  return withV1PrivateHeaders(await outstandingTasks(request, route));
}
