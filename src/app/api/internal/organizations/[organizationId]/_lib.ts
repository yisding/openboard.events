import { organizationIdSchema, type OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { RouteParams } from "@/shared/server/handler";

export function requireOrganizationId(params: RouteParams): OrganizationId {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}
