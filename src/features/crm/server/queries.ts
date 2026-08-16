import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  contacts,
  events,
  organizationContactActivity,
  organizationContactCustomFields,
  organizationContactLinks,
  organizationContactNotes,
  organizationContactPipeline,
  organizationContactPipelineHistory,
  organizationContactSegments,
  organizationContactTagLinks,
  organizationContactTags,
  organizationContacts,
  sessionSpeakers,
  sessions,
  users,
} from "@/db/schema";
import {
  contactIdSchema,
  crmActivityDtoSchema,
  crmCustomFieldDtoSchema,
  crmMetricsDtoSchema,
  crmNoteDtoSchema,
  crmPipelineEntryDtoSchema,
  crmPipelineHistoryEntryDtoSchema,
  crmSegmentDtoSchema,
  crmTagDtoSchema,
  directoryPageDtoSchema,
  eventIdSchema,
  organizationContactDtoSchema,
  organizationContactHistoryDtoSchema,
  organizationContactSummaryDtoSchema,
  resolvedCrmSegmentSchema,
  sessionIdSchema,
  type CrmMetricsDTO,
  type CrmPipelineId,
  type CrmPipelineStage,
  type CrmSegmentFilter,
  type DirectoryFilter,
  type DirectoryPageDTO,
  type OrganizationContactDTO,
  type OrganizationContactHistoryDTO,
  type OrganizationContactId,
  type OrganizationContactSummaryDTO,
  type OrganizationId,
  type ResolvedCrmSegment,
} from "@/shared/contracts";

/**
 * M55 — organization-level speaker CRM reads. Every function takes
 * `organizationId` as its first, never-optional argument and puts it in the
 * WHERE clause of every query — the same "scope is in the query, not
 * inferred" discipline `organizations/server/queries.ts` documents. None of
 * these are audited `withTx` functions (PLAN resolution #4); read-only.
 */

const MAX_SEGMENT_RECIPIENTS = 2_000;
const PREVIEW_SAMPLE = 50;

// `= ANY($1)` needs the driver to serialize a JS array as a Postgres array
// parameter, which neon-http/PGlite do not both do reliably for this
// codebase's driver mix. `IN (a, b, c)` with each value its own bound
// parameter is the same predicate with no array-serialization dependency.
function sqlIn(values: readonly string[]) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function toContactDto(row: typeof organizationContacts.$inferSelect): OrganizationContactDTO {
  return organizationContactDtoSchema.parse({
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    company: row.company,
    jobTitle: row.jobTitle,
    bioHtml: row.bioHtml,
    linkedinUrl: row.linkedinUrl,
    twitterUrl: row.twitterUrl,
    websiteUrl: row.websiteUrl,
    source: row.source,
    customFields: (row.customFields ?? {}) as Record<string, string>,
    mergedIntoId: row.mergedIntoId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export async function getOrganizationContactIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId): Promise<OrganizationContactDTO | null> {
  const [row] = await dbOrTx.select().from(organizationContacts)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, id)))
    .limit(1);
  return row ? toContactDto(row) : null;
}
export const getOrganizationContact = (organizationId: OrganizationId, id: OrganizationContactId): Promise<OrganizationContactDTO | null> =>
  getOrganizationContactIn(db, organizationId, id);

/**
 * Directory search/filter (AC: "search/filter across at least two events").
 * Raw SQL (not the query builder) so tag names, event-touch count and last
 * activity can be aggregated in one round trip rather than N+1 follow-up
 * queries per row — the same style `dashboard/server/queries.ts` uses for
 * its own multi-aggregate reads. Every dynamic predicate is still a bound
 * parameter, never string-interpolated.
 */
export async function listOrganizationContactsIn(dbOrTx: DbOrTx, organizationId: OrganizationId, filter: DirectoryFilter): Promise<DirectoryPageDTO> {
  const predicates = [sql`oc.organization_id = ${organizationId}`, sql`oc.merged_into_id IS NULL`];
  if (filter.search) {
    const like = `%${filter.search.toLowerCase()}%`;
    predicates.push(sql`(lower(oc.email) LIKE ${like} OR lower(oc.first_name || ' ' || oc.last_name) LIKE ${like} OR lower(coalesce(oc.company,'')) LIKE ${like})`);
  }
  if (filter.source && filter.source.length > 0) predicates.push(sql`oc.source IN (${sqlIn(filter.source)})`);
  if (filter.tagIds && filter.tagIds.length > 0) {
    // ALL listed tags must be present — a HAVING count match on the join below.
    predicates.push(sql`oc.id IN (
      SELECT organization_contact_id FROM organization_contact_tag_links
      WHERE tag_id IN (${sqlIn(filter.tagIds)}) AND organization_contact_id = oc.id
      GROUP BY organization_contact_id HAVING count(*) = ${filter.tagIds.length}
    )`);
  }
  if (filter.eventIds && filter.eventIds.length > 0) {
    predicates.push(sql`EXISTS (SELECT 1 FROM organization_contact_links l WHERE l.organization_contact_id = oc.id AND l.event_id IN (${sqlIn(filter.eventIds)}))`);
  }
  if (filter.hasEventLink !== undefined) {
    const exists = sql`EXISTS (SELECT 1 FROM organization_contact_links l WHERE l.organization_contact_id = oc.id)`;
    predicates.push(filter.hasEventLink ? exists : sql`NOT ${exists}`);
  }
  if (filter.pipelineStage && filter.pipelineStage.length > 0) {
    predicates.push(sql`EXISTS (SELECT 1 FROM organization_contact_pipeline p WHERE p.organization_contact_id = oc.id AND p.stage IN (${sqlIn(filter.pipelineStage)}))`);
  }
  if (filter.customFields) {
    // Values live inline on `oc.custom_fields` (a JSON object keyed by the
    // field definition's `key`). Each entry is an exact-match predicate on
    // that key's text, so multiple entries AND together with each other and
    // with every predicate above. Both the key and the value are bound
    // parameters — `->>` extracts the text at a parameterized key, never an
    // interpolated one.
    for (const [key, value] of Object.entries(filter.customFields)) {
      predicates.push(sql`oc.custom_fields ->> ${key} = ${value}`);
    }
  }
  const where = sql.join(predicates, sql` AND `);

  const countResult = await dbOrTx.execute(sql`SELECT count(*)::int AS n FROM organization_contacts oc WHERE ${where}`);
  const total = Number((countResult.rows[0] as { n: number } | undefined)?.n ?? 0);

  const rowsResult = await dbOrTx.execute(sql`
    SELECT
      oc.*,
      -- DISTINCT, because the column is headed "Events". A merge re-points every
      -- one of the loser's links at the primary with a plain UPDATE, and the
      -- table's uniqueness is (event_id, contact_id) rather than
      -- (event_id, organization_contact_id) -- so two links to the *same* event
      -- survive on the primary and the count inflated by one for every alias
      -- merged in that shared an event. The metrics card for the same data
      -- already counts DISTINCT event_id, so the two surfaces disagreed.
      coalesce((SELECT count(DISTINCT l.event_id)::int FROM organization_contact_links l WHERE l.organization_contact_id = oc.id), 0) AS event_count,
      (SELECT max(created_at) FROM organization_contact_activity a WHERE a.organization_contact_id = oc.id) AS last_activity_at,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
        FROM organization_contact_tag_links tl JOIN organization_contact_tags t ON t.id = tl.tag_id
        WHERE tl.organization_contact_id = oc.id
      ), '[]'::jsonb) AS tags
    FROM organization_contacts oc
    WHERE ${where}
    ORDER BY oc.updated_at DESC, oc.id
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);

  const rows = (rowsResult.rows as Record<string, unknown>[]).map((row): OrganizationContactSummaryDTO => organizationContactSummaryDtoSchema.parse({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    jobTitle: row.job_title,
    bioHtml: row.bio_html,
    linkedinUrl: row.linkedin_url,
    twitterUrl: row.twitter_url,
    websiteUrl: row.website_url,
    source: row.source,
    customFields: row.custom_fields ?? {},
    mergedIntoId: row.merged_into_id,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    tags: row.tags ?? [],
    eventCount: row.event_count,
    lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at as string).toISOString() : null,
  }));

  return directoryPageDtoSchema.parse({ rows, total });
}
export const listOrganizationContacts = (organizationId: OrganizationId, filter: DirectoryFilter): Promise<DirectoryPageDTO> =>
  listOrganizationContactsIn(db, organizationId, filter);

/**
 * The complete cross-event history (AC: "inspect a contact's complete
 * event/session/activity history without leaking another organization").
 */
export async function getOrganizationContactHistoryIn(dbOrTx: DbOrTx, organizationId: OrganizationId, id: OrganizationContactId): Promise<OrganizationContactHistoryDTO | null> {
  const contact = await getOrganizationContactIn(dbOrTx, organizationId, id);
  if (!contact) return null;

  const tagRows = await dbOrTx.select({ id: organizationContactTags.id, name: organizationContactTags.name, color: organizationContactTags.color, createdAt: organizationContactTags.createdAt })
    .from(organizationContactTagLinks)
    .innerJoin(organizationContactTags, eq(organizationContactTags.id, organizationContactTagLinks.tagId))
    .where(eq(organizationContactTagLinks.organizationContactId, id))
    .orderBy(asc(organizationContactTags.name));
  const tags = tagRows.map((row) => crmTagDtoSchema.parse({ id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.toISOString() }));

  const linkRows = await dbOrTx.select({
    eventId: organizationContactLinks.eventId,
    contactId: organizationContactLinks.contactId,
    linkedAt: organizationContactLinks.createdAt,
    eventName: events.name,
    eventSlug: events.slug,
    workflowStatus: contacts.workflowStatus,
    confirmationStatus: contacts.confirmationStatus,
  }).from(organizationContactLinks)
    .innerJoin(events, eq(events.id, organizationContactLinks.eventId))
    .innerJoin(contacts, eq(contacts.id, organizationContactLinks.contactId))
    .where(eq(organizationContactLinks.organizationContactId, id))
    .orderBy(desc(organizationContactLinks.createdAt));

  const events_ = [];
  for (const row of linkRows) {
    const sessionRows = await dbOrTx.select({ sessionId: sessions.id, title: sessions.title, status: sessions.status })
      .from(sessionSpeakers)
      .innerJoin(sessions, eq(sessions.id, sessionSpeakers.sessionId))
      .where(eq(sessionSpeakers.contactId, row.contactId));
    events_.push({
      eventId: eventIdSchema.parse(row.eventId),
      eventName: row.eventName,
      eventSlug: row.eventSlug,
      contactId: contactIdSchema.parse(row.contactId),
      workflowStatus: row.workflowStatus,
      confirmationStatus: row.confirmationStatus,
      sessions: sessionRows.map((s) => ({ sessionId: sessionIdSchema.parse(s.sessionId), title: s.title, status: s.status })),
      linkedAt: row.linkedAt.toISOString(),
    });
  }

  const noteRows = await dbOrTx.select({
    id: organizationContactNotes.id, bodyHtml: organizationContactNotes.bodyHtml, authorUserId: organizationContactNotes.authorUserId,
    createdAt: organizationContactNotes.createdAt, authorName: users.name,
  }).from(organizationContactNotes)
    .leftJoin(users, eq(users.id, organizationContactNotes.authorUserId))
    .where(eq(organizationContactNotes.organizationContactId, id))
    .orderBy(desc(organizationContactNotes.createdAt));
  const notes = noteRows.map((row) => crmNoteDtoSchema.parse({
    id: row.id, bodyHtml: row.bodyHtml, authorUserId: row.authorUserId, authorName: row.authorName ?? null, createdAt: row.createdAt.toISOString(),
  }));

  const activityRows = await dbOrTx.select().from(organizationContactActivity)
    .where(eq(organizationContactActivity.organizationContactId, id))
    .orderBy(desc(organizationContactActivity.createdAt))
    .limit(200);
  const activity = activityRows.map((row) => crmActivityDtoSchema.parse({
    id: row.id, kind: row.kind, actorUserId: row.actorUserId, metadata: row.metadata, createdAt: row.createdAt.toISOString(),
  }));

  return organizationContactHistoryDtoSchema.parse({ contact, tags, events: events_, notes, activity });
}
export const getOrganizationContactHistory = (organizationId: OrganizationId, id: OrganizationContactId): Promise<OrganizationContactHistoryDTO | null> =>
  getOrganizationContactHistoryIn(db, organizationId, id);

export async function listCrmTagsIn(dbOrTx: DbOrTx, organizationId: OrganizationId) {
  const rows = await dbOrTx.select().from(organizationContactTags).where(eq(organizationContactTags.organizationId, organizationId)).orderBy(asc(organizationContactTags.name));
  return rows.map((row) => crmTagDtoSchema.parse({ id: row.id, name: row.name, color: row.color, createdAt: row.createdAt.toISOString() }));
}
export const listCrmTags = (organizationId: OrganizationId) => listCrmTagsIn(db, organizationId);

export async function listCrmCustomFieldsIn(dbOrTx: DbOrTx, organizationId: OrganizationId) {
  const rows = await dbOrTx.select().from(organizationContactCustomFields).where(eq(organizationContactCustomFields.organizationId, organizationId)).orderBy(asc(organizationContactCustomFields.sortOrder));
  return rows.map((row) => crmCustomFieldDtoSchema.parse({ id: row.id, key: row.key, label: row.label, fieldType: row.fieldType, options: row.options, sortOrder: row.sortOrder }));
}
export const listCrmCustomFields = (organizationId: OrganizationId) => listCrmCustomFieldsIn(db, organizationId);

export async function listCrmSegmentsIn(dbOrTx: DbOrTx, organizationId: OrganizationId) {
  const rows = await dbOrTx.select().from(organizationContactSegments).where(eq(organizationContactSegments.organizationId, organizationId)).orderBy(asc(organizationContactSegments.name));
  return rows.map((row) => crmSegmentDtoSchema.parse({
    id: row.id, name: row.name, filter: row.filter, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
}
export const listCrmSegments = (organizationId: OrganizationId) => listCrmSegmentsIn(db, organizationId);

export async function getCrmSegmentIn(dbOrTx: DbOrTx, organizationId: OrganizationId, segmentId: string) {
  const [row] = await dbOrTx.select().from(organizationContactSegments)
    .where(and(eq(organizationContactSegments.organizationId, organizationId), eq(organizationContactSegments.id, segmentId))).limit(1);
  if (!row) return null;
  return crmSegmentDtoSchema.parse({ id: row.id, name: row.name, filter: row.filter, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
}
export const getCrmSegment = (organizationId: OrganizationId, segmentId: string) => getCrmSegmentIn(db, organizationId, segmentId);

/**
 * Resolves a `CrmSegmentFilter` into member ids fresh on every call — no
 * membership rows are materialized (AC: "observe membership change after an
 * underlying field edit" — there is nothing cached to go stale). Delegates
 * to the same predicate-building `listOrganizationContactsIn` uses, capped
 * far above any single directory page.
 */
export async function resolveCrmSegmentIn(dbOrTx: DbOrTx, organizationId: OrganizationId, filter: CrmSegmentFilter): Promise<ResolvedCrmSegment> {
  const page = await listOrganizationContactsIn(dbOrTx, organizationId, {
    search: filter.search, tagIds: filter.tagIds, eventIds: filter.eventIds, pipelineStage: filter.pipelineStage, source: filter.source, customFields: filter.customFields,
    limit: MAX_SEGMENT_RECIPIENTS, offset: 0,
  });
  const capped = page.total > MAX_SEGMENT_RECIPIENTS;
  return resolvedCrmSegmentSchema.parse({
    matchedCount: page.total,
    organizationContactIds: page.rows.map((row) => row.id),
    capped,
    preview: page.rows.slice(0, PREVIEW_SAMPLE).map((row) => ({
      organizationContactId: row.id, email: row.email, name: `${row.firstName} ${row.lastName}`.trim() || row.email,
    })),
  });
}
export const resolveCrmSegment = (organizationId: OrganizationId, filter: CrmSegmentFilter): Promise<ResolvedCrmSegment> => resolveCrmSegmentIn(db, organizationId, filter);

export async function listCrmPipelineIn(dbOrTx: DbOrTx, organizationId: OrganizationId, stage?: CrmPipelineStage) {
  const predicates = [eq(organizationContactPipeline.organizationId, organizationId)];
  if (stage) predicates.push(eq(organizationContactPipeline.stage, stage));
  const rows = await dbOrTx.select().from(organizationContactPipeline).where(and(...predicates))
    .orderBy(desc(organizationContactPipeline.updatedAt), asc(organizationContactPipeline.id));
  return rows.map((row) => crmPipelineEntryDtoSchema.parse({
    id: row.id, organizationContactId: row.organizationContactId, targetEventId: row.targetEventId, stage: row.stage,
    notes: row.notes, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }));
}
export const listCrmPipeline = (organizationId: OrganizationId, stage?: CrmPipelineStage) => listCrmPipelineIn(db, organizationId, stage);

export async function getCrmPipelineHistoryIn(dbOrTx: DbOrTx, organizationId: OrganizationId, pipelineId: CrmPipelineId) {
  const rows = await dbOrTx.select().from(organizationContactPipelineHistory)
    .where(and(eq(organizationContactPipelineHistory.organizationId, organizationId), eq(organizationContactPipelineHistory.pipelineId, pipelineId)))
    .orderBy(asc(organizationContactPipelineHistory.createdAt));
  return rows.map((row) => crmPipelineHistoryEntryDtoSchema.parse({
    fromStage: row.fromStage, toStage: row.toStage, actorUserId: row.actorUserId, createdAt: row.createdAt.toISOString(),
  }));
}
export const getCrmPipelineHistory = (organizationId: OrganizationId, pipelineId: CrmPipelineId) => getCrmPipelineHistoryIn(db, organizationId, pipelineId);

/** AC: "organization-wide directory, engagement, reuse, and pipeline metrics." */
export async function getCrmMetricsIn(dbOrTx: DbOrTx, organizationId: OrganizationId): Promise<CrmMetricsDTO> {
  const result = await dbOrTx.execute(sql`
    WITH base AS (SELECT id FROM organization_contacts WHERE organization_id = ${organizationId} AND merged_into_id IS NULL)
    SELECT
      (SELECT count(*)::int FROM base) AS total_contacts,
      (SELECT count(DISTINCT organization_contact_id)::int FROM organization_contact_links WHERE organization_id = ${organizationId}) AS total_with_event_link,
      (SELECT count(DISTINCT organization_contact_id)::int FROM organization_contact_tag_links WHERE organization_id = ${organizationId}) AS total_tagged,
      (SELECT count(DISTINCT event_id)::int FROM organization_contact_links WHERE organization_id = ${organizationId}) AS events_represented,
      (SELECT count(*)::int FROM organization_contact_merges WHERE organization_id = ${organizationId}) AS merges_recorded
  `);
  const row = result.rows[0] as Record<string, number>;

  const stageResult = await dbOrTx.execute(sql`
    SELECT stage, count(*)::int AS n FROM organization_contact_pipeline WHERE organization_id = ${organizationId} GROUP BY stage
  `);
  const pipelineByStage: Record<string, number> = { open: 0, won: 0, lost: 0 };
  for (const r of stageResult.rows as { stage: string; n: number }[]) pipelineByStage[r.stage] = r.n;

  return crmMetricsDtoSchema.parse({
    totalContacts: row.total_contacts, totalWithEventLink: row.total_with_event_link, totalTagged: row.total_tagged,
    eventsRepresented: row.events_represented, pipelineByStage, mergesRecorded: row.merges_recorded,
  });
}
export const getCrmMetrics = (organizationId: OrganizationId) => getCrmMetricsIn(db, organizationId);
