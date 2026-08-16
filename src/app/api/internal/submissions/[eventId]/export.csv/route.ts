import { NextRequest } from "next/server";
import { adminAuth } from "@/features/auth";
import { exportSubmissionsCsv, submissionFiltersSchema } from "@/features/submissions";
import { eventIdSchema } from "@/shared/contracts";
import { eventDayKey } from "@/shared/lib/time";
import { errorEnvelope } from "@/shared/server/handler";

export const dynamic = "force-dynamic";

function queryInput(searchParams: URLSearchParams): Record<string, string | string[]> {
  const input: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    input[key] = values.length === 1 ? values[0] ?? "" : values;
  }
  return input;
}

/** Mirrors `defineHandler`'s catch block (`src/shared/server/handler.ts`) so an
 *  error from this route still carries the same envelope shape every other
 *  internal route returns. */
function errorResponse(error: unknown, request?: Request): Response {
  const { envelope, status, headers } = errorEnvelope(error, {
    requestId: request?.headers.get("cf-ray") ?? crypto.randomUUID(),
    feature: "submissions",
    route: "/api/internal/submissions/[eventId]/export.csv",
  });
  return Response.json(envelope, { status, headers });
}

/**
 * The Options -> Export .CSV download for Program -> Abstracts.
 *
 * Deliberately not built on `defineHandler`: that helper always wraps its
 * result as `{ data }` JSON, and this route's entire point is a raw
 * `text/csv` body with a `Content-Disposition` header — the same reason
 * `src/app/cal/_responses.ts` bypasses it for `.ics` downloads. Auth still
 * goes through the same `adminAuth` guard every other Abstracts route uses,
 * and the eventId/query-string parsing follow the same shape `defineHandler`
 * would apply.
 */
export async function GET(request: NextRequest, route: { params: Promise<{ eventId: string }> }): Promise<Response> {
  try {
    const params = await route.params;
    const eventId = eventIdSchema.parse(params.eventId);
    await adminAuth({ role: "organizer" })(request, eventId, params);

    const filters = submissionFiltersSchema.parse(queryInput(request.nextUrl.searchParams));
    const result = await exportSubmissionsCsv(eventId, filters);

    // BOM prefixed here, not inside `toCsv`, so the pure serializer stays a
    // plain string function under test.
    const body = `\uFEFF${result.csv}`;
    const filename = `abstracts-${result.event.slug}-${eventDayKey(new Date(), result.event.timezone)}.csv`;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        ...(result.truncated ? { "X-Export-Truncated": "true" } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
