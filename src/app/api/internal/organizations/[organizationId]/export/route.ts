import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { exportOrganizationData } from "@/features/data-lifecycle";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/**
 * M47 — the organization half of "contact/org data export". `organizationAuth()`
 * defaults to organizer, the same bar every other `[organizationId]/…` read
 * in this feature already sets (`members`, `audit-log`) — this bundle is a
 * composition of exactly those same reads plus the organization row and its
 * event directory, so it carries no new sensitivity beyond what an
 * organizer can already piece together from the existing endpoints.
 */
const get = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => {
    const bundle = await exportOrganizationData(requireOrganizationId(params));
    if (!bundle) throw new AppError("NOT_FOUND", "Organization not found");
    return bundle;
  },
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}
