import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { eraseContactDataIn, exportContactDataIn, exportOrganizationDataIn, runDataRetentionSweepIn } from "@/features/data-lifecycle";
import { DEFAULT_ORGANIZATION_ID, contactIdSchema, eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M47 — data lifecycle & GDPR. One PGlite database, loaded with every
 * migration that declares a table this module reads or writes, exercised in
 * three phases in file order: (1) contact export, (2) contact erasure — the
 * FK-chain deletion, asserted table by table, plus a co-speaker contact left
 * untouched — (3) the retention sweep, and (4) organization export.
 */
const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// The two abuse-counter tables the sweep prunes — standalone, no FKs.
const migrationAdminAuth = readFileSync(new URL("../../drizzle/0002_admin_auth.sql", import.meta.url), "utf8");
const migrationRateLimits = readFileSync(new URL("../../drizzle/0005_rate_limits.sql", import.meta.url), "utf8");
const migrationContentDeliverables = readFileSync(new URL("../../drizzle/0006_content_deliverables.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationProductAuth = readFileSync(new URL("../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../drizzle/0011_user_management.sql", import.meta.url), "utf8");
const migrationBilling = readFileSync(new URL("../../drizzle/0012_billing_scaffold.sql", import.meta.url), "utf8");
// M55's CRM. Erasure reaches into it (see `eraseContactDataIn` step 5), so its
// tables have to exist here or the erasure case proves nothing about them.
const migrationCrm = readFileSync(new URL("../../drizzle/0013_speaker_crm.sql", import.meta.url), "utf8");
// 0022 creates `admin_auth_email_outbox`; 0025 widens its template check.
const migrationAdminAuthOutbox = readFileSync(new URL("../../drizzle/0022_admin_auth_email_outbox.sql", import.meta.url), "utf8");
const migrationOnboardingMilestones = readFileSync(new URL("../../drizzle/0023_onboarding_milestones.sql", import.meta.url), "utf8");
// Reviewer invitations extend organization_invitations, so their migration
// belongs in this fixture before organization exports query its current schema.
const migrationReviewerInvitations = readFileSync(new URL("../../drizzle/0029_event_reviewer_invitations.sql", import.meta.url), "utf8");
const migrationCalendarCancellationSnapshots = readFileSync(new URL("../../drizzle/0043_calendar_cancellation_snapshots.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("47000000-0000-4000-8000-000000000001");
// Primary submitter, headshot owner, uploader — everything about them is
// erased in the "erasure" describe block below.
const contactA = contactIdSchema.parse("47000000-0000-4000-8000-0000000000a1");
// Co-speaker on the same submission and session — proves erasure never
// bleeds across contacts.
const contactB = contactIdSchema.parse("47000000-0000-4000-8000-0000000000b1");
const formId = "47000000-0000-4000-8000-000000000f01";
const sectionId = "47000000-0000-4000-8000-000000000f02";
const fieldId = "47000000-0000-4000-8000-000000000f03";
const submissionId = "47000000-0000-4000-8000-000000000501";
const sessionId = "47000000-0000-4000-8000-000000000601";
const fileRequestId = "47000000-0000-4000-8000-000000000701";
const headshotFileId = "47000000-0000-4000-8000-000000000801";
const uploadedFileAssetId = "47000000-0000-4000-8000-000000000802";
const adminUserId = userIdSchema.parse("47000000-0000-4000-8000-000000000901");
// M55 CRM fixtures — the organization-level identity for contactA, plus a
// duplicate tombstoned into it.
const orgContactA = "47000000-0000-4000-8000-000000000c01";
const orgContactDuplicate = "47000000-0000-4000-8000-000000000c02";
const orgTagId = "47000000-0000-4000-8000-000000000c03";
const orgPipelineId = "47000000-0000-4000-8000-000000000c04";
// A CSV-imported CRM profile that was never pushed into an event, so it has no
// `organization_contact_links` row at all — plus the event contact the same
// person created by submitting.
const orgContactImported = "47000000-0000-4000-8000-000000000c05";
const importedContact = contactIdSchema.parse("47000000-0000-4000-8000-0000000000a3");
// A second event in the same organization, sharing `orgContactA`'s CRM identity
// — the event-only erasure below runs against it.
const secondEventId = eventIdSchema.parse("47000000-0000-4000-8000-000000000002");
const secondEventContact = contactIdSchema.parse("47000000-0000-4000-8000-0000000000a2");

let pglite: PGlite;
let db: DbOrTx;

beforeAll(async () => {
  pglite = new PGlite();
  for (const migration of [
    migration0, migration1, migrationAdminAuth, migrationRateLimits, migrationContentDeliverables, migrationEmailCompliance,
    migrationRoster, migrationProductAuth, migrationTenancy, migrationUserManagement,
    migrationBilling, migrationCrm, migrationAdminAuthOutbox, migrationOnboardingMilestones,
    migrationReviewerInvitations, migrationCalendarCancellationSnapshots,
  ]) {
    await pglite.exec(migration);
  }
  db = drizzle(pglite, { schema }) as unknown as DbOrTx;

  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Lifecycle Event','lifecycle-event','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
    [eventId],
  );
  await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'admin@example.com','Admin')", [adminUserId]);
  // `contacts.headshot_file_id` and `file_assets.uploaded_by_contact_id` are
  // a circular composite-FK pair — contacts land first with no headshot,
  // the file_assets rows are inserted further below, and the headshot link
  // is backfilled once that row exists.
  await pglite.query(
    `INSERT INTO contacts(id,event_id,email,first_name,last_name,bio_html)
     VALUES($1,$2,'a@example.com','Ada','Erasable','<p>bio</p>'),($3,$2,'b@example.com','Grace','Stays',NULL)`,
    [contactA, eventId, contactB],
  );

  await pglite.query(
    `INSERT INTO forms(id,event_id,context,internal_name) VALUES($1,$2,'cfp','CFP')`,
    [formId, eventId],
  );
  await pglite.query(`INSERT INTO form_sections(id,event_id,form_id,key) VALUES($1,$2,$3,'main')`, [sectionId, eventId, formId]);
  await pglite.query(
    `INSERT INTO form_fields(id,event_id,form_id,section_id,key,label,field_type) VALUES($1,$2,$3,$4,'title','Title','text')`,
    [fieldId, eventId, formId, sectionId],
  );

  await pglite.query(
    `INSERT INTO submissions(id,event_id,form_id,code,title,submitter_contact_id) VALUES($1,$2,$3,1,'A Talk',$4)`,
    [submissionId, eventId, formId, contactA],
  );
  const participantA = "47000000-0000-4000-8000-000000000511";
  const participantB = "47000000-0000-4000-8000-000000000512";
  await pglite.query(
    `INSERT INTO submission_participants(id,event_id,submission_id,contact_id,is_primary) VALUES
       ($1,$2,$3,$4,true),($5,$2,$3,$6,false)`,
    [participantA, eventId, submissionId, contactA, participantB, contactB],
  );
  await pglite.query(
    `INSERT INTO submission_answers(event_id,submission_id,field_id,participant_id,value) VALUES
       ($1,$2,$3,$4,'"Ada answer"'),($1,$2,$3,$5,'"Grace answer"')`,
    [eventId, submissionId, fieldId, participantA, participantB],
  );

  await pglite.query(`INSERT INTO sessions(id,event_id,title,slug) VALUES($1,$2,'A Talk','a-talk')`, [sessionId, eventId]);
  await pglite.query(
    `INSERT INTO session_speakers(event_id,session_id,contact_id) VALUES($1,$2,$3),($1,$2,$4)`,
    [eventId, sessionId, contactA, contactB],
  );
  await pglite.query(
    `INSERT INTO calendar_invites(event_id,contact_id,session_id,ics_uid,organizer_email,event_snapshot)
     VALUES($1,$2,$3,'uid-a','organizer@example.com',$4::jsonb)`,
    [eventId, contactA, sessionId, JSON.stringify({
      version: 1, eventId, sessionId, contactId: contactA,
      title: "A Talk", descriptionHtml: null,
      startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-17T01:00:00.000Z",
      room: null, track: null, eventName: "Lifecycle Event", eventSlug: "lifecycle-event",
      eventLocation: null, eventTimezone: "UTC",
      attendeeEmail: "a@example.com", attendeeFirstName: "Ada", attendeeLastName: "Erasable",
    })],
  );
  await pglite.query(
    `INSERT INTO communication_logs(event_id,contact_id,template_key,idempotency_key,status,subject_rendered,body_rendered_html,submission_id)
     VALUES($1,$2,'submission_received','idem-a','sent','Your talk','<p>hi Ada</p>',$3)`,
    [eventId, contactA, submissionId],
  );
  await pglite.query(`INSERT INTO contact_suppressions(contact_id,event_id,reason) VALUES($1,$2,'bounce')`, [contactA, eventId]);

  const logisticsFieldId = "47000000-0000-4000-8000-000000000f10";
  await pglite.query(`INSERT INTO speaker_logistics_fields(id,event_id,key,label) VALUES($1,$2,'shirt_size','Shirt size')`, [logisticsFieldId, eventId]);
  await pglite.query(`INSERT INTO speaker_logistics_values(event_id,field_id,contact_id,value) VALUES($1,$2,$3,'L')`, [eventId, logisticsFieldId, contactA]);
  await pglite.query(
    `INSERT INTO contact_unavailability(event_id,contact_id,starts_at,ends_at) VALUES($1,$2,'2026-09-16T00:00:00Z','2026-09-16T02:00:00Z')`,
    [eventId, contactA],
  );
  await pglite.query(
    `INSERT INTO speaker_bulk_messages(event_id,contact_id,idempotency_key,subject,body_html) VALUES($1,$2,'bulk-a','Hi','<p>hi</p>')`,
    [eventId, contactA],
  );
  await pglite.query(
    `INSERT INTO portal_tokens(event_id,contact_id,purpose,token_hash,expires_at) VALUES($1,$2,'magic_link','hash-a','2099-01-01T00:00:00Z')`,
    [eventId, contactA],
  );
  await pglite.query(
    `INSERT INTO portal_sessions(event_id,contact_id,token_hash,expires_at) VALUES($1,$2,'sess-hash-a','2099-01-01T00:00:00Z')`,
    [eventId, contactA],
  );

  await pglite.query(`INSERT INTO file_requests(id,event_id,title) VALUES($1,$2,'Slides')`, [fileRequestId, eventId]);
  await pglite.query(
    `INSERT INTO file_assets(id,event_id,kind,r2_key,filename,mime,size_bytes,uploaded_by_contact_id) VALUES
       ($1,$2,'headshot','evt_1/headshot/a/me.png','me.png','image/png',10,$3),
       ($4,$2,'slide','evt_1/slide/a/deck.pdf','deck.pdf','application/pdf',10,$3)`,
    [headshotFileId, eventId, contactA, uploadedFileAssetId],
  );
  await pglite.query("UPDATE contacts SET headshot_file_id = $1 WHERE id = $2", [headshotFileId, contactA]);
  await pglite.query(
    `INSERT INTO file_uploads(id,event_id,file_request_id,contact_id,file_asset_id) VALUES($1,$2,$3,$4,$5)`,
    ["47000000-0000-4000-8000-000000000811", eventId, fileRequestId, contactA, uploadedFileAssetId],
  );
  await pglite.query(
    `INSERT INTO file_comments(id,event_id,file_request_id,contact_id,author_role,author_contact_id,body) VALUES
       ($1,$2,$3,$4,'speaker',$4,'my own comment')`,
    ["47000000-0000-4000-8000-000000000821", eventId, fileRequestId, contactA],
  );

  // M55 CRM: the organization-level identity for the same person, linked to
  // this event's contact row, with one of everything that hangs off it —
  // including a tombstoned duplicate that was merged into her, so the
  // `merged_into_id` `SET NULL` path is exercised too.
  await pglite.query(
    `INSERT INTO organization_contacts(id,organization_id,email,first_name,last_name,bio_html) VALUES
       ($1,$3,'a@example.com','Ada','Erasable','<p>crm bio</p>'),
       ($2,$3,'dupe@example.com','Ada','Duplicate',NULL)`,
    [orgContactA, orgContactDuplicate, DEFAULT_ORGANIZATION_ID],
  );
  await pglite.query("UPDATE organization_contacts SET merged_into_id = $1 WHERE id = $2", [orgContactA, orgContactDuplicate]);
  await pglite.query(
    "INSERT INTO organization_contact_links(organization_id,organization_contact_id,event_id,contact_id) VALUES($1,$2,$3,$4)",
    [DEFAULT_ORGANIZATION_ID, orgContactA, eventId, contactA],
  );
  await pglite.query(
    "INSERT INTO organization_contact_tags(id,organization_id,name) VALUES($1,$2,'Keynoters')",
    [orgTagId, DEFAULT_ORGANIZATION_ID],
  );
  await pglite.query(
    "INSERT INTO organization_contact_tag_links(organization_id,organization_contact_id,tag_id) VALUES($1,$2,$3)",
    [DEFAULT_ORGANIZATION_ID, orgContactA, orgTagId],
  );
  await pglite.query(
    "INSERT INTO organization_contact_notes(organization_id,organization_contact_id,body_html) VALUES($1,$2,'<p>great on stage</p>')",
    [DEFAULT_ORGANIZATION_ID, orgContactA],
  );
  await pglite.query(
    "INSERT INTO organization_contact_activity(organization_id,organization_contact_id,kind) VALUES($1,$2,'created')",
    [DEFAULT_ORGANIZATION_ID, orgContactA],
  );
  await pglite.query(
    "INSERT INTO organization_contact_pipeline(id,organization_id,organization_contact_id,target_event_id,stage) VALUES($1,$2,$3,$4,'open')",
    [orgPipelineId, DEFAULT_ORGANIZATION_ID, orgContactA, eventId],
  );
  await pglite.query(
    "INSERT INTO organization_contact_pipeline_history(organization_id,pipeline_id,to_stage) VALUES($1,$2,'won')",
    [DEFAULT_ORGANIZATION_ID, orgPipelineId],
  );
  await pglite.query(
    `INSERT INTO organization_contact_merges(organization_id,primary_contact_id,merged_contact_id,field_snapshot,reference_counts)
     VALUES($1,$2,$3,'{"email":"dupe@example.com"}','{}')`,
    [DEFAULT_ORGANIZATION_ID, orgContactA, orgContactDuplicate],
  );

  // A second event in the same organization, holding its own contact row for
  // the same person and its own link to that one organization identity — the
  // ordinary result of `pushOrganizationContactToEvent`. Erasing *that* event's
  // contact must not take the organization identity (or this event's link to
  // it) with it.
  await pglite.query(
    "INSERT INTO events(id,name,slug,starts_at,ends_at) VALUES($1,'Second Event','second-event','2027-09-15T16:00:00Z','2027-09-17T01:00:00Z')",
    [secondEventId],
  );
  await pglite.query(
    "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'a@example.com','Ada','Erasable')",
    [secondEventContact, secondEventId],
  );
  await pglite.query(
    "INSERT INTO organization_contact_links(organization_id,organization_contact_id,event_id,contact_id) VALUES($1,$2,$3,$4)",
    [DEFAULT_ORGANIZATION_ID, orgContactA, secondEventId, secondEventContact],
  );
}, 30_000);

afterAll(async () => pglite.close());

describe("exportContactDataIn", () => {
  it("returns null for a contact id not on the event", async () => {
    await expect(exportContactDataIn(db, eventId, contactIdSchema.parse("47000000-0000-4000-8000-0000000000ff"))).resolves.toBeNull();
  });

  it("assembles the full bundle: profile, submitted answers, roster, comms, tokens/sessions without hashes", async () => {
    const bundle = await exportContactDataIn(db, eventId, contactA);
    expect(bundle).not.toBeNull();
    expect(bundle?.profile.email).toBe("a@example.com");
    expect(bundle?.submissions).toHaveLength(1);
    expect(bundle?.submissionAnswers).toEqual([{ submissionId, fieldId, value: "Ada answer" }]);
    expect(bundle?.roster.values).toEqual([{ fieldId: expect.any(String), value: "L" }]);
    expect(bundle?.sessionsSpeaking).toEqual([{ sessionId, title: "A Talk", role: "speaker" }]);
    expect(bundle?.communications).toHaveLength(1);
    expect(bundle?.communications[0]?.bodyHtml).toBe("<p>hi Ada</p>");
    expect(bundle?.calendarInvites).toEqual([{ sessionId, icsUid: "uid-a", lastMethod: "request", lastSentAt: null }]);
    expect(bundle?.bulkMessages).toHaveLength(1);
    expect(bundle?.fileComments).toHaveLength(1);
    expect(bundle?.emailSuppressed).toBe(true);
    // Never the bearer material — only issuance metadata.
    expect(bundle?.portalTokens).toEqual([{ purpose: "magic_link", createdAt: expect.any(String), expiresAt: expect.any(String), consumedAt: null }]);
    expect(bundle?.portalTokens[0]).not.toHaveProperty("tokenHash");
    expect(bundle?.portalSessions).toEqual([{ createdAt: expect.any(String), expiresAt: expect.any(String), impersonated: false }]);
  });
});

describe("eraseContactDataIn", () => {
  it("throws NOT_FOUND for a contact id not on the event", async () => {
    const tx = db as unknown as TxDb;
    await expect(eraseContactDataIn(tx, eventId, contactIdSchema.parse("47000000-0000-4000-8000-0000000000ff")))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");
  });

  // The organization half of the erasure is opt-in, because it is
  // organization-scoped destruction reached from an event-scoped route: an
  // event organizer holding no `organization_members` row cannot read the CRM
  // at all, so they must not be able to delete an organization contact — and
  // with it another event's link — through their own event's speaker roster.
  it("without eraseOrganizationProfile, drops only this event's CRM link and leaves the organization identity whole", async () => {
    const tx = db as unknown as TxDb;
    const { receipt } = await eraseContactDataIn(tx, secondEventId, secondEventContact);

    expect(receipt.deletedCounts).toMatchObject({
      contacts: 1,
      organizationContactLinks: 1,
      organizationContacts: 0,
      organizationContactNotes: 0,
      organizationContactPipeline: 0,
      organizationContactActivity: 0,
      organizationContactTagLinks: 0,
      organizationContactMerges: 0,
    });

    // The organization identity and everything hanging off it survive, and so
    // does the *other* event's link to it — the collateral this flag prevents.
    const survivors = (await pglite.query<{ table_name: string; n: number }>(`
      SELECT 'contacts' AS table_name, count(*)::int AS n FROM organization_contacts WHERE id = $1
      UNION ALL SELECT 'notes', count(*)::int FROM organization_contact_notes WHERE organization_contact_id = $1
      UNION ALL SELECT 'pipeline', count(*)::int FROM organization_contact_pipeline WHERE organization_contact_id = $1
    `, [orgContactA])).rows;
    expect(survivors.every((row) => row.n === 1)).toBe(true);
    const links = (await pglite.query<{ event_id: string }>(
      "SELECT event_id FROM organization_contact_links WHERE organization_contact_id = $1", [orgContactA],
    )).rows;
    expect(links.map((row) => row.event_id)).toEqual([eventId]);
  });

  it("deletes every table the contact's data reaches, anonymizes what survives, and never touches the co-speaker", async () => {
    const tx = db as unknown as TxDb;
    const { receipt, purgeCandidateFileIds } = await eraseContactDataIn(tx, eventId, contactA, { eraseOrganizationProfile: true });

    expect(receipt.contactId).toBe(contactA);
    expect(receipt.deletedCounts).toMatchObject({
      submissionAnswers: 1,
      taskCompletions: 0,
      fileUploads: 1,
      fileComments: 1,
      fileCommentsAnonymized: 0,
      formResponses: 0,
      submissionParticipants: 1,
      sessionSpeakers: 1,
      calendarInvites: 1,
      communicationLogs: 1,
      contactSuppressions: 1,
      speakerLogisticsValues: 1,
      contactUnavailability: 1,
      speakerBulkMessages: 1,
      portalSessions: 1,
      portalTokens: 1,
      submissionsAnonymized: 1,
      fileAssetsAnonymized: 2,
      contacts: 1,
      // M55 CRM — the organization-level identity and everything hanging off
      // it. None of this is reachable from `contacts` by any foreign key, so
      // before erasure reached it explicitly the person's whole speaker-CRM
      // profile survived a "delete contact".
      organizationContactPipelineHistory: 1,
      organizationContactPipeline: 1,
      organizationContactNotes: 1,
      organizationContactActivity: 1,
      organizationContactTagLinks: 1,
      organizationContactMerges: 1,
      organizationContactLinks: 1,
      organizationContactsMergedDuplicates: 1,
      organizationContacts: 1,
    });
    // The headshot and the uploaded slide, both captured before deletion —
    // the caller (`eraseContactData`) purges these from R2 after commit.
    expect(new Set(purgeCandidateFileIds)).toEqual(new Set([headshotFileId, uploadedFileAssetId]));

    // The contact itself is gone.
    const contactCountRow = (await pglite.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM contacts WHERE id = $1", [contactA],
    )).rows[0];
    expect(contactCountRow?.count).toBe(0);

    // The submission survives as an organizational record, anonymized.
    const submissionRow = (await pglite.query<{ submitter_contact_id: string | null; title: string }>(
      "SELECT submitter_contact_id, title FROM submissions WHERE id = $1", [submissionId],
    )).rows[0];
    expect(submissionRow?.submitter_contact_id).toBeNull();
    expect(submissionRow?.title).toBe("A Talk");

    // The co-speaker's own rows are untouched.
    const bContact = (await pglite.query("SELECT 1 FROM contacts WHERE id = $1", [contactB])).rows;
    expect(bContact).toHaveLength(1);
    const bParticipant = (await pglite.query("SELECT 1 FROM submission_participants WHERE contact_id = $1", [contactB])).rows;
    expect(bParticipant).toHaveLength(1);
    const bAnswer = (await pglite.query("SELECT value FROM submission_answers WHERE participant_id IN (SELECT id FROM submission_participants WHERE contact_id = $1)", [contactB])).rows;
    expect(bAnswer).toHaveLength(1);
    const bSpeaking = (await pglite.query("SELECT 1 FROM session_speakers WHERE contact_id = $1", [contactB])).rows;
    expect(bSpeaking).toHaveLength(1);

    // The uploaded slide row survives (only its uploader attribution is
    // scrubbed) — deleting it outright is `purgeOrphanedFileAssets`'s job,
    // called by `eraseContactData` after this transaction commits.
    const slide = (await pglite.query<{ uploaded_by_contact_id: string | null }>(
      "SELECT uploaded_by_contact_id FROM file_assets WHERE id = $1", [uploadedFileAssetId],
    )).rows[0];
    expect(slide?.uploaded_by_contact_id).toBeNull();

    // The CRM identity is gone, and so is every row that carried her personal
    // data at organization scope — including the merge audit's snapshot of the
    // duplicate she absorbed.
    const crmRows = (await pglite.query<{ table_name: string; n: number }>(`
      SELECT 'contacts' AS table_name, count(*)::int AS n FROM organization_contacts WHERE id = $1
      UNION ALL SELECT 'links', count(*)::int FROM organization_contact_links WHERE organization_contact_id = $1
      UNION ALL SELECT 'tag_links', count(*)::int FROM organization_contact_tag_links WHERE organization_contact_id = $1
      UNION ALL SELECT 'notes', count(*)::int FROM organization_contact_notes WHERE organization_contact_id = $1
      UNION ALL SELECT 'activity', count(*)::int FROM organization_contact_activity WHERE organization_contact_id = $1
      UNION ALL SELECT 'pipeline', count(*)::int FROM organization_contact_pipeline WHERE organization_contact_id = $1
      UNION ALL SELECT 'merges', count(*)::int FROM organization_contact_merges WHERE primary_contact_id = $1 OR merged_contact_id = $1
    `, [orgContactA])).rows;
    expect(crmRows.every((row) => row.n === 0)).toBe(true);

    // The organization's own vocabulary survives — a tag is the organization's
    // data, not the contact's.
    const tag = (await pglite.query("SELECT 1 FROM organization_contact_tags WHERE id = $1", [orgTagId])).rows;
    expect(tag).toHaveLength(1);

    // The tombstoned duplicate goes with her. A merge is the organizer's
    // explicit assertion that the two rows are the same person, and the losing
    // row keeps every personal column it had — its only concealment is
    // `merged_into_id`, which is `ON DELETE SET NULL`. Leaving it behind would
    // have republished her name, company, bio and alternate address into the
    // directory and segments as a *result* of the erasure.
    const duplicate = (await pglite.query(
      "SELECT 1 FROM organization_contacts WHERE id = $1", [orgContactDuplicate],
    )).rows;
    expect(duplicate).toHaveLength(0);

    // A second erasure of the same (now-gone) contact is a clean NOT_FOUND,
    // not a partial re-run of already-empty deletes.
    await expect(eraseContactDataIn(tx, eventId, contactA))
      .rejects.toSatisfy((error: unknown) => isAppError(error) && error.code === "NOT_FOUND");
  });

  // Only `pushOrganizationContactToEventIn` ever writes a link row, while CSV
  // import and manual creation both produce link-less `organization_contacts`
  // — so "no link" cannot be read as "no CRM profile", and an erasure scoped
  // through the link alone would have reported nine CRM zeros while the whole
  // imported profile survived.
  it("reaches an imported CRM profile that was never pushed into the event, by email", async () => {
    const tx = db as unknown as TxDb;
    await pglite.query(
      "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'imported@example.com','Ines','Imported')",
      [importedContact, eventId],
    );
    await pglite.query(
      `INSERT INTO organization_contacts(id,organization_id,email,first_name,last_name,company,source)
       VALUES($1,$2,'imported@example.com','Ines','Imported','Acme','import')`,
      [orgContactImported, DEFAULT_ORGANIZATION_ID],
    );
    await pglite.query(
      "INSERT INTO organization_contact_notes(organization_id,organization_contact_id,body_html) VALUES($1,$2,'<p>met at a meetup</p>')",
      [DEFAULT_ORGANIZATION_ID, orgContactImported],
    );

    const { receipt } = await eraseContactDataIn(tx, eventId, importedContact, { eraseOrganizationProfile: true });
    expect(receipt.deletedCounts).toMatchObject({
      contacts: 1,
      organizationContactLinks: 0,
      organizationContactNotes: 1,
      organizationContacts: 1,
    });
    const profile = (await pglite.query("SELECT 1 FROM organization_contacts WHERE id = $1", [orgContactImported])).rows;
    expect(profile).toHaveLength(0);
  });

  it("exportContactDataIn now returns null for the erased contact", async () => {
    await expect(exportContactDataIn(db, eventId, contactA)).resolves.toBeNull();
  });
});

describe("runDataRetentionSweepIn", () => {
  const now = new Date("2026-09-20T00:00:00Z");
  const longExpired = new Date("2026-01-01T00:00:00Z"); // well past the 30-day grace window
  const recentlyExpired = new Date("2026-09-15T00:00:00Z"); // within the grace window
  const notExpired = new Date("2099-01-01T00:00:00Z");
  const oldCreatedAt = new Date("2025-01-01T00:00:00Z"); // well past the 90-day body-retention window
  const recentCreatedAt = new Date("2026-09-19T00:00:00Z");
  const idleCounter = new Date("2026-09-01T00:00:00Z"); // past the 7-day abuse-counter window
  const activeCounter = new Date("2026-09-19T00:00:00Z"); // inside it
  const liveBlock = new Date("2026-09-20T00:15:00Z"); // a sign-in block still in force at `now`

  beforeAll(async () => {
    // Fresh rows on the surviving contact — the erasure block above already
    // deleted contactA's own tokens/sessions, so this exercises the sweep
    // independently of that chain.
    await pglite.query(
      `INSERT INTO portal_tokens(event_id,contact_id,purpose,token_hash,expires_at) VALUES
         ($1,$2,'magic_link','ret-tok-old',$3),($1,$2,'magic_link','ret-tok-grace',$4),($1,$2,'magic_link','ret-tok-live',$5)`,
      [eventId, contactB, longExpired, recentlyExpired, notExpired],
    );
    await pglite.query(
      `INSERT INTO portal_sessions(event_id,contact_id,token_hash,expires_at) VALUES
         ($1,$2,'ret-sess-old',$3),($1,$2,'ret-sess-live',$4)`,
      [eventId, contactB, longExpired, notExpired],
    );
    await pglite.query(
      `INSERT INTO admin_sessions(id,user_id,token,expires_at) VALUES
         ('47000000-0000-4000-8000-000000000911',$1,'ret-admin-old',$2),
         ('47000000-0000-4000-8000-000000000912',$1,'ret-admin-live',$3)`,
      [adminUserId, longExpired, notExpired],
    );
    await pglite.query(
      `INSERT INTO admin_verifications(id,identifier,value,expires_at) VALUES
         ('47000000-0000-4000-8000-000000000921','reset:admin@example.com','tok-old',$1),
         ('47000000-0000-4000-8000-000000000922','reset:admin@example.com','tok-live',$2)`,
      [longExpired, notExpired],
    );
    await pglite.query(
      `INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status,subject_rendered,body_rendered_html,created_at) VALUES
         ('47000000-0000-4000-8000-000000000931',$1,$2,'submission_received','idem-old','sent','Old subject','<p>old</p>',$3),
         ('47000000-0000-4000-8000-000000000932',$1,$2,'submission_received','idem-new','sent','New subject','<p>new</p>',$4),
         ('47000000-0000-4000-8000-000000000933',$1,$2,'schedule_changed','cancel-terminal','sent',NULL,NULL,$3),
         ('47000000-0000-4000-8000-000000000934',$1,$2,'schedule_changed','cancel-pending','queued',NULL,NULL,$3)`,
      [eventId, contactB, oldCreatedAt, recentCreatedAt],
    );
    const retainedSnapshot = JSON.stringify({
      version: 1, eventId, sessionId, contactId: contactB,
      title: "A Talk", descriptionHtml: null,
      startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-17T01:00:00.000Z",
      room: null, track: null, eventName: "Lifecycle Event", eventSlug: "lifecycle-event",
      eventLocation: null, eventTimezone: "UTC",
      attendeeEmail: "b@example.com", attendeeFirstName: "Grace", attendeeLastName: "Stays",
      uid: "retention-calendar@example.com", sequence: 1,
      organizerEmail: "organizer@example.com", cancelledAt: "2026-01-01T00:00:00.000Z",
    });
    await pglite.query(
      `INSERT INTO calendar_cancellation_jobs(communication_log_id,snapshot)
       VALUES('47000000-0000-4000-8000-000000000933',$1::jsonb),
             ('47000000-0000-4000-8000-000000000934',$1::jsonb)`,
      [retainedSnapshot],
    );
    await pglite.query(
      "INSERT INTO rate_limit_buckets(key_hash,count,window_started_at,updated_at) VALUES('rl-idle',3,$1,$1),('rl-active',3,$2,$2)",
      [idleCounter, activeCounter],
    );
    // The platform outbox carries the same rendered content as
    // `communication_logs`, plus the sealed reset/verification payload on a
    // failed row, and nothing aged any of it out.
    await pglite.query(
      `INSERT INTO admin_auth_email_outbox(user_id,recipient_email,template_key,idempotency_key,status,subject_rendered,body_rendered_html,secret_payload_ciphertext,created_at) VALUES
         ($1,'old@example.com','admin_password_reset','ret-admin-old','sent','Reset your password','<p>old</p>','\\xdeadbeef'::bytea,$2),
         ($1,'fresh@example.com','admin_password_reset','ret-admin-fresh','sent','Reset your password','<p>fresh</p>',NULL,$3)`,
      [adminUserId, oldCreatedAt, recentCreatedAt],
    );
    await pglite.query(
      `INSERT INTO admin_login_attempts(key_hash,attempts,window_started_at,blocked_until,updated_at) VALUES
         ('la-idle',3,$1,NULL,$1),
         ('la-idle-block-lapsed',5,$1,$1,$1),
         ('la-idle-block-live',5,$1,$3,$1),
         ('la-active',3,$2,NULL,$2)`,
      [idleCounter, activeCounter, liveBlock],
    );
  });

  it("purges tokens/sessions expired past their grace window and leaves recently-expired and live ones alone", async () => {
    const stats = await runDataRetentionSweepIn(db, now);
    expect(stats.expiredPortalTokens).toBe(1);
    expect(stats.expiredPortalSessions).toBe(1);
    expect(stats.expiredAdminSessions).toBe(1);
    expect(stats.expiredAdminVerifications).toBe(1);
    expect(stats.redactedCommunicationLogs).toBe(1);
    expect(stats.redactedAdminAuthEmails).toBe(1);
    const adminOutbox = (await pglite.query<{ idempotency_key: string; subject_rendered: string | null; secret_payload_ciphertext: Uint8Array | null }>(
      "SELECT idempotency_key, subject_rendered, secret_payload_ciphertext FROM admin_auth_email_outbox ORDER BY idempotency_key",
    )).rows;
    // The delivery record survives as the audit trail; the content does not.
    expect(adminOutbox.map((row) => row.idempotency_key)).toEqual(["ret-admin-fresh", "ret-admin-old"]);
    expect(adminOutbox[1]?.subject_rendered).toBeNull();
    expect(adminOutbox[1]?.secret_payload_ciphertext).toBeNull();
    expect(adminOutbox[0]?.subject_rendered).toBe("Reset your password");
    expect(stats.removedStaleCalendarCancellationJobs).toBe(1);
    expect(stats.staleRateLimitBuckets).toBe(1);
    expect(stats.staleAdminLoginAttempts).toBe(2);

    const tokens = (await pglite.query<{ token_hash: string }>("SELECT token_hash FROM portal_tokens WHERE contact_id = $1 ORDER BY token_hash", [contactB])).rows;
    expect(tokens.map((row) => row.token_hash)).toEqual(["ret-tok-grace", "ret-tok-live"]);

    const sessions = (await pglite.query<{ token_hash: string }>("SELECT token_hash FROM portal_sessions WHERE contact_id = $1", [contactB])).rows;
    expect(sessions.map((row) => row.token_hash)).toEqual(["ret-sess-live"]);

    const adminSessionRows = (await pglite.query<{ token: string }>("SELECT token FROM admin_sessions WHERE user_id = $1", [adminUserId])).rows;
    expect(adminSessionRows.map((row) => row.token)).toEqual(["ret-admin-live"]);

    const verifications = (await pglite.query<{ value: string }>("SELECT value FROM admin_verifications")).rows;
    expect(verifications.map((row) => row.value)).toEqual(["tok-live"]);

    // Redacted: content gone, row (and its audit metadata) survives.
    const oldLog = (await pglite.query<{ subject_rendered: string | null; body_rendered_html: string | null; status: string }>(
      "SELECT subject_rendered, body_rendered_html, status FROM communication_logs WHERE idempotency_key = 'idem-old'",
    )).rows[0];
    expect(oldLog?.subject_rendered).toBeNull();
    expect(oldLog?.body_rendered_html).toBeNull();
    expect(oldLog?.status).toBe("sent");

    const newLog = (await pglite.query<{ subject_rendered: string | null }>(
      "SELECT subject_rendered FROM communication_logs WHERE idempotency_key = 'idem-new'",
    )).rows[0];
    expect(newLog?.subject_rendered).toBe("New subject");
    const cancellationJobs = await pglite.query<{ idempotency_key: string }>(
      `SELECT logs.idempotency_key FROM calendar_cancellation_jobs jobs
       JOIN communication_logs logs ON logs.id=jobs.communication_log_id`,
    );
    expect(cancellationJobs.rows).toEqual([{ idempotency_key: "cancel-pending" }]);
  });

  it("sweeps idle abuse counters but keeps recent ones and any block still in force", async () => {
    // The sweep above already ran against these rows; assert what it left.
    const buckets = (await pglite.query<{ key_hash: string }>("SELECT key_hash FROM rate_limit_buckets ORDER BY key_hash")).rows;
    expect(buckets.map((row) => row.key_hash)).toEqual(["rl-active"]);

    // `la-idle-block-live` is idle but still inside its 15-minute block, so
    // deleting it would hand the blocked caller a free reset.
    const attempts = (await pglite.query<{ key_hash: string }>("SELECT key_hash FROM admin_login_attempts ORDER BY key_hash")).rows;
    expect(attempts.map((row) => row.key_hash)).toEqual(["la-active", "la-idle-block-live"]);
  });

  it("is idempotent — a second run finds nothing left to sweep", async () => {
    const stats = await runDataRetentionSweepIn(db, now);
    expect(stats).toEqual({
      expiredPortalTokens: 0,
      expiredAdminVerifications: 0,
      expiredPortalSessions: 0,
      expiredAdminSessions: 0,
      redactedCommunicationLogs: 0,
      redactedAdminAuthEmails: 0,
      removedStaleCalendarCancellationJobs: 0,
      staleRateLimitBuckets: 0,
      staleAdminLoginAttempts: 0,
    });
  });
});

describe("exportOrganizationDataIn", () => {
  const organizationId = organizationIdSchema.parse("47000000-0000-4000-8000-00000000a001");

  beforeAll(async () => {
    await pglite.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Lifecycle Org','lifecycle-org')", [organizationId]);
    await pglite.query("INSERT INTO organization_members(user_id,organization_id,role) VALUES($1,$2,'owner')", [adminUserId, organizationId]);
    await pglite.query(
      "INSERT INTO organization_invitations(organization_id,email,token_hash,invited_by_user_id,expires_at) VALUES($1,'invitee@example.com','inv-hash',$2,'2099-01-01T00:00:00Z')",
      [organizationId, adminUserId],
    );
    await pglite.query(
      "INSERT INTO organization_audit_log(organization_id,actor_user_id,action,target_user_id) VALUES($1,$2,'member_added',$2)",
      [organizationId, adminUserId],
    );
    await pglite.query(
      "INSERT INTO organization_onboarding_milestones(organization_id,milestone,actor_user_id) VALUES($1,'signup_completed',$2)",
      [organizationId, adminUserId],
    );
    await pglite.query("UPDATE events SET organization_id = $1 WHERE id = $2", [organizationId, eventId]);
  });

  it("returns null for an unknown organization", async () => {
    await expect(exportOrganizationDataIn(db, organizationIdSchema.parse("47000000-0000-4000-8000-00000000afff"))).resolves.toBeNull();
  });

  it("composes the organization's own admin data: profile, members, pending invitations, audit log, events", async () => {
    const bundle = await exportOrganizationDataIn(db, organizationId);
    expect(bundle?.organization.slug).toBe("lifecycle-org");
    expect(bundle?.members).toEqual([expect.objectContaining({ userId: adminUserId, role: "owner", email: "admin@example.com" })]);
    expect(bundle?.pendingInvitations).toHaveLength(1);
    expect(bundle?.pendingInvitations[0]?.email).toBe("invitee@example.com");
    expect(bundle?.auditLog).toHaveLength(1);
    expect(bundle?.auditLog[0]?.action).toBe("member_added");
    expect(bundle?.onboardingMilestones).toEqual([
      expect.objectContaining({ milestone: "signup_completed", actorUserId: adminUserId }),
    ]);
    expect(bundle?.events.map((row) => row.slug)).toEqual(["lifecycle-event"]);
  });
});
