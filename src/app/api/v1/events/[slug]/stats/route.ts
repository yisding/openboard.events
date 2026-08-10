import { NextRequest } from "next/server";
import { z } from "zod";
import { apiKeyAuth } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { corsPreflight, v1RateLimit, withV1PrivateHeaders } from "../../../_lib";
import { toPublicStats } from "../../../server/queries";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

/**
 * `getOverview` is M38's aggregated dashboard query — the one place the
 * counting rules (non-draft submissions, `accepted_speakers_v`,
 * `task_assignments_v` fan-out) live. This route only prunes the two
 * UI-only fields (`attention` hrefs point at admin routes a keyed caller
 * cannot reach; `recentSubmissions` duplicates `/submissions`) — zero second
 * implementation of any count.
 */
const stats = defineHandler({
  auth: apiKeyAuth(),
  input: z.object({}),
  rateLimit: v1RateLimit("stats"),
  handler: async ({ eventId }) => {
    if (!eventId) throw new AppError("UNAUTHORIZED", "Invalid API key");
    const overview = await getOverview(eventId);
    return toPublicStats(overview);
  },
});

export async function GET(request: NextRequest, route: { params: Promise<{ slug: string }> }): Promise<Response> {
  return withV1PrivateHeaders(await stats(request, route));
}
