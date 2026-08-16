import { buildPublicScheduleIcs } from "@/features/public/server/public-ics";
import { apiV1ErrorResponse, checkV1RateLimit, corsPreflight, notFoundResponse } from "../../../../_lib";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

/**
 * Anonymous `.ics` export for the public schedule — every M53 surface's
 * "add to calendar" affordance (a single session on the sessions list/agenda,
 * or the itinerary's whole starred set) is one thin GET here, so there is
 * exactly one place that turns published sessions into an `.ics` file. No
 * auth: the data is already public (the same rows `/e/[slug]/*` renders),
 * and `buildPublicScheduleIcsIn` re-derives it from the live published view
 * on every call rather than trusting the `session` ids for anything beyond
 * "which of the currently-published sessions to include".
 *
 * `?session=<id>` may repeat or carry a comma-separated list. Omit it
 * entirely for the full published schedule; pass it with no ids for a valid,
 * empty calendar (a starred-nothing itinerary export).
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    await checkV1RateLimit("schedule-ics", request);
    const { slug } = await params;
    const url = new URL(request.url);
    const hasSessionParam = url.searchParams.has("session");
    const sessionIds = hasSessionParam
      ? url.searchParams.getAll("session").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean)
      : null;

    const result = await buildPublicScheduleIcs(slug, sessionIds);
    if (!result) return notFoundResponse();

    return new Response(result.ics, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${slug}-schedule.ics"`,
        "access-control-allow-origin": "*",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return apiV1ErrorResponse(error, request, "/api/v1/events/[slug]/schedule/ics");
  }
}
