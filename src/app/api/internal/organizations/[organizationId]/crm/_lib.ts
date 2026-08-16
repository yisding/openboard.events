import { crmMergeIdSchema, crmPipelineIdSchema, crmSegmentIdSchema, organizationContactIdSchema, type CrmMergeId, type CrmPipelineId, type CrmSegmentId, type OrganizationContactId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import type { RouteParams } from "@/shared/server/handler";

export { requireOrganizationId } from "../_lib";

/** Shared route param readers for `/api/internal/organizations/[organizationId]/crm/**`. */

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

export function requireCrmSegmentId(params: RouteParams): CrmSegmentId {
  const raw = params.segmentId;
  if (typeof raw !== "string") throw new AppError("VALIDATION", "segmentId route parameter is required");
  return crmSegmentIdSchema.parse(raw);
}
