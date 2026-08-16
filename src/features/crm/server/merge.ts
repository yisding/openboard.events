import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import {
  organizationContactActivity,
  organizationContactLinks,
  organizationContactMerges,
  organizationContactMergeRecoveries,
  organizationContactNotes,
  organizationContactPipeline,
  organizationContactTags,
  organizationContactTagLinks,
  organizationContacts,
} from "@/db/schema";
import {
  crmMergeAuditDtoSchema,
  crmMergeAuditDetailDtoSchema,
  crmMergeReferenceCountsSchema,
  crmMergePreviewDtoSchema,
  organizationContactDtoSchema,
  organizationContactIdSchema,
  type CrmMergeAuditDTO,
  type CrmMergeAuditDetailDTO,
  type CrmMergeId,
  type CrmMergePreviewDTO,
  type CrmMergeReferenceCounts,
  type MergeCrmContactsInput,
  type OrganizationContactDTO,
  type OrganizationContactId,
  type OrganizationId,
  type PreviewCrmMergeInput,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getOrganizationContactIn } from "./queries";

type MergeContactFields = Pick<OrganizationContactDTO, "firstName" | "lastName" | "company" | "jobTitle" | "bioHtml" | "linkedinUrl" | "twitterUrl" | "websiteUrl" | "source" | "customFields">;
type MergeRecoverySnapshot = {
  primaryBefore: MergeContactFields;
  primaryAfter: MergeContactFields;
  references: {
    links: string[];
    tags: Array<{ tagId: string; primaryHadTag: boolean }>;
    notes: string[];
    activity: string[];
    pipeline: string[];
  };
};

const mergeContactFieldsSchema = organizationContactDtoSchema.pick({
  firstName: true, lastName: true, company: true, jobTitle: true, bioHtml: true,
  linkedinUrl: true, twitterUrl: true, websiteUrl: true, source: true, customFields: true,
});
const mergeRecoverySnapshotSchema = z.object({
  primaryBefore: mergeContactFieldsSchema,
  primaryAfter: mergeContactFieldsSchema,
  references: z.object({
    links: z.array(z.uuid()),
    tags: z.array(z.object({ tagId: z.uuid(), primaryHadTag: z.boolean() })),
    notes: z.array(z.uuid()),
    activity: z.array(z.uuid()),
    pipeline: z.array(z.uuid()),
  }),
});

function contactFields(contact: OrganizationContactDTO): MergeContactFields {
  return {
    firstName: contact.firstName,
    lastName: contact.lastName,
    company: contact.company,
    jobTitle: contact.jobTitle,
    bioHtml: contact.bioHtml,
    linkedinUrl: contact.linkedinUrl,
    twitterUrl: contact.twitterUrl,
    websiteUrl: contact.websiteUrl,
    source: contact.source,
    customFields: contact.customFields,
  };
}

function resolvedPrimaryFields(primary: OrganizationContactDTO, merged: OrganizationContactDTO, input: MergeCrmContactsInput): MergeContactFields {
  const wantsMerged = (field: MergeableField) => input.fieldResolutions[field] === "merged";
  return {
    firstName: wantsMerged("firstName") ? fieldValue(merged, "firstName") ?? "" : primary.firstName,
    lastName: wantsMerged("lastName") ? fieldValue(merged, "lastName") ?? "" : primary.lastName,
    company: wantsMerged("company") ? fieldValue(merged, "company") : primary.company,
    jobTitle: wantsMerged("jobTitle") ? fieldValue(merged, "jobTitle") : primary.jobTitle,
    bioHtml: wantsMerged("bioHtml") ? fieldValue(merged, "bioHtml") : primary.bioHtml,
    linkedinUrl: wantsMerged("linkedinUrl") ? fieldValue(merged, "linkedinUrl") : primary.linkedinUrl,
    twitterUrl: wantsMerged("twitterUrl") ? fieldValue(merged, "twitterUrl") : primary.twitterUrl,
    websiteUrl: wantsMerged("websiteUrl") ? fieldValue(merged, "websiteUrl") : primary.websiteUrl,
    source: primary.source,
    customFields: { ...merged.customFields, ...primary.customFields },
  };
}

function normalizedCustomFields(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))));
}

function fieldsMatch(contact: OrganizationContactDTO, expected: MergeContactFields): boolean {
  return contact.firstName === expected.firstName
    && contact.lastName === expected.lastName
    && contact.company === expected.company
    && contact.jobTitle === expected.jobTitle
    && contact.bioHtml === expected.bioHtml
    && contact.linkedinUrl === expected.linkedinUrl
    && contact.twitterUrl === expected.twitterUrl
    && contact.websiteUrl === expected.websiteUrl
    && contact.source === expected.source
    && normalizedCustomFields(contact.customFields) === normalizedCustomFields(expected.customFields);
}

/**
 * M55 — duplicate merge. The guardrail calls this "a high-risk operation":
 * preview, explicit primary, reference counts, audit trail, and a tested
 * recovery procedure before enabling it. `mergeOrganizationContactsIn` is
 * the transactional commit and is the **10th function** added to PLAN
 * resolution #4's `withTx` audit list this run — see the updated comment on
 * `withTx` in `src/db/client.ts`. Reassigning references across five tables
 * and tombstoning the losing identity has to be all-or-nothing: a crash
 * mid-reassignment must never leave some of a contact's history pointing at
 * the primary and the rest still on an orphaned-looking loser.
 *
 * The loser row is never deleted, only tombstoned via `merged_into_id` (see
 * `src/db/schema/crm.ts`'s comment on that column) — every reassigned child
 * row's foreign key stays valid, and the audit row's `field_snapshot` plus
 * `reference_counts` is the recovery checklist: clear `merged_into_id`, then
 * use the immutable recovery snapshot to compare the primary and point the
 * reassigned references back. Recovery is itself transactional and writes a
 * separate append-only receipt.
 */

const FIELD_NAMES = ["firstName", "lastName", "company", "jobTitle", "bioHtml", "linkedinUrl", "twitterUrl", "websiteUrl"] as const;
type MergeableField = (typeof FIELD_NAMES)[number];

function fieldValue(contact: OrganizationContactDTO, field: MergeableField): string | null {
  return contact[field] ?? null;
}

async function countReferencesIn(dbOrTx: DbOrTx, organizationId: OrganizationId, mergedContactId: string): Promise<CrmMergeReferenceCounts> {
  const [links, tags, notes, activity, pipeline] = await Promise.all([
    dbOrTx.select().from(organizationContactLinks).where(and(eq(organizationContactLinks.organizationId, organizationId), eq(organizationContactLinks.organizationContactId, mergedContactId))),
    dbOrTx.select().from(organizationContactTagLinks).where(and(eq(organizationContactTagLinks.organizationId, organizationId), eq(organizationContactTagLinks.organizationContactId, mergedContactId))),
    dbOrTx.select().from(organizationContactNotes).where(and(eq(organizationContactNotes.organizationId, organizationId), eq(organizationContactNotes.organizationContactId, mergedContactId))),
    dbOrTx.select().from(organizationContactActivity).where(and(eq(organizationContactActivity.organizationId, organizationId), eq(organizationContactActivity.organizationContactId, mergedContactId))),
    dbOrTx.select().from(organizationContactPipeline).where(and(eq(organizationContactPipeline.organizationId, organizationId), eq(organizationContactPipeline.organizationContactId, mergedContactId))),
  ]);
  return crmMergeReferenceCountsSchema.parse({
    eventLinks: links.length, tags: tags.length, notes: notes.length, activity: activity.length, pipelineEntries: pipeline.length,
  });
}

async function loadMergeRecoverySnapshotIn(dbOrTx: DbOrTx, organizationId: OrganizationId, primaryContactId: OrganizationContactId, mergedContactId: OrganizationContactId): Promise<MergeRecoverySnapshot["references"]> {
  const [links, mergedTags, primaryTags, notes, activity, pipeline] = await Promise.all([
    dbOrTx.select({ id: organizationContactLinks.id }).from(organizationContactLinks)
      .where(and(eq(organizationContactLinks.organizationId, organizationId), eq(organizationContactLinks.organizationContactId, mergedContactId))),
    dbOrTx.select({ tagId: organizationContactTagLinks.tagId }).from(organizationContactTagLinks)
      .where(and(eq(organizationContactTagLinks.organizationId, organizationId), eq(organizationContactTagLinks.organizationContactId, mergedContactId))),
    dbOrTx.select({ tagId: organizationContactTagLinks.tagId }).from(organizationContactTagLinks)
      .where(and(eq(organizationContactTagLinks.organizationId, organizationId), eq(organizationContactTagLinks.organizationContactId, primaryContactId))),
    dbOrTx.select({ id: organizationContactNotes.id }).from(organizationContactNotes)
      .where(and(eq(organizationContactNotes.organizationId, organizationId), eq(organizationContactNotes.organizationContactId, mergedContactId))),
    dbOrTx.select({ id: organizationContactActivity.id }).from(organizationContactActivity)
      .where(and(eq(organizationContactActivity.organizationId, organizationId), eq(organizationContactActivity.organizationContactId, mergedContactId))),
    dbOrTx.select({ id: organizationContactPipeline.id }).from(organizationContactPipeline)
      .where(and(eq(organizationContactPipeline.organizationId, organizationId), eq(organizationContactPipeline.organizationContactId, mergedContactId))),
  ]);
  const primaryTagIds = new Set(primaryTags.map((row) => row.tagId));
  return {
    links: links.map((row) => row.id),
    tags: mergedTags.map((row) => ({ tagId: row.tagId, primaryHadTag: primaryTagIds.has(row.tagId) })),
    notes: notes.map((row) => row.id),
    activity: activity.map((row) => row.id),
    pipeline: pipeline.map((row) => row.id),
  };
}

async function loadMergePairIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: { primaryContactId: OrganizationContactId; mergedContactId: OrganizationContactId }) {
  const primary = await getOrganizationContactIn(dbOrTx, organizationId, input.primaryContactId);
  const merged = await getOrganizationContactIn(dbOrTx, organizationId, input.mergedContactId);
  if (!primary || !merged) throw new AppError("NOT_FOUND", "One of these contacts was not found in this organization");
  if (primary.mergedIntoId) throw new AppError("CONFLICT", "The primary contact was itself already merged into another one", { mergedIntoId: primary.mergedIntoId });
  if (merged.mergedIntoId) throw new AppError("CONFLICT", "This contact was already merged into another one", { mergedIntoId: merged.mergedIntoId });
  return { primary, merged };
}

export async function previewCrmMergeIn(dbOrTx: DbOrTx, organizationId: OrganizationId, input: PreviewCrmMergeInput): Promise<CrmMergePreviewDTO> {
  const { primary, merged } = await loadMergePairIn(dbOrTx, organizationId, input);
  const referenceCounts = await countReferencesIn(dbOrTx, organizationId, merged.id);
  const fieldConflicts = FIELD_NAMES
    .map((field) => ({ field, primaryValue: fieldValue(primary, field), mergedValue: fieldValue(merged, field) }))
    .filter(({ primaryValue, mergedValue }) => mergedValue && mergedValue !== primaryValue);
  return crmMergePreviewDtoSchema.parse({ primary, merged, referenceCounts, fieldConflicts });
}
export const previewCrmMerge = (organizationId: OrganizationId, input: PreviewCrmMergeInput): Promise<CrmMergePreviewDTO> =>
  previewCrmMergeIn(db, organizationId, input);

/**
 * Follow every `merged_into_id` hop to the contact that actually survives.
 *
 * A merge never rewrites the loser's `email` — the patch in
 * `mergeOrganizationContactsIn` carries no email, and `UNIQUE (organization_id,
 * email)` means the loser holds a *different* address from its primary, which
 * is exactly why erasure walks these chains too. So any lookup by address can
 * still land on a tombstone, and writing there writes somewhere nobody can see:
 * the directory, segments, metrics and every outreach audience all filter
 * `merged_into_id IS NULL`.
 *
 * Lives here rather than in one caller because both the bulk-email audience and
 * the CSV import need the same walk, and merge semantics are this module's.
 * Loop-guarded on `seen`, so a cycle written by some future bug terminates
 * instead of hanging a request.
 */
export async function canonicalOrganizationContactIdsIn(
  dbOrTx: DbOrTx,
  organizationId: OrganizationId,
  organizationContactIds: readonly string[],
): Promise<Map<string, string>> {
  const parentById = new Map<string, string | null>();
  const loaded = new Set<string>();
  let pending = [...new Set(organizationContactIds)];
  while (pending.length > 0) {
    const rows = await dbOrTx.select({
      id: organizationContacts.id,
      mergedIntoId: organizationContacts.mergedIntoId,
    }).from(organizationContacts).where(and(
      eq(organizationContacts.organizationId, organizationId),
      inArray(organizationContacts.id, pending),
    ));
    for (const id of pending) loaded.add(id);
    for (const row of rows) parentById.set(row.id, row.mergedIntoId);
    pending = [...new Set(rows.flatMap((row) => row.mergedIntoId ? [row.mergedIntoId] : []))]
      .filter((id) => !loaded.has(id));
  }

  const canonicalById = new Map<string, string>();
  for (const originId of organizationContactIds) {
    let currentId = originId;
    const seen = new Set<string>();
    while (!seen.has(currentId)) {
      seen.add(currentId);
      const parentId = parentById.get(currentId);
      if (!parentId) break;
      currentId = parentId;
    }
    canonicalById.set(originId, currentId);
  }
  return canonicalById;
}
/**
 * Point a losing contact at its winner, but only while it is still un-merged.
 *
 * Exported so the guard is directly testable: the race it defends against
 * needs two live connections, which the integration harness cannot produce
 * (PGlite is single-connection), but calling this twice reproduces exactly the
 * state the loser's row is in when the second transaction wakes up.
 */
export async function tombstoneMergedContactIn(
  tx: TxDb,
  organizationId: OrganizationId,
  mergedContactId: OrganizationContactId,
  primaryContactId: OrganizationContactId,
): Promise<void> {
  const [tombstoned] = await tx.update(organizationContacts).set({ mergedIntoId: primaryContactId, updatedAt: new Date() })
    .where(and(
      eq(organizationContacts.id, mergedContactId),
      eq(organizationContacts.organizationId, organizationId),
      isNull(organizationContacts.mergedIntoId),
    ))
    .returning({ id: organizationContacts.id });
  if (!tombstoned) throw new AppError("CONFLICT", "This contact was merged by someone else at the same time");
}

/** The audited transactional commit. `tx` is always a real `withTx` handle —
 * see `mergeOrganizationContacts` below, this run's caller of `withTx`. */
export async function mergeOrganizationContactsIn(tx: TxDb, organizationId: OrganizationId, input: MergeCrmContactsInput, actorUserId: UserId | null): Promise<CrmMergeAuditDTO> {
  const { primary, merged } = await loadMergePairIn(tx, organizationId, input);
  const referenceCounts = await countReferencesIn(tx, organizationId, merged.id);
  const references = await loadMergeRecoverySnapshotIn(tx, organizationId, primary.id, merged.id);

  // Field-by-field resolution: "merged" overwrites the primary's current
  // value with the losing contact's; anything unlisted (or "primary") keeps
  // the primary's value untouched. `field_snapshot` below is `merged`'s
  // values exactly as loaded here, before any write in this transaction.
  const wantsMerged = (field: MergeableField) => input.fieldResolutions[field] === "merged";
  const patch: Partial<typeof organizationContacts.$inferInsert> = { updatedAt: new Date() };
  // firstName/lastName are NOT NULL (default ''); every other mergeable
  // field is nullable, so only these two need an empty-string fallback.
  if (wantsMerged("firstName")) patch.firstName = fieldValue(merged, "firstName") ?? "";
  if (wantsMerged("lastName")) patch.lastName = fieldValue(merged, "lastName") ?? "";
  if (wantsMerged("company")) patch.company = fieldValue(merged, "company");
  if (wantsMerged("jobTitle")) patch.jobTitle = fieldValue(merged, "jobTitle");
  if (wantsMerged("bioHtml")) patch.bioHtml = fieldValue(merged, "bioHtml");
  if (wantsMerged("linkedinUrl")) patch.linkedinUrl = fieldValue(merged, "linkedinUrl");
  if (wantsMerged("twitterUrl")) patch.twitterUrl = fieldValue(merged, "twitterUrl");
  if (wantsMerged("websiteUrl")) patch.websiteUrl = fieldValue(merged, "websiteUrl");
  // Custom fields: fill gaps only — a key the primary lacks is taken from
  // the merged contact; a key the primary already has is never overwritten
  // by this generic path (an organizer wanting the merged side's value for
  // a specific custom field can still set it manually after merging).
  patch.customFields = { ...merged.customFields, ...primary.customFields };
  const recoverySnapshot: MergeRecoverySnapshot = {
    primaryBefore: contactFields(primary),
    primaryAfter: resolvedPrimaryFields(primary, merged, input),
    references,
  };

  await tx.update(organizationContacts).set(patch)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, primary.id)));

  // Reassign references onto the primary. Tags go through insert-then-delete
  // (raw SQL: a portable "move, deduping against whatever the primary
  // already has" in one statement) so a tag both contacts already share
  // does not violate the `(organization_contact_id, tag_id)` primary key;
  // every other child table has no such collision risk and is a plain
  // `UPDATE`.
  await tx.update(organizationContactLinks).set({ organizationContactId: primary.id })
    .where(and(eq(organizationContactLinks.organizationId, organizationId), eq(organizationContactLinks.organizationContactId, merged.id)));
  await tx.execute(sql`
    INSERT INTO organization_contact_tag_links (organization_id, organization_contact_id, tag_id)
    SELECT organization_id, ${primary.id}::uuid, tag_id FROM organization_contact_tag_links
    WHERE organization_id = ${organizationId}::uuid AND organization_contact_id = ${merged.id}::uuid
    ON CONFLICT (organization_contact_id, tag_id) DO NOTHING
  `);
  await tx.delete(organizationContactTagLinks).where(and(eq(organizationContactTagLinks.organizationId, organizationId), eq(organizationContactTagLinks.organizationContactId, merged.id)));
  await tx.update(organizationContactNotes).set({ organizationContactId: primary.id })
    .where(and(eq(organizationContactNotes.organizationId, organizationId), eq(organizationContactNotes.organizationContactId, merged.id)));
  await tx.update(organizationContactActivity).set({ organizationContactId: primary.id })
    .where(and(eq(organizationContactActivity.organizationId, organizationId), eq(organizationContactActivity.organizationContactId, merged.id)));
  await tx.update(organizationContactPipeline).set({ organizationContactId: primary.id })
    .where(and(eq(organizationContactPipeline.organizationId, organizationId), eq(organizationContactPipeline.organizationContactId, merged.id)));

  const [auditRow] = await tx.insert(organizationContactMerges).values({
    organizationId,
    primaryContactId: primary.id,
    mergedContactId: merged.id,
    actorUserId: actorUserId ?? null,
    fieldSnapshot: { mergedContact: merged, recovery: recoverySnapshot },
    referenceCounts,
  }).returning();
  if (!auditRow) throw new AppError("INTERNAL", "Merge audit insert did not return a row");

  // Guarded tombstone: only succeeds if the loser is still un-merged. The
  // `merged_into_id IS NULL` term is what makes that true — `loadMergePairIn`
  // reads the pair with a plain SELECT, so under READ COMMITTED two merges of
  // the same loser can both pass its precondition check, and without this term
  // the UPDATE always matches and the CONFLICT below is unreachable. The second
  // transaction blocks here on the first's row lock, re-reads after it commits,
  // matches nothing, and is rolled back whole — which is the point: its own
  // reference moves have already been silently no-oped by the first (the child
  // rows no longer point at the loser), so its audit row and recovery snapshot
  // would claim references the winner never received.
  await tombstoneMergedContactIn(tx, organizationId, merged.id, primary.id);

  await tx.insert(organizationContactActivity).values({ organizationId, organizationContactId: primary.id, kind: "merged_from", actorUserId: actorUserId ?? null, metadata: { mergedContactId: merged.id } });
  await tx.insert(organizationContactActivity).values({ organizationId, organizationContactId: merged.id, kind: "merged_into", actorUserId: actorUserId ?? null, metadata: { primaryContactId: primary.id } });

  return crmMergeAuditDtoSchema.parse({
    id: auditRow.id, primaryContactId: auditRow.primaryContactId, mergedContactId: auditRow.mergedContactId,
    actorUserId: auditRow.actorUserId, referenceCounts, createdAt: auditRow.createdAt.toISOString(),
  });
}

function recoveryFromFieldSnapshot(value: unknown): MergeRecoverySnapshot | null {
  if (typeof value !== "object" || value === null || !("recovery" in value)) return null;
  const parsed = mergeRecoverySnapshotSchema.safeParse((value as { recovery: unknown }).recovery);
  return parsed.success ? parsed.data : null;
}

async function getMergeAuditRowIn(dbOrTx: DbOrTx, organizationId: OrganizationId, mergeId: CrmMergeId) {
  const [row] = await dbOrTx.select().from(organizationContactMerges)
    .where(and(eq(organizationContactMerges.organizationId, organizationId), eq(organizationContactMerges.id, mergeId)))
    .limit(1);
  return row ?? null;
}

/** Organization-scoped audit lookup used by the recovery UI and operational
 * tooling. Old audits remain visible but are explicitly marked unavailable
 * because they predate the compare-and-restore snapshot. */
export async function getCrmMergeAuditIn(dbOrTx: DbOrTx, organizationId: OrganizationId, mergeId: CrmMergeId): Promise<CrmMergeAuditDetailDTO | null> {
  const row = await getMergeAuditRowIn(dbOrTx, organizationId, mergeId);
  if (!row) return null;
  const [recovery] = await dbOrTx.select({ id: organizationContactMergeRecoveries.id })
    .from(organizationContactMergeRecoveries)
    .where(and(eq(organizationContactMergeRecoveries.organizationId, organizationId), eq(organizationContactMergeRecoveries.mergeId, mergeId)))
    .limit(1);
  const snapshot = recoveryFromFieldSnapshot(row.fieldSnapshot);
  return crmMergeAuditDetailDtoSchema.parse({
    id: row.id,
    primaryContactId: row.primaryContactId,
    mergedContactId: row.mergedContactId,
    actorUserId: row.actorUserId,
    referenceCounts: row.referenceCounts,
    createdAt: row.createdAt.toISOString(),
    recoveryStatus: recovery ? "recovered" : snapshot ? "recoverable" : "unavailable",
    canRecover: !recovery && snapshot !== null,
  });
}

export const getCrmMergeAudit = (organizationId: OrganizationId, mergeId: CrmMergeId): Promise<CrmMergeAuditDetailDTO | null> =>
  getCrmMergeAuditIn(db, organizationId, mergeId);

/** Restore one merge only when the primary still has the exact post-merge
 * field state. This compare-and-restore guard prevents a recovery request from
 * silently overwriting edits made after the merge. References that were
 * deleted after the merge are left deleted; surviving references identified by
 * the immutable snapshot are moved back in the same transaction. */
export async function recoverCrmMergeIn(tx: TxDb, organizationId: OrganizationId, mergeId: CrmMergeId, actorUserId: UserId | null): Promise<CrmMergeAuditDetailDTO> {
  const auditRow = await getMergeAuditRowIn(tx, organizationId, mergeId);
  if (!auditRow) throw new AppError("NOT_FOUND", "Merge audit not found");
  const snapshot = recoveryFromFieldSnapshot(auditRow.fieldSnapshot);
  if (!snapshot) throw new AppError("CONFLICT", "This merge does not have a recoverable snapshot");

  const [existingRecovery] = await tx.select({ id: organizationContactMergeRecoveries.id })
    .from(organizationContactMergeRecoveries)
    .where(and(eq(organizationContactMergeRecoveries.organizationId, organizationId), eq(organizationContactMergeRecoveries.mergeId, mergeId)))
    .limit(1);
  if (existingRecovery) throw new AppError("CONFLICT", "This merge was already recovered");

  const primary = await getOrganizationContactIn(tx, organizationId, organizationContactIdSchema.parse(auditRow.primaryContactId));
  const merged = await getOrganizationContactIn(tx, organizationId, organizationContactIdSchema.parse(auditRow.mergedContactId));
  if (!primary || !merged) throw new AppError("NOT_FOUND", "A contact referenced by this merge no longer exists");
  if (primary.mergedIntoId) throw new AppError("CONFLICT", "The primary contact was merged again; recovery is no longer safe");
  if (merged.mergedIntoId !== primary.id) throw new AppError("CONFLICT", "This contact is not currently tombstoned by this merge");
  if (!fieldsMatch(primary, snapshot.primaryAfter)) {
    throw new AppError("CONFLICT", "The primary contact changed after the merge; review the audit before recovering");
  }

  await tx.update(organizationContacts).set({
    firstName: snapshot.primaryBefore.firstName,
    lastName: snapshot.primaryBefore.lastName,
    company: snapshot.primaryBefore.company,
    jobTitle: snapshot.primaryBefore.jobTitle,
    bioHtml: snapshot.primaryBefore.bioHtml,
    linkedinUrl: snapshot.primaryBefore.linkedinUrl,
    twitterUrl: snapshot.primaryBefore.twitterUrl,
    websiteUrl: snapshot.primaryBefore.websiteUrl,
    source: snapshot.primaryBefore.source,
    customFields: snapshot.primaryBefore.customFields,
    updatedAt: new Date(),
  }).where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, primary.id)));

  if (snapshot.references.links.length > 0) {
    await tx.update(organizationContactLinks).set({ organizationContactId: merged.id }).where(and(
      eq(organizationContactLinks.organizationId, organizationId),
      eq(organizationContactLinks.organizationContactId, primary.id),
      inArray(organizationContactLinks.id, snapshot.references.links),
    ));
  }
  if (snapshot.references.notes.length > 0) {
    await tx.update(organizationContactNotes).set({ organizationContactId: merged.id }).where(and(
      eq(organizationContactNotes.organizationId, organizationId),
      eq(organizationContactNotes.organizationContactId, primary.id),
      inArray(organizationContactNotes.id, snapshot.references.notes),
    ));
  }
  if (snapshot.references.activity.length > 0) {
    await tx.update(organizationContactActivity).set({ organizationContactId: merged.id }).where(and(
      eq(organizationContactActivity.organizationId, organizationId),
      eq(organizationContactActivity.organizationContactId, primary.id),
      inArray(organizationContactActivity.id, snapshot.references.activity),
    ));
  }
  if (snapshot.references.pipeline.length > 0) {
    await tx.update(organizationContactPipeline).set({ organizationContactId: merged.id }).where(and(
      eq(organizationContactPipeline.organizationId, organizationId),
      eq(organizationContactPipeline.organizationContactId, primary.id),
      inArray(organizationContactPipeline.id, snapshot.references.pipeline),
    ));
  }

  // A tag shared by both contacts was deduplicated during merge. Recovery
  // restores the losing contact's copy and deliberately leaves the primary's
  // copy intact, preserving any tag state added after the merge.
  for (const tag of snapshot.references.tags) {
    const [tagRow] = await tx.select({ id: organizationContactTags.id }).from(organizationContactTags)
      .where(and(eq(organizationContactTags.organizationId, organizationId), eq(organizationContactTags.id, tag.tagId)))
      .limit(1);
    if (!tagRow) continue;
    if (!tag.primaryHadTag) {
      // The merge-created copy has the transaction's merge timestamp. A tag
      // added later has a newer timestamp and is intentionally preserved.
      await tx.delete(organizationContactTagLinks).where(and(
        eq(organizationContactTagLinks.organizationId, organizationId),
        eq(organizationContactTagLinks.organizationContactId, primary.id),
        eq(organizationContactTagLinks.tagId, tag.tagId),
        lte(organizationContactTagLinks.createdAt, auditRow.createdAt),
      ));
    }
    await tx.insert(organizationContactTagLinks).values({ organizationId, organizationContactId: merged.id, tagId: tag.tagId }).onConflictDoNothing();
  }

  // The merge's own two activity rows go with it. They were written *after*
  // `loadMergeRecoverySnapshotIn` captured the loser's ids, so neither is in
  // `snapshot.references.activity` and neither was ever moved back — leaving a
  // fully un-merged contact whose timeline still read "Merged into another
  // contact" and a primary whose timeline still read "Merged from another
  // contact", with nothing anywhere recording the reversal.
  //
  // It also compounded: a re-merge's snapshot picks up *all* of the loser's
  // activity, including merge #1's stale `merged_into`, and relocates it to the
  // primary — giving the primary a `merged_into` row whose `primaryContactId`
  // is itself.
  //
  // Identified by the pair rather than by a timestamp: the two rows are written
  // *after* the audit row, so a `created_at <= auditRow.createdAt` bound
  // excludes them outright. A merge/recover/merge cycle cannot leave an older
  // pair behind either, because the untombstone below only succeeds while this
  // merge is the one currently in force — an earlier one was already recovered,
  // and its rows deleted here.
  await tx.delete(organizationContactActivity).where(and(
    eq(organizationContactActivity.organizationId, organizationId),
    inArray(organizationContactActivity.kind, ["merged_from", "merged_into"]),
    sql`(
      (${organizationContactActivity.organizationContactId} = ${primary.id}
        AND ${organizationContactActivity.metadata} ->> 'mergedContactId' = ${merged.id})
      OR (${organizationContactActivity.organizationContactId} = ${merged.id}
        AND ${organizationContactActivity.metadata} ->> 'primaryContactId' = ${primary.id})
    )`,
  ));

  const [untombstoned] = await tx.update(organizationContacts).set({ mergedIntoId: null, updatedAt: new Date() }).where(and(
    eq(organizationContacts.organizationId, organizationId),
    eq(organizationContacts.id, merged.id),
    eq(organizationContacts.mergedIntoId, primary.id),
  )).returning({ id: organizationContacts.id });
  if (!untombstoned) throw new AppError("CONFLICT", "This merge changed while recovery was in progress");

  const [receipt] = await tx.insert(organizationContactMergeRecoveries).values({
    organizationId,
    mergeId,
    actorUserId: actorUserId ?? null,
    referenceCounts: auditRow.referenceCounts,
  }).returning({ id: organizationContactMergeRecoveries.id });
  if (!receipt) throw new AppError("INTERNAL", "Merge recovery receipt did not return a row");

  const result = await getCrmMergeAuditIn(tx, organizationId, mergeId);
  if (!result) throw new AppError("INTERNAL", "Recovered merge audit could not be reloaded");
  return result;
}

export function recoverCrmMerge(organizationId: OrganizationId, mergeId: CrmMergeId, actorUserId: UserId | null): Promise<CrmMergeAuditDetailDTO> {
  return withTx((tx) => recoverCrmMergeIn(tx, organizationId, mergeId, actorUserId));
}

export function mergeOrganizationContacts(organizationId: OrganizationId, input: MergeCrmContactsInput, actorUserId: UserId | null): Promise<CrmMergeAuditDTO> {
  return withTx((tx) => mergeOrganizationContactsIn(tx, organizationId, input, actorUserId));
}
