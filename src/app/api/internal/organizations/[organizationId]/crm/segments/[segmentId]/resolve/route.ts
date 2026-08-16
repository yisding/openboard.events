import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { getCrmSegment, resolveCrmSegment } from "@/features/crm";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { requireCrmSegmentId, requireOrganizationId } from "../../../_lib";

/** AC: "observe membership change after an underlying field edit" — this
 * route re-resolves the segment's stored filter on every call; there is no
 * cached membership to go stale. */
const resolve = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => {
    const organizationId = requireOrganizationId(params);
    // Validated, like every sibling in this directory. Passing the raw segment
    // straight to a `uuid` column meant a stale bookmark produced a Postgres
    // `22P02 invalid input syntax for type uuid`, which `errorEnvelope` maps to
    // INTERNAL: the organizer got a 500 instead of the NOT_FOUND two lines
    // below, and `captureError` filed it in `operational_error_buckets`,
    // inflating the recent-error count the alerting runbook pages on.
    const segmentId = requireCrmSegmentId(params);
    const segment = await getCrmSegment(organizationId, segmentId);
    if (!segment) throw new AppError("NOT_FOUND", "Segment not found");
    return resolveCrmSegment(organizationId, segment.filter);
  },
});

type Route = { params: Promise<{ organizationId: string; segmentId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return resolve(request, route);
}
