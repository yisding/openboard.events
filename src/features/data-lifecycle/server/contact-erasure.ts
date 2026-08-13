import { and, eq, inArray, ne, or } from "drizzle-orm";
import { type TxDb, withTx } from "@/db/client";
import {
  calendarInvites,
  communicationLogs,
  contactSuppressions,
  contactUnavailability,
  contacts,
  fileAssets,
  fileComments,
  fileUploads,
  formResponses,
  organizationContactActivity,
  organizationContactLinks,
  organizationContactMerges,
  organizationContactNotes,
  organizationContactPipeline,
  organizationContactPipelineHistory,
  organizationContactTagLinks,
  organizationContacts,
  portalSessions,
  portalTokens,
  sessionSpeakers,
  speakerBulkMessages,
  speakerLogisticsValues,
  submissionAnswers,
  submissionParticipants,
  submissions,
  taskCompletions,
} from "@/db/schema";
import { getEventOrganizationIn } from "@/features/organizations";
import { contactErasureReceiptSchema, type ContactErasureReceipt, type ContactId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { log } from "@/shared/lib/log";
import { purgeOrphanedFileAssets } from "@/shared/server/r2";

/**
 * Merge chains are reachable — `loadMergePairIn` (`src/features/crm/server/
 * merge.ts`) only rejects a pair whose *own* rows are already merged, so
 * merging C into B and then B into A is legal — which is why both walks over
 * `merged_into_id` below are loops rather than single hops. The cap is
 * defensive: nothing in `src/features/crm` can create a cycle, but an erasure
 * must never turn into an unbounded loop inside a transaction.
 */
const MERGE_CHAIN_MAX_DEPTH = 32;

/**
 * The organization identity of an event contact that has no link row. A
 * missing link does *not* mean "never pulled into the CRM": only
 * `pushOrganizationContactToEventIn` ever writes `organization_contact_links`,
 * while `importCrmContactsCsvIn` and `createOrganizationContactIn` both create
 * `organization_contacts` rows with no link at all — so a CSV-imported
 * prospect who later submits to this event has a full CRM profile and no link.
 * The fallback is `(organization_id, email)`: unique, normalized the same way
 * by every writer on both sides, and the identity key the CRM itself dedupes
 * on (`csv-import.ts`) and matches contacts on (`pushOrganizationContactToEventIn`).
 * A tombstoned duplicate resolves up to the surviving primary, which is the row
 * that holds this person's data now.
 */
async function resolveOrganizationContactByEmailIn(tx: TxDb, eventId: EventId, email: string): Promise<string | undefined> {
  const organizationId = await getEventOrganizationIn(tx, eventId);
  if (!organizationId) return undefined;
  let [row] = await tx.select({ id: organizationContacts.id, mergedIntoId: organizationContacts.mergedIntoId })
    .from(organizationContacts)
    .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.email, email)))
    .limit(1);
  for (let depth = 0; row?.mergedIntoId && depth < MERGE_CHAIN_MAX_DEPTH; depth += 1) {
    [row] = await tx.select({ id: organizationContacts.id, mergedIntoId: organizationContacts.mergedIntoId })
      .from(organizationContacts)
      .where(eq(organizationContacts.id, row.mergedIntoId))
      .limit(1);
  }
  return row?.id;
}

/**
 * Every duplicate tombstoned into `rootId`, transitively. A merge is the
 * organizer's explicit assertion that two rows are the *same person*, and
 * `mergeOrganizationContactsIn` never scrubs the losing row — it only sets
 * `merged_into_id` (see `src/db/schema/crm.ts` on that column: the row is kept,
 * never hard-deleted, and excluded from the directory/segments/pipeline purely
 * by that pointer). So the losers carry the erasure subject's name, company,
 * job title, bio and alternate email, and erasing the primary has to take them
 * with it.
 */
async function collectMergedDuplicateIdsIn(tx: TxDb, rootId: string): Promise<string[]> {
  const duplicateIds: string[] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let depth = 0; depth < MERGE_CHAIN_MAX_DEPTH && frontier.length > 0; depth += 1) {
    const rows = await tx.select({ id: organizationContacts.id })
      .from(organizationContacts)
      .where(inArray(organizationContacts.mergedIntoId, frontier));
    frontier = rows.map((row) => row.id).filter((id) => !seen.has(id));
    for (const id of frontier) {
      seen.add(id);
      duplicateIds.push(id);
    }
  }
  return duplicateIds;
}

/**
 * M47 — right-to-erasure. `eraseContactData` (the outer function below,
 * mirroring the `xxxIn`/`xxx` split every audited `withTx` caller in this
 * codebase already uses — see `createSubmission`/`createSubmissionIn`) is
 * the **9th** function added to PLAN resolution #4's `withTx` audit list
 * this run — see the updated comment on `withTx` in `src/db/client.ts`. A
 * GDPR deletion has to be all-or-nothing across roughly a dozen tables, the
 * same atomicity argument that put `createSubmission`/`notifyQueues` on the
 * original eight.
 *
 * The delete order below is leaf-to-root and mirrors the real
 * `ON DELETE CASCADE`/`SET NULL` chain declared in the applied SQL
 * (`drizzle/0000_init.sql`, `0006_content_deliverables.sql`,
 * `0008_speaker_roster_operations.sql` — per `DECISIONS.md`'s "Migration
 * authorship", that SQL is authoritative; the `src/db/schema/*.ts` files are
 * for query typing and do not always declare the same FK — e.g. `contacts`
 * itself carries no `.references()` for `headshot_file_id` and `file_assets`
 * none for `uploaded_by_contact_id`, yet `0000_init.sql` declares composite
 * FKs for both, `ON DELETE SET NULL` either way). Every statement here is
 * therefore redundant with what a bare `DELETE FROM contacts` would already
 * cascade or null out on its own. Explicit, ordered statements are written
 * anyway, for two reasons: (a) this function stays correct even if some
 * future migration ever narrows a cascade it currently depends on, and (b)
 * each statement's row count becomes the erasure receipt — the durable,
 * auditable record that a request was actually fulfilled.
 *
 * One known, currently-unreachable edge case: `file_comments.author_contact_id`
 * (`ON DELETE SET NULL`) shares a table with a CHECK requiring it non-null
 * whenever `author_role = 'speaker'`. Today's only writer
 * (`addFileCommentIn`) always sets `author_contact_id` equal to the slot's
 * own `contact_id`, so a `'speaker'`-authored row about a *different*
 * contact's slot never exists — the `ne(...)` guard below is therefore a
 * no-op against every row this codebase can currently produce, not dead
 * code against a real one. If a future writer ever breaks that invariant,
 * both this statement and Postgres's own FK action would need the row's
 * `author_role` flipped in the same write, which is a schema change, not an
 * erasure-function one.
 *
 * `contacts` itself is deleted at the very end, outside the field-scoped
 * writer discipline of resolution #13 (`getOrCreateContact`/
 * `updateContactFields` govern *field writes*, not whole-row erasure).
 *
 * **Scope boundary, stated exactly.** Step 5 leaves the event layer: M55's
 * `organization_contacts` is a second, organization-scoped identity for the
 * same person, joined to this event contact only by
 * `organization_contact_links`, and reachable from `contacts` by no foreign
 * key at all — so nothing above would have touched it and no database cascade
 * would have removed it. It is erased here, with its notes, activity,
 * tags, pipeline and merge snapshots — but **only when the caller passes
 * `eraseOrganizationProfile`**, because that half of the erasure is
 * organization-scoped destruction and has to be authorized at organization
 * scope. The default is the event-only erasure: this event's own link row
 * goes, the organization profile and every other event's link to it stay.
 * See the flag's own note at step 5 and the caller in
 * `src/app/api/internal/speakers/[eventId]/[contactId]/route.ts`. That
 * organization-scoped half also covers two identities the link row alone
 * would have missed: a profile created by CSV import or by hand and never
 * pushed into this event (matched by `(organization_id, email)` instead), and
 * every duplicate merged into the profile — a merge is an organizer's
 * assertion that two rows are the same person, and the losing row keeps all of
 * its personal columns. Two things are still *not* erased, and neither should
 * be read as an oversight:
 *
 * - **The same person's `contacts` rows in other events.** Each is its own
 *   event-scoped identity with its own submissions, files and comms, and each
 *   needs its own call. This function takes one `(eventId, contactId)` pair
 *   and erases exactly that person's data in that event, plus the one
 *   organization profile that event's link points at.
 * - **`communication_logs` audit metadata for other contacts** and any row
 *   that never referenced this contact. Untouched by construction.
 *
 * `docs/legal/privacy-policy.md` §6 and `docs/legal/dpa.md` §5 describe this
 * same scope and have to be updated with it — the DPA points a reader at this
 * comment as the authoritative list.
 */
export async function eraseContactDataIn(
  tx: TxDb,
  eventId: EventId,
  contactId: ContactId,
  options: { eraseOrganizationProfile?: boolean } = {},
): Promise<{ receipt: ContactErasureReceipt; purgeCandidateFileIds: string[] }> {
  const [existing] = await tx.select({ id: contacts.id, email: contacts.email, headshotFileId: contacts.headshotFileId })
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)))
    .limit(1);
  if (!existing) throw new AppError("NOT_FOUND", "Contact not found");

  const counts: Record<string, number> = {};

  // 1. Answers to their own participation — the deepest leaf, since
  // `submission_participants` (deleted below) is what `submission_answers`
  // hangs off, not `contacts` directly.
  const participants = await tx.select({ id: submissionParticipants.id })
    .from(submissionParticipants)
    .where(and(eq(submissionParticipants.eventId, eventId), eq(submissionParticipants.contactId, contactId)));
  const participantIds = participants.map((row) => row.id);
  counts.submissionAnswers = participantIds.length === 0 ? 0 : (
    await tx.delete(submissionAnswers).where(inArray(submissionAnswers.participantId, participantIds)).returning({ id: submissionAnswers.id })
  ).length;

  // 2. Portal/roster/comms leaves.
  counts.taskCompletions = (
    await tx.delete(taskCompletions).where(and(eq(taskCompletions.eventId, eventId), eq(taskCompletions.contactId, contactId))).returning({ id: taskCompletions.id })
  ).length;

  // Capture which file_assets this contact's uploads pointed at *before*
  // deleting the linking rows — those ids are the caller's purge candidates
  // once this transaction commits (see `eraseContactData` below).
  const uploads = await tx.select({ fileAssetId: fileUploads.fileAssetId })
    .from(fileUploads)
    .where(and(eq(fileUploads.eventId, eventId), eq(fileUploads.contactId, contactId)));
  counts.fileUploads = (
    await tx.delete(fileUploads).where(and(eq(fileUploads.eventId, eventId), eq(fileUploads.contactId, contactId))).returning({ id: fileUploads.id })
  ).length;

  counts.fileComments = (
    await tx.delete(fileComments).where(and(eq(fileComments.eventId, eventId), eq(fileComments.contactId, contactId))).returning({ id: fileComments.id })
  ).length;
  // Comments this contact left on *someone else's* file-request slot: the
  // real FK is `ON DELETE SET NULL`, done explicitly here so it counts
  // toward the receipt rather than happening invisibly at commit.
  counts.fileCommentsAnonymized = (
    await tx.update(fileComments)
      .set({ authorContactId: null })
      .where(and(eq(fileComments.eventId, eventId), eq(fileComments.authorContactId, contactId), ne(fileComments.contactId, contactId)))
      .returning({ id: fileComments.id })
  ).length;

  counts.formResponses = (
    await tx.delete(formResponses).where(and(eq(formResponses.eventId, eventId), eq(formResponses.contactId, contactId))).returning({ id: formResponses.id })
  ).length;

  // 3. The participation and speaking rows themselves.
  counts.submissionParticipants = (
    await tx.delete(submissionParticipants).where(and(eq(submissionParticipants.eventId, eventId), eq(submissionParticipants.contactId, contactId))).returning({ id: submissionParticipants.id })
  ).length;
  counts.sessionSpeakers = (
    await tx.delete(sessionSpeakers).where(and(eq(sessionSpeakers.eventId, eventId), eq(sessionSpeakers.contactId, contactId))).returning({ contactId: sessionSpeakers.contactId })
  ).length;

  // 4. Comms/tokens/roster tables that hang directly off `contacts`.
  counts.calendarInvites = (
    await tx.delete(calendarInvites).where(and(eq(calendarInvites.eventId, eventId), eq(calendarInvites.contactId, contactId))).returning({ id: calendarInvites.id })
  ).length;
  counts.communicationLogs = (
    await tx.delete(communicationLogs).where(and(eq(communicationLogs.eventId, eventId), eq(communicationLogs.contactId, contactId))).returning({ id: communicationLogs.id })
  ).length;
  counts.contactSuppressions = (
    await tx.delete(contactSuppressions).where(eq(contactSuppressions.contactId, contactId)).returning({ contactId: contactSuppressions.contactId })
  ).length;
  counts.speakerLogisticsValues = (
    await tx.delete(speakerLogisticsValues).where(and(eq(speakerLogisticsValues.eventId, eventId), eq(speakerLogisticsValues.contactId, contactId))).returning({ contactId: speakerLogisticsValues.contactId })
  ).length;
  counts.contactUnavailability = (
    await tx.delete(contactUnavailability).where(and(eq(contactUnavailability.eventId, eventId), eq(contactUnavailability.contactId, contactId))).returning({ id: contactUnavailability.id })
  ).length;
  counts.speakerBulkMessages = (
    await tx.delete(speakerBulkMessages).where(and(eq(speakerBulkMessages.eventId, eventId), eq(speakerBulkMessages.contactId, contactId))).returning({ id: speakerBulkMessages.id })
  ).length;
  counts.portalSessions = (
    await tx.delete(portalSessions).where(and(eq(portalSessions.eventId, eventId), eq(portalSessions.contactId, contactId))).returning({ id: portalSessions.id })
  ).length;
  counts.portalTokens = (
    await tx.delete(portalTokens).where(and(eq(portalTokens.eventId, eventId), eq(portalTokens.contactId, contactId))).returning({ id: portalTokens.id })
  ).length;

  // 5. The organization-level CRM identity (M55).
  //
  // `organization_contacts` is a *separate* identity from `contacts` — one row
  // per person per organization, carrying their email, name, company, bio,
  // social links and admin-authored custom fields, plus notes, an activity
  // timeline, tags, pipeline entries and merge snapshots hanging off it. None
  // of it is reachable from `contacts` by any foreign key, so none of it was
  // touched here and none of it was cascaded away either: an erasure that
  // stopped at the event layer left the person's whole CRM profile in place.
  // Deleting it is what makes the claim in `docs/legal/dpa.md` ("permanently
  // deletes the contact and every row that references it") true.
  //
  // Resolved through the link row first, because `organization_contact_links`
  // is the explicit join M55 introduced precisely so an event contact's
  // organization identity is a stated fact rather than a string match. A
  // missing link is *not* proof that this person has no CRM profile, though —
  // CSV import and manual creation both produce link-less profiles — so an
  // organization-scoped erasure falls back to the `(organization_id, email)`
  // match documented on `resolveOrganizationContactByEmailIn` above. With
  // neither, the counts below stay zero.
  //
  // Deleting the identity also removes its links to *other* events in the same
  // organization — deliberate: erasure is about the person, and one
  // organization holds one profile for them. What it does not do is delete
  // those other events' own `contacts` rows; each is its own event-scoped
  // identity and needs its own erasure call. That residual is stated in
  // `eraseContactData`'s docs and in `docs/legal/`.
  //
  // Which is exactly why it is gated on `eraseOrganizationProfile` rather than
  // done unconditionally: reaching organization scope — the CRM profile, its
  // notes and pipeline, *and* other events' links to it — is authority this
  // function's event-scoped callers do not necessarily hold. `adminAuth` reads
  // `event_members` and nothing else, so an event organizer who is not an
  // organization member would otherwise have destroyed organization-wide CRM
  // records the same person cannot even read. The caller establishes
  // organization authority (`authorizeOrganization`) and passes the flag; with
  // the flag off, only this event's own link row is removed and every count
  // below stays zero.
  const [crmLink] = await tx.select({ organizationContactId: organizationContactLinks.organizationContactId })
    .from(organizationContactLinks)
    .where(and(eq(organizationContactLinks.eventId, eventId), eq(organizationContactLinks.contactId, contactId)))
    .limit(1);
  const organizationContactId = crmLink?.organizationContactId
    ?? (options.eraseOrganizationProfile ? await resolveOrganizationContactByEmailIn(tx, eventId, existing.email) : undefined);
  counts.organizationContactPipelineHistory = 0;
  counts.organizationContactPipeline = 0;
  counts.organizationContactNotes = 0;
  counts.organizationContactActivity = 0;
  counts.organizationContactTagLinks = 0;
  counts.organizationContactMerges = 0;
  counts.organizationContactLinks = 0;
  counts.organizationContactsMergedDuplicates = 0;
  counts.organizationContacts = 0;
  if (organizationContactId && !options.eraseOrganizationProfile) {
    // Event-only erasure: the person stops being linked to *this* event's
    // contact, the organization's profile for them is left whole.
    counts.organizationContactLinks = (
      await tx.delete(organizationContactLinks)
        .where(and(eq(organizationContactLinks.eventId, eventId), eq(organizationContactLinks.contactId, contactId)))
        .returning({ id: organizationContactLinks.id })
    ).length;
  } else if (organizationContactId) {
    // Duplicates merged into this identity are the *same data subject*, so
    // they are erased with it. Leaving them behind is not an option: their
    // personal columns are never scrubbed at merge time and `merged_into_id`
    // is the only thing hiding them (`listOrganizationContactsIn`'s
    // `merged_into_id IS NULL`), and that pointer is `ON DELETE SET NULL` — so
    // deleting the primary alone would *un*-hide the erased person's name,
    // company, title, bio and alternate email back into the directory,
    // segments and outreach audiences. Transitive, because merge chains
    // (C -> B -> A) are reachable.
    const mergedDuplicateIds = await collectMergedDuplicateIdsIn(tx, organizationContactId);
    const erasedContactIds = [organizationContactId, ...mergedDuplicateIds];
    const pipelines = await tx.select({ id: organizationContactPipeline.id })
      .from(organizationContactPipeline)
      .where(inArray(organizationContactPipeline.organizationContactId, erasedContactIds));
    const pipelineIds = pipelines.map((row) => row.id);
    counts.organizationContactPipelineHistory = pipelineIds.length === 0 ? 0 : (
      await tx.delete(organizationContactPipelineHistory).where(inArray(organizationContactPipelineHistory.pipelineId, pipelineIds)).returning({ id: organizationContactPipelineHistory.id })
    ).length;
    counts.organizationContactPipeline = (
      await tx.delete(organizationContactPipeline).where(inArray(organizationContactPipeline.organizationContactId, erasedContactIds)).returning({ id: organizationContactPipeline.id })
    ).length;
    counts.organizationContactNotes = (
      await tx.delete(organizationContactNotes).where(inArray(organizationContactNotes.organizationContactId, erasedContactIds)).returning({ id: organizationContactNotes.id })
    ).length;
    counts.organizationContactActivity = (
      await tx.delete(organizationContactActivity).where(inArray(organizationContactActivity.organizationContactId, erasedContactIds)).returning({ id: organizationContactActivity.id })
    ).length;
    counts.organizationContactTagLinks = (
      await tx.delete(organizationContactTagLinks).where(inArray(organizationContactTagLinks.organizationContactId, erasedContactIds)).returning({ tagId: organizationContactTagLinks.tagId })
    ).length;
    // The merge audit's `field_snapshot` is a verbatim copy of a losing row's
    // personal columns, so an erasure that left it behind would leave the
    // erased person's data in the database under another name. Both sides are
    // matched: these contacts as the loser *and* as the primary.
    counts.organizationContactMerges = (
      await tx.delete(organizationContactMerges)
        .where(or(inArray(organizationContactMerges.mergedContactId, erasedContactIds), inArray(organizationContactMerges.primaryContactId, erasedContactIds)))
        .returning({ id: organizationContactMerges.id })
    ).length;
    counts.organizationContactLinks = (
      await tx.delete(organizationContactLinks).where(inArray(organizationContactLinks.organizationContactId, erasedContactIds)).returning({ id: organizationContactLinks.id })
    ).length;
    // Losers first: with every row that points at the primary already gone,
    // the `merged_into_id` foreign key is satisfied without nulling anything.
    counts.organizationContactsMergedDuplicates = mergedDuplicateIds.length === 0 ? 0 : (
      await tx.delete(organizationContacts).where(inArray(organizationContacts.id, mergedDuplicateIds)).returning({ id: organizationContacts.id })
    ).length;
    counts.organizationContacts = (
      await tx.delete(organizationContacts).where(eq(organizationContacts.id, organizationContactId)).returning({ id: organizationContacts.id })
    ).length;
  }

  // 6. `SET NULL` columns, made explicit for the receipt.
  counts.submissionsAnonymized = (
    await tx.update(submissions)
      .set({ submitterContactId: null })
      .where(and(eq(submissions.eventId, eventId), eq(submissions.submitterContactId, contactId)))
      .returning({ id: submissions.id })
  ).length;
  // `file_assets_contact_fk` (`0000_init.sql`) is already `ON DELETE SET
  // NULL`; explicit here only so it counts toward the receipt.
  counts.fileAssetsAnonymized = (
    await tx.update(fileAssets).set({ uploadedByContactId: null }).where(eq(fileAssets.uploadedByContactId, contactId)).returning({ id: fileAssets.id })
  ).length;

  // 7. Root.
  await tx.delete(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)));
  counts.contacts = 1;

  const purgeCandidateFileIds = [...new Set(uploads.map((row) => row.fileAssetId).concat(existing.headshotFileId ? [existing.headshotFileId] : []))];

  return {
    purgeCandidateFileIds,
    receipt: contactErasureReceiptSchema.parse({
      eventId,
      contactId,
      erasedAt: new Date().toISOString(),
      deletedCounts: counts,
    }),
  };
}

/**
 * The audited transaction, plus the one thing that must happen *after* it
 * commits rather than inside it: purging the file objects the contact's
 * deleted rows just orphaned (their headshot above all — a face photo is
 * the single most sensitive asset a contact owns). R2 calls do not belong
 * inside a WebSocket-pool transaction, and `purgeOrphanedFileAssets` is
 * best-effort by the same convention every other R2 delete in this codebase
 * follows (`cleanupOrphanUploads`, `purge` in `r2.ts`): a failure here is
 * logged, not thrown — the DB erasure already succeeded and is the
 * compliance-critical half.
 */
export async function eraseContactData(
  eventId: EventId,
  contactId: ContactId,
  options: { eraseOrganizationProfile?: boolean } = {},
): Promise<ContactErasureReceipt> {
  const { receipt, purgeCandidateFileIds } = await withTx((tx) => eraseContactDataIn(tx, eventId, contactId, options));
  if (purgeCandidateFileIds.length > 0) {
    await purgeOrphanedFileAssets(purgeCandidateFileIds).catch((error: unknown) => {
      log({
        level: "warn",
        msg: "gdpr.contact_erasure.file_purge_failed",
        requestId: "gdpr",
        feature: "data-lifecycle",
        eventId,
        code: error instanceof Error ? error.message : String(error),
      });
    });
  }
  log({ level: "info", msg: "gdpr.contact_erased", requestId: "gdpr", feature: "data-lifecycle", eventId, code: contactId });
  return receipt;
}
