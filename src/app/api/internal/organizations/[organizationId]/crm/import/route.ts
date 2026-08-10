import type { NextRequest } from "next/server";
import { organizationAuth } from "@/features/auth";
import { importCrmContactsCsv } from "@/features/crm";
import { importCrmContactsCsvInputSchema } from "@/shared/contracts";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

/** CSV import with preview/errors and organization-aware duplicate
 * detection (work order scope). `mode: "preview"` never writes. */
const importCsv = defineHandler({
  auth: organizationAuth(),
  input: importCrmContactsCsvInputSchema,
  handler: ({ params, input }) => importCrmContactsCsv(requireOrganizationId(params), input),
});

type Route = { params: Promise<{ organizationId: string }> };

export function POST(request: NextRequest, route: Route): Promise<Response> {
  return importCsv(request, route);
}
