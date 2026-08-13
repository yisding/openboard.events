import type { NextRequest } from "next/server";
import { z } from "zod";
import { organizationAuth } from "@/features/auth";
import { listOrganizationMembers } from "@/features/organizations";
import { defineHandler } from "@/shared/server/handler";
import { requireOrganizationId } from "../_lib";

const list = defineHandler({
  auth: organizationAuth(),
  input: z.object({}),
  handler: async ({ params }) => listOrganizationMembers(requireOrganizationId(params)),
});

type Route = { params: Promise<{ organizationId: string }> };

export function GET(request: NextRequest, route: Route): Promise<Response> {
  return list(request, route);
}
