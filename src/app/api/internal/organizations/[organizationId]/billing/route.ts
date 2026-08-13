import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { billingSurfaceUnavailableResponse, getOrganizationBillingSummary, isBillingSurfaceEnabled } from "@/features/billing";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/**
 * M49 — the billing settings surface's one read: current plan, subscription
 * status, and usage against the plan's limits. `organizationAuth()` defaults
 * to organizer, the same bar `members`/`audit-log`/`export` already set for
 * an organization-scoped read.
 */
const get = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => getOrganizationBillingSummary(requireOrganizationId(params)),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  if (!isBillingSurfaceEnabled()) return Promise.resolve(billingSurfaceUnavailableResponse());
  return get(request, route);
}
