import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { getCrmMergeAudit } from "@/features/crm";
import { AppError } from "@/shared/lib/errors";
import { defineHandler } from "@/shared/server/handler";
import { requireCrmMergeId, requireOrganizationId } from "../../_lib";

const get = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => {
    const audit = await getCrmMergeAudit(requireOrganizationId(params), requireCrmMergeId(params));
    if (!audit) throw new AppError("NOT_FOUND", "Merge audit not found");
    return audit;
  },
});

type Route = { params: Promise<{ organizationId: string; mergeId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return get(request, route);
}
