import { and, eq, sql } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import {
  organizationContactActivity,
  organizationContactLinks,
  organizationContactMerges,
  organizationContactNotes,
  organizationContactPipeline,
  organizationContactTagLinks,
  organizationContacts,
} from "@/db/schema";
import {
  crmMergeAuditDtoSchema,
  crmMergeReferenceCountsSchema,
  crmMergePreviewDtoSchema,
  type CrmMergeAuditDTO,
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
 * use the snapshot to decide what (if anything) to point back. There is no
 * automated "unmerge" — the recovery procedure is a documented manual/future
 * step, not a guarantee this module makes today.
 */

const FIELD_NAMES = ["firstName", "lastName", "company", "jobTitle", "bioHtml", "linkedinUrl", "twitterUrl", "websiteUrl"] as const;
type MergeableField = (typeof FIELD_NAMES)[number];

function fieldValue(contact: OrganizationContactDTO, field: MergeableField): string | null {
  return contact[field] ?? null;
}

async function countReferencesIn(dbOrTx: DbOrTx, mergedContactId: string): Promise<CrmMergeReferenceCounts> {
  const [links, tags, notes, activity, pipeline] = await Promise.all([
    dbOrTx.select().from(organizationContactLinks).where(eq(organizationContactLinks.organizationContactId, mergedContactId)),
    dbOrTx.select().from(organizationContactTagLinks).where(eq(organizationContactTagLinks.organizationContactId, mergedContactId)),
    dbOrTx.select().from(organizationContactNotes).where(eq(organizationContactNotes.organizationContactId, mergedContactId)),
    dbOrTx.select().from(organizationContactActivity).where(eq(organizationContactActivity.organizationContactId, mergedContactId)),
    dbOrTx.select().from(organizationContactPipeline).where(eq(organizationContactPipeline.organizationContactId, mergedContactId)),
  ]);
  return crmMergeReferenceCountsSchema.parse({
    eventLinks: links.length, tags: tags.length, notes: notes.length, activity: activity.length, pipelineEntries: pipeline.length,
  });
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
  const referenceCounts = await countReferencesIn(dbOrTx, merged.id);
  const fieldConflicts = FIELD_NAMES
    .map((field) => ({ field, primaryValue: fieldValue(primary, field), mergedValue: fieldValue(merged, field) }))
    .filter(({ primaryValue, mergedValue }) => mergedValue && mergedValue !== primaryValue);
  return crmMergePreviewDtoSchema.parse({ primary, merged, referenceCounts, fieldConflicts });
}
export const previewCrmMerge = (organizationId: OrganizationId, input: PreviewCrmMergeInput): Promise<CrmMergePreviewDTO> =>
  previewCrmMergeIn(db, organizationId, input);

/** The audited transactional commit. `tx` is always a real `withTx` handle —
 * see `mergeOrganizationContacts` below, this run's caller of `withTx`. */
export async function mergeOrganizationContactsIn(tx: TxDb, organizationId: OrganizationId, input: MergeCrmContactsInput, actorUserId: UserId | null): Promise<CrmMergeAuditDTO> {
  const { primary, merged } = await loadMergePairIn(tx, organizationId, input);
  const referenceCounts = await countReferencesIn(tx, merged.id);

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

  await tx.update(organizationContacts).set(patch)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.id, primary.id)));

  // Reassign references onto the primary. Tags go through insert-then-delete
  // (raw SQL: a portable "move, deduping against whatever the primary
  // already has" in one statement) so a tag both contacts already share
  // does not violate the `(organization_contact_id, tag_id)` primary key;
  // every other child table has no such collision risk and is a plain
  // `UPDATE`.
  await tx.update(organizationContactLinks).set({ organizationContactId: primary.id })
    .where(eq(organizationContactLinks.organizationContactId, merged.id));
  await tx.execute(sql`
    INSERT INTO organization_contact_tag_links (organization_id, organization_contact_id, tag_id)
    SELECT organization_id, ${primary.id}::uuid, tag_id FROM organization_contact_tag_links WHERE organization_contact_id = ${merged.id}
    ON CONFLICT (organization_contact_id, tag_id) DO NOTHING
  `);
  await tx.delete(organizationContactTagLinks).where(eq(organizationContactTagLinks.organizationContactId, merged.id));
  await tx.update(organizationContactNotes).set({ organizationContactId: primary.id })
    .where(eq(organizationContactNotes.organizationContactId, merged.id));
  await tx.update(organizationContactActivity).set({ organizationContactId: primary.id })
    .where(eq(organizationContactActivity.organizationContactId, merged.id));
  await tx.update(organizationContactPipeline).set({ organizationContactId: primary.id })
    .where(eq(organizationContactPipeline.organizationContactId, merged.id));

  const [auditRow] = await tx.insert(organizationContactMerges).values({
    organizationId,
    primaryContactId: primary.id,
    mergedContactId: merged.id,
    actorUserId: actorUserId ?? null,
    fieldSnapshot: merged,
    referenceCounts,
  }).returning();
  if (!auditRow) throw new AppError("INTERNAL", "Merge audit insert did not return a row");

  // Guarded tombstone: only succeeds if the loser is still un-merged, which
  // it always is inside this same transaction (nothing else can have
  // written to it) — the guard exists for defense-in-depth if this function
  // is ever invoked twice concurrently against the same pair before the
  // first transaction commits.
  const [tombstoned] = await tx.update(organizationContacts).set({ mergedIntoId: primary.id, updatedAt: new Date() })
    .where(and(eq(organizationContacts.id, merged.id), eq(organizationContacts.organizationId, organizationId)))
    .returning({ id: organizationContacts.id });
  if (!tombstoned) throw new AppError("CONFLICT", "This contact was merged by someone else at the same time");

  await tx.insert(organizationContactActivity).values({ organizationId, organizationContactId: primary.id, kind: "merged_from", actorUserId: actorUserId ?? null, metadata: { mergedContactId: merged.id } });
  await tx.insert(organizationContactActivity).values({ organizationId, organizationContactId: merged.id, kind: "merged_into", actorUserId: actorUserId ?? null, metadata: { primaryContactId: primary.id } });

  return crmMergeAuditDtoSchema.parse({
    id: auditRow.id, primaryContactId: auditRow.primaryContactId, mergedContactId: auditRow.mergedContactId,
    actorUserId: auditRow.actorUserId, referenceCounts, createdAt: auditRow.createdAt.toISOString(),
  });
}

export function mergeOrganizationContacts(organizationId: OrganizationId, input: MergeCrmContactsInput, actorUserId: UserId | null): Promise<CrmMergeAuditDTO> {
  return withTx((tx) => mergeOrganizationContactsIn(tx, organizationId, input, actorUserId));
}
