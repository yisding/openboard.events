/**
 * Server barrel for the organization-level speaker CRM (M55). Built over
 * M43's `organizations` tenancy, M44's users, and M51's event-scoped
 * `contacts` — see each module's header comment for how the boundary is
 * kept (a new `organization_contacts` identity, never a widened `contacts`
 * row; every contacts write still goes through
 * `getOrCreateContact`/`updateContactFields`).
 */

export {
  getCrmMetrics,
  getCrmMetricsIn,
  getCrmPipelineHistory,
  getCrmPipelineHistoryIn,
  getCrmSegment,
  getCrmSegmentIn,
  getOrganizationContact,
  getOrganizationContactHistory,
  getOrganizationContactHistoryIn,
  getOrganizationContactIn,
  listCrmCustomFields,
  listCrmCustomFieldsIn,
  listCrmPipeline,
  listCrmPipelineIn,
  listCrmSegments,
  listCrmSegmentsIn,
  listCrmTags,
  listCrmTagsIn,
  listOrganizationContacts,
  listOrganizationContactsIn,
  resolveCrmSegment,
  resolveCrmSegmentIn,
} from "./server/queries";

export {
  createCrmCustomField,
  createCrmCustomFieldIn,
  createCrmNote,
  createCrmNoteIn,
  createCrmPipelineEntry,
  createCrmPipelineEntryIn,
  createCrmSegment,
  createCrmSegmentIn,
  createCrmTag,
  createCrmTagIn,
  createOrganizationContact,
  createOrganizationContactIn,
  pushOrganizationContactToEvent,
  pushOrganizationContactToEventIn,
  setCrmContactTags,
  setCrmContactTagsIn,
  transitionCrmPipeline,
  transitionCrmPipelineIn,
  updateOrganizationContact,
  updateOrganizationContactIn,
} from "./server/mutations";

export {
  getCrmMergeAudit,
  getCrmMergeAuditIn,
  mergeOrganizationContacts,
  mergeOrganizationContactsIn,
  previewCrmMerge,
  previewCrmMergeIn,
  recoverCrmMerge,
  recoverCrmMergeIn,
} from "./server/merge";

export { importCrmContactsCsv, importCrmContactsCsvIn } from "./server/csv-import";

export { composeCrmBulkEmail, composeCrmBulkEmailIn } from "./server/bulk-email";
