import { crmMergeIdSchema, crmPipelineIdSchema, organizationContactIdSchema, organizationIdSchema, type CrmMergeId, type CrmPipelineId, type OrganizationContactId, type OrganizationId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { RouteParams } from "@/shared/server/handler";

/** Shared route param readers for `/api/internal/organizations/[organizationId]/crm/**`. */

export function requireOrganizationId(params: RouteParams): OrganizationId {
  const raw = params.organizationId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationId route parameter is required");
  return organizationIdSchema.parse(raw);
}

export function requireOrganizationContactId(params: RouteParams): OrganizationContactId {
  const raw = params.organizationContactId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "organizationContactId route parameter is required");
  return organizationContactIdSchema.parse(raw);
}

export function requirePipelineId(params: RouteParams): CrmPipelineId {
  const raw = params.pipelineId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "pipelineId route parameter is required");
  return crmPipelineIdSchema.parse(raw);
}

export function requireCrmMergeId(params: RouteParams): CrmMergeId {
  const raw = params.mergeId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "mergeId route parameter is required");
  return crmMergeIdSchema.parse(raw);
}
