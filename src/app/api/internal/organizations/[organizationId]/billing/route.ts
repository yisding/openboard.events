import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { getOrganizationBillingSummary } from "@/features/billing";
import { organizationIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";

function requireOrganizationId(params: Record<string, string | string[] | undefined>) {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

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
  return get(request, route);
}
