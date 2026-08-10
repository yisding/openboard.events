import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { getCrmMetrics } from "@/features/crm";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** AC: "organization-wide directory, engagement, reuse, and pipeline
 * metrics." */
const metrics = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: ({ params }) => getCrmMetrics(requireOrganizationId(params)),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return metrics(request, route);
}
