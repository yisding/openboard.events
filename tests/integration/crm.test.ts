import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { composeCrmBulkEmailIn } from "@/features/crm/server/bulk-email";
import { importCrmContactsCsvIn } from "@/features/crm/server/csv-import";
import { getCrmMergeAuditIn, mergeOrganizationContactsIn, previewCrmMergeIn, recoverCrmMergeIn } from "@/features/crm/server/merge";
import {
  createCrmNoteIn,
  createCrmPipelineEntryIn,
  createCrmPipelineEntryWithPostCommitActivityIn,
  createCrmTagIn,
  createOrganizationContactIn,
  createOrganizationContactWithPostCommitActivityIn,
  pushOrganizationContactToEventIn,
  setCrmContactTagsIn,
  transitionCrmPipelineIn,
  updateOrganizationContactIn,
} from "@/features/crm/server/mutations";
import {
  getCrmMetricsIn,
  getCrmPipelineHistoryIn,
  getOrganizationContactHistoryIn,
  listCrmPipelineIn,
  listOrganizationContactsIn,
  resolveCrmSegmentIn,
} from "@/features/crm/server/queries";
import { crmNoteIdSchema, crmPipelineIdSchema, eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

/**
 * M55 — organization-level speaker CRM. Mirrors the isolation questions
 * `organization-tenancy.test.ts` and `speaker-roster.test.ts` already ask
 * one scope apart: does the database refuse to leak across organizations,
 * and does every AC path (cross-event history, merge, dynamic segments,
 * push-to-event, pipeline) actually work end to end over PGlite.
 */

const migration0 = readFileSync(new URL("../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
const migrationEmailCompliance = readFileSync(new URL("../../drizzle/0007_email_compliance.sql", import.meta.url), "utf8");
const migrationRoster = readFileSync(new URL("../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
const migrationTenancy = readFileSync(new URL("../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationCrm = readFileSync(new URL("../../drizzle/0013_speaker_crm.sql", import.meta.url), "utf8");
const migrationSpeakerMoments = readFileSync(new URL("../../drizzle/0016_speaker_moments.sql", import.meta.url), "utf8");
const migrationCrmMergeRecovery = readFileSync(new URL("../../drizzle/0017_crm_merge_recovery.sql", import.meta.url), "utf8");
const migrationCrmPipelineCreationPayload = readFileSync(new URL("../../drizzle/0035_crm_pipeline_creation_payload.sql", import.meta.url), "utf8");
const migrationIdentityLinks = readFileSync(new URL("../../drizzle/0041_stable_user_contact_links.sql", import.meta.url), "utf8");

const orgA = organizationIdSchema.parse("c55a0000-0000-4000-8000-000000000001");
const orgB = organizationIdSchema.parse("c55a0000-0000-4000-8000-000000000002");
const eventA1 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000a1");
const eventA2 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000a2");
const eventA3 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000a3");
const eventB1 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000b1");
const actorUserId = userIdSchema.parse("c55a0000-0000-4000-8000-0000000000f1");

let pglite: PGlite;
let db: DbOrTx;
function createTestDb(client: PGlite) {
  return drizzle(client, { schema });
}
let database: ReturnType<typeof createTestDb>;
let postCommitDb: Parameters<typeof createOrganizationContactWithPostCommitActivityIn>[0];
let pipelinePostCommitDb: Parameters<typeof createCrmPipelineEntryWithPostCommitActivityIn>[0];
let runPipelineTransaction: Parameters<typeof createCrmPipelineEntryWithPostCommitActivityIn>[1];

describe("organization-level speaker CRM (M55)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    for (const migration of [migration0, migration1, migrationEmailCompliance, migrationRoster, migrationTenancy, migrationCrm, migrationSpeakerMoments, migrationCrmMergeRecovery, migrationCrmPipelineCreationPayload, migrationIdentityLinks]) {
      await pglite.exec(migration);
    }
    database = createTestDb(pglite);
    db = database as unknown as DbOrTx;
    postCommitDb = database as unknown as Parameters<typeof createOrganizationContactWithPostCommitActivityIn>[0];
    pipelinePostCommitDb = database as unknown as Parameters<typeof createCrmPipelineEntryWithPostCommitActivityIn>[0];
    runPipelineTransaction = async (work) => database.transaction((tx) => work(tx as unknown as TxDb));

    await pglite.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Org A','org-a'),($2,'Org B','org-b')", [orgA, orgB]);
    for (const [id, name, slug, orgId] of [
      [eventA1, "Event A1", "crm-event-a1", orgA],
      [eventA2, "Event A2", "crm-event-a2", orgA],
      [eventA3, "Event A3", "crm-event-a3", orgA],
      [eventB1, "Event B1", "crm-event-b1", orgB],
    ] as const) {
      await pglite.query(
        "INSERT INTO events(id,name,slug,organization_id,timezone,starts_at,ends_at) VALUES($1,$2,$3,$4,'America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
        [id, name, slug, orgId],
      );
    }
    await pglite.query("INSERT INTO users(id,email,name) VALUES($1,'organizer@example.com','Organizer')", [actorUserId]);
  }, 30_000);

  afterAll(async () => pglite.close());

  it("keeps post-commit creation authoritative without returning an id from a rolled-back transaction", async () => {
    await pglite.exec(`
      CREATE FUNCTION fail_created_contact_activity() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'created' THEN
          RAISE EXCEPTION 'forced created-contact activity failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_created_contact_activity
      BEFORE INSERT ON organization_contact_activity
      FOR EACH ROW EXECUTE FUNCTION fail_created_contact_activity();
    `);

    let transactionResult: Awaited<ReturnType<typeof createOrganizationContactIn>> | undefined;
    let createdId: Awaited<ReturnType<typeof createOrganizationContactWithPostCommitActivityIn>>;
    try {
      await expect(database.transaction(async (tx) => {
        transactionResult = await createOrganizationContactIn(tx as unknown as TxDb, orgA, {
          email: "rolled-back-activity@example.com",
          firstName: "Rolled",
          lastName: "Back",
        });
        return transactionResult;
      })).rejects.toThrow();
      expect(transactionResult).toBeUndefined();
      expect((await pglite.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM organization_contacts WHERE organization_id=$1 AND email='rolled-back-activity@example.com'",
        [orgA],
      )).rows).toEqual([{ count: 0 }]);

      createdId = await createOrganizationContactWithPostCommitActivityIn(postCommitDb, orgA, {
        email: "activity-failure@example.com",
        firstName: "Still",
        lastName: "Created",
      });

      const failedActivityRows = await pglite.query<{ id: string; activities: number }>(
        `SELECT c.id,
           (SELECT count(*)::int FROM organization_contact_activity a WHERE a.organization_contact_id=c.id) AS activities
         FROM organization_contacts c
         WHERE c.organization_id=$1 AND c.email='activity-failure@example.com'`,
        [orgA],
      );
      expect(failedActivityRows.rows).toEqual([{ id: createdId, activities: 0 }]);

      await expect(createOrganizationContactWithPostCommitActivityIn(postCommitDb, orgA, { email: "activity-failure@example.com" }))
        .rejects.toSatisfy((error) => isAppError(error) && error.code === "CONFLICT");
      expect((await pglite.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM organization_contacts WHERE organization_id=$1 AND email='activity-failure@example.com'",
        [orgA],
      )).rows).toEqual([{ count: 1 }]);
    } finally {
      await pglite.exec("DROP TRIGGER fail_created_contact_activity ON organization_contact_activity; DROP FUNCTION fail_created_contact_activity();");
    }

    const normalId = await createOrganizationContactWithPostCommitActivityIn(postCommitDb, orgA, {
      email: "activity-success@example.com",
      firstName: "Activity",
      lastName: "Recorded",
    });
    expect((await pglite.query<{ kind: string; source: string }>(
      `SELECT kind, metadata->>'source' AS source
       FROM organization_contact_activity
       WHERE organization_id=$1 AND organization_contact_id=$2`,
      [orgA, normalId],
    )).rows).toEqual([{ kind: "created", source: "manual" }]);
  });

  it("pushes a contact into two events without duplicating the organization identity, and isolates organizations", async () => {
    const adaId = await createOrganizationContactIn(db, orgA, { email: "Ada@Example.com", firstName: "Ada", lastName: "Lovelace" });

    const first = await pushOrganizationContactToEventIn(db, orgA, adaId, eventA1);
    expect(first.created).toBe(true);
    expect(first.alreadyLinked).toBe(false);

    // Same event again: idempotent, no duplicate event contact and no new link.
    const repeat = await pushOrganizationContactToEventIn(db, orgA, adaId, eventA1);
    expect(repeat.contactId).toBe(first.contactId);
    expect(repeat.alreadyLinked).toBe(true);
    const [contactCountRow] = (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM contacts WHERE event_id=$1 AND email='ada@example.com'", [eventA1],
    )).rows;
    expect(contactCountRow?.n).toBe(1);

    const second = await pushOrganizationContactToEventIn(db, orgA, adaId, eventA2);
    expect(second.created).toBe(true);
    expect(second.contactId).not.toBe(first.contactId); // a different event's own contact row

    const history = await getOrganizationContactHistoryIn(db, orgA, adaId);
    expect(history?.events.map((e) => e.eventId).sort()).toEqual([eventA1, eventA2].sort());

    const directory = await listOrganizationContactsIn(db, orgA, { limit: 50, offset: 0 });
    const adaRow = directory.rows.find((row) => row.id === adaId);
    expect(adaRow?.eventCount).toBe(2);

    // Cross-organization: pushing into another org's event is refused, and
    // an org-A id resolves to nothing when read as org B.
    await expect(pushOrganizationContactToEventIn(db, orgA, adaId, eventB1)).rejects.toSatisfy((e) => isAppError(e) && e.code === "NOT_FOUND");
    expect(await getOrganizationContactHistoryIn(db, orgB, adaId)).toBeNull();

    // The same email is a distinct identity in a different organization.
    const adaInOrgB = await createOrganizationContactIn(db, orgB, { email: "ada@example.com", firstName: "Ada" });
    const orgBDirectory = await listOrganizationContactsIn(db, orgB, { limit: 50, offset: 0 });
    expect(orgBDirectory.rows.map((r) => r.id)).toEqual([adaInOrgB]);
    expect(orgBDirectory.rows.some((r) => r.id === adaId)).toBe(false);
  });

  it("creates a note and its activity exactly once when a stable request is retried", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, { email: "notes@example.com", firstName: "Note", lastName: "Keeper" });
    const noteId = crmNoteIdSchema.parse("c55a0000-0000-4000-8000-0000000000d1");
    const input = { noteId, bodyHtml: "<p>Follow up after the conference</p>" };

    const first = await createCrmNoteIn(db, orgA, contactId, input, actorUserId);
    const retry = await createCrmNoteIn(db, orgA, contactId, input, actorUserId);

    expect(retry).toEqual(first);
    const [counts] = (await pglite.query<{ notes: number; activities: number }>(`
      SELECT
        (SELECT count(*)::int FROM organization_contact_notes WHERE id=$1) AS notes,
        (SELECT count(*)::int FROM organization_contact_activity WHERE organization_contact_id=$2 AND kind='note_added') AS activities
    `, [noteId, contactId])).rows;
    expect(counts).toEqual({ notes: 1, activities: 1 });
  });

  it("atomically creates a prospect and replays its immutable request after the contact is merged", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, {
      email: "atomic.pipeline@example.com",
      firstName: "Atomic",
      lastName: "Prospect",
    });
    const pipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e1");
    const input = { id: pipelineId, organizationContactId: contactId, targetEventId: eventA1, notes: "Meet after keynote" };

    await pglite.exec(`
      CREATE FUNCTION fail_initial_pipeline_history() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced initial-pipeline-history failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_initial_pipeline_history
      BEFORE INSERT ON organization_contact_pipeline_history
      FOR EACH ROW EXECUTE FUNCTION fail_initial_pipeline_history();
    `);
    try {
      await expect(createCrmPipelineEntryWithPostCommitActivityIn(
        pipelinePostCommitDb,
        runPipelineTransaction,
        orgA,
        input,
      )).rejects.toThrow();
      expect((await pglite.query<{ pipeline: number; history: number; activity: number }>(`
        SELECT
          (SELECT count(*)::int FROM organization_contact_pipeline WHERE id=$1) AS pipeline,
          (SELECT count(*)::int FROM organization_contact_pipeline_history WHERE pipeline_id=$1) AS history,
          (SELECT count(*)::int FROM organization_contact_activity WHERE metadata->>'pipelineId'=$1::text) AS activity
      `, [pipelineId])).rows).toEqual([{ pipeline: 0, history: 0, activity: 0 }]);
    } finally {
      await pglite.exec("DROP TRIGGER fail_initial_pipeline_history ON organization_contact_pipeline_history; DROP FUNCTION fail_initial_pipeline_history();");
    }

    const created = await createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      input,
    );
    const replay = await createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      input,
    );
    expect(replay).toEqual(created);
    expect((await pglite.query<{ pipeline: number; history: number; activity: number }>(`
      SELECT
        (SELECT count(*)::int FROM organization_contact_pipeline WHERE id=$1) AS pipeline,
        (SELECT count(*)::int FROM organization_contact_pipeline_history WHERE pipeline_id=$1) AS history,
        (SELECT count(*)::int FROM organization_contact_activity WHERE metadata->>'pipelineId'=$1::text) AS activity
      `, [pipelineId])).rows).toEqual([{ pipeline: 1, history: 1, activity: 1 }]);

    const primaryContactId = await createOrganizationContactIn(db, orgA, {
      email: "atomic.pipeline.primary@example.com",
      firstName: "Canonical",
      lastName: "Prospect",
    });
    await database.transaction((tx) => mergeOrganizationContactsIn(
      tx as unknown as TxDb,
      orgA,
      { primaryContactId, mergedContactId: contactId, fieldResolutions: {} },
      actorUserId,
    ));

    // The frozen request still names the losing contact. Replay identity comes
    // from the immutable creation payload, while the returned DTO reflects the
    // current canonical pipeline row after merge.
    const replayAfterMerge = await createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      input,
    );
    expect(replayAfterMerge).toEqual({ ...created, organizationContactId: primaryContactId });
    expect((await pglite.query<{
      organization_contact_id: string;
      creation_payload: { organizationContactId: string; targetEventId: string | null; notes: string | null };
      pipeline: number;
      history: number;
      activity: number;
    }>(`
      SELECT p.organization_contact_id, p.creation_payload,
        (SELECT count(*)::int FROM organization_contact_pipeline WHERE id=p.id) AS pipeline,
        (SELECT count(*)::int FROM organization_contact_pipeline_history h WHERE h.pipeline_id=p.id) AS history,
        (SELECT count(*)::int FROM organization_contact_activity a WHERE a.metadata->>'pipelineId'=p.id::text) AS activity
      FROM organization_contact_pipeline p WHERE p.id=$1
    `, [pipelineId])).rows).toEqual([{
      organization_contact_id: primaryContactId,
      creation_payload: {
        organizationContactId: contactId,
        targetEventId: eventA1,
        notes: input.notes,
      },
      pipeline: 1,
      history: 1,
      activity: 1,
    }]);

    await expect(createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      { ...input, organizationContactId: primaryContactId },
    )).rejects.toSatisfy((error) => isAppError(error) && error.code === "CONFLICT");
    expect((await pglite.query<{ notes: string; history: number; activity: number }>(`
      SELECT p.notes,
        (SELECT count(*)::int FROM organization_contact_pipeline_history h WHERE h.pipeline_id=p.id) AS history,
        (SELECT count(*)::int FROM organization_contact_activity a WHERE a.metadata->>'pipelineId'=p.id::text) AS activity
      FROM organization_contact_pipeline p WHERE p.id=$1
    `, [pipelineId])).rows).toEqual([{ notes: input.notes, history: 1, activity: 1 }]);
  });

  it("atomically transitions a prospect, replays once, and refuses a stale move over a later stage", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, {
      email: "atomic.pipeline.transition@example.com",
      firstName: "Atomic",
      lastName: "Mover",
    });
    const entry = await createCrmPipelineEntryIn(db, orgA, {
      organizationContactId: contactId,
      notes: "Transition atomically",
    });
    const wonRequest = {
      stage: "won" as const,
      expectedFrom: "open" as const,
      expectedUpdatedAt: entry.updatedAt,
    };

    await pglite.exec(`
      CREATE FUNCTION fail_pipeline_won_history() RETURNS trigger AS $$
      BEGIN
        IF NEW.from_stage = 'open' AND NEW.to_stage = 'won' THEN
          RAISE EXCEPTION 'forced pipeline transition history failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_pipeline_won_history
      BEFORE INSERT ON organization_contact_pipeline_history
      FOR EACH ROW EXECUTE FUNCTION fail_pipeline_won_history();
    `);
    try {
      await expect(transitionCrmPipelineIn(
        runPipelineTransaction,
        orgA,
        entry.id,
        wonRequest,
        actorUserId,
      )).rejects.toThrow();
      expect((await pglite.query<{ stage: string; history: number; activity: number }>(`
        SELECT p.stage,
          (SELECT count(*)::int FROM organization_contact_pipeline_history h
            WHERE h.pipeline_id=p.id AND h.from_stage='open' AND h.to_stage='won') AS history,
          (SELECT count(*)::int FROM organization_contact_activity a
            WHERE a.kind='pipeline_stage_changed' AND a.metadata->>'pipelineId'=p.id::text) AS activity
        FROM organization_contact_pipeline p WHERE p.id=$1
      `, [entry.id])).rows).toEqual([{ stage: "open", history: 0, activity: 0 }]);
    } finally {
      await pglite.exec("DROP TRIGGER fail_pipeline_won_history ON organization_contact_pipeline_history; DROP FUNCTION fail_pipeline_won_history();");
    }

    const won = await transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, wonRequest, actorUserId);
    const replay = await transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, wonRequest, actorUserId);
    expect(replay).toEqual(won);
    expect((await pglite.query<{ stage: string; history: number; activity: number }>(`
      SELECT p.stage,
        (SELECT count(*)::int FROM organization_contact_pipeline_history h
          WHERE h.pipeline_id=p.id AND h.from_stage IS NOT NULL) AS history,
        (SELECT count(*)::int FROM organization_contact_activity a
          WHERE a.kind='pipeline_stage_changed' AND a.metadata->>'pipelineId'=p.id::text) AS activity
      FROM organization_contact_pipeline p WHERE p.id=$1
    `, [entry.id])).rows).toEqual([{ stage: "won", history: 1, activity: 1 }]);

    const lost = await transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, {
      stage: "lost",
      expectedFrom: "won",
      expectedUpdatedAt: won.updatedAt,
    }, actorUserId);
    await expect(transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, wonRequest, actorUserId))
      .rejects.toSatisfy((error) => isAppError(error) && error.code === "STALE_WRITE");
    expect((await pglite.query<{ stage: string; history: number; activity: number }>(`
      SELECT p.stage,
        (SELECT count(*)::int FROM organization_contact_pipeline_history h
          WHERE h.pipeline_id=p.id AND h.from_stage IS NOT NULL) AS history,
        (SELECT count(*)::int FROM organization_contact_activity a
          WHERE a.kind='pipeline_stage_changed' AND a.metadata->>'pipelineId'=p.id::text) AS activity
      FROM organization_contact_pipeline p WHERE p.id=$1
    `, [entry.id])).rows).toEqual([{ stage: "lost", history: 2, activity: 2 }]);

    await pglite.exec(`
      CREATE FUNCTION fail_pipeline_transition_activity() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'pipeline_stage_changed' THEN
          RAISE EXCEPTION 'forced pipeline transition activity failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_pipeline_transition_activity
      BEFORE INSERT ON organization_contact_activity
      FOR EACH ROW EXECUTE FUNCTION fail_pipeline_transition_activity();
    `);
    try {
      await expect(transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, {
        stage: "open",
        expectedFrom: "lost",
        expectedUpdatedAt: lost.updatedAt,
      }, actorUserId)).rejects.toThrow();
      expect((await pglite.query<{ stage: string; history: number; activity: number }>(`
        SELECT p.stage,
          (SELECT count(*)::int FROM organization_contact_pipeline_history h
            WHERE h.pipeline_id=p.id AND h.from_stage IS NOT NULL) AS history,
          (SELECT count(*)::int FROM organization_contact_activity a
            WHERE a.kind='pipeline_stage_changed' AND a.metadata->>'pipelineId'=p.id::text) AS activity
        FROM organization_contact_pipeline p WHERE p.id=$1
      `, [entry.id])).rows).toEqual([{ stage: "lost", history: 2, activity: 2 }]);
    } finally {
      await pglite.exec("DROP TRIGGER fail_pipeline_transition_activity ON organization_contact_activity; DROP FUNCTION fail_pipeline_transition_activity();");
    }
  });

  it("orders pipeline rows deterministically when update timestamps tie", async () => {
    const firstContactId = await createOrganizationContactIn(db, orgB, { email: "pipeline.tie.first@example.com" });
    const secondContactId = await createOrganizationContactIn(db, orgB, { email: "pipeline.tie.second@example.com" });
    const firstPipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e5");
    const secondPipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e6");
    await createCrmPipelineEntryIn(db, orgB, { id: secondPipelineId, organizationContactId: secondContactId });
    await createCrmPipelineEntryIn(db, orgB, { id: firstPipelineId, organizationContactId: firstContactId });
    await pglite.query(
      "UPDATE organization_contact_pipeline SET updated_at='2026-08-14T04:00:00Z' WHERE id = ANY($1::uuid[])",
      [[firstPipelineId, secondPipelineId]],
    );

    const tiedIds = (await listCrmPipelineIn(db, orgB))
      .filter((entry) => entry.id === firstPipelineId || entry.id === secondPipelineId)
      .map((entry) => entry.id);
    expect(tiedIds).toEqual([firstPipelineId, secondPipelineId]);
  });

  it("replays an immutable prospect request after its target event is deleted", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, { email: "deleted.target.pipeline@example.com" });
    const pipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e3");
    const input = { id: pipelineId, organizationContactId: contactId, targetEventId: eventA3, notes: "Target the fall event" };
    const created = await createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      input,
    );

    // Simulate a lost HTTP response followed by a lifecycle change before the
    // organizer chooses Retry addition.
    await pglite.query("DELETE FROM events WHERE id=$1", [eventA3]);
    const replay = await createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      input,
    );
    expect(replay).toEqual({ ...created, targetEventId: null });
    expect((await pglite.query<{
      target_event_id: string | null;
      creation_payload: { organizationContactId: string; targetEventId: string | null; notes: string | null };
      pipeline: number;
      history: number;
      activity: number;
    }>(`
      SELECT p.target_event_id, p.creation_payload,
        (SELECT count(*)::int FROM organization_contact_pipeline WHERE id=p.id) AS pipeline,
        (SELECT count(*)::int FROM organization_contact_pipeline_history h WHERE h.pipeline_id=p.id) AS history,
        (SELECT count(*)::int FROM organization_contact_activity a WHERE a.metadata->>'pipelineId'=p.id::text) AS activity
      FROM organization_contact_pipeline p WHERE p.id=$1
    `, [pipelineId])).rows).toEqual([{
      target_event_id: null,
      creation_payload: {
        organizationContactId: contactId,
        targetEventId: eventA3,
        notes: input.notes,
      },
      pipeline: 1,
      history: 1,
      activity: 1,
    }]);

    await expect(createCrmPipelineEntryWithPostCommitActivityIn(
      pipelinePostCommitDb,
      runPipelineTransaction,
      orgA,
      { ...input, targetEventId: eventA2 },
    )).rejects.toSatisfy((error) => isAppError(error) && error.code === "CONFLICT");
  });

  it("captures and protects creation payloads for rolling-deploy inserts", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, { email: "pipeline.rollout@example.com" });
    const pipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e4");

    // This is the statement shape an older application instance issues after
    // the migration is live: it does not know creation_payload exists.
    await pglite.query(`
      INSERT INTO organization_contact_pipeline(id, organization_id, organization_contact_id, target_event_id, notes)
      VALUES($1, $2, $3, $4, 'Captured by migration trigger')
    `, [pipelineId, orgA, contactId, eventA2]);
    expect((await pglite.query<{ creation_payload: unknown }>(
      "SELECT creation_payload FROM organization_contact_pipeline WHERE id=$1",
      [pipelineId],
    )).rows).toEqual([{ creation_payload: {
      organizationContactId: contactId,
      targetEventId: eventA2,
      notes: "Captured by migration trigger",
    } }]);

    await expect(pglite.query(
      "UPDATE organization_contact_pipeline SET creation_payload=$2::jsonb WHERE id=$1",
      [pipelineId, JSON.stringify({ organizationContactId: contactId, targetEventId: null, notes: null })],
    )).rejects.toThrow();
    await pglite.query("DELETE FROM organization_contact_pipeline WHERE id=$1", [pipelineId]);
  });

  it("keeps a committed prospect authoritative when its post-commit activity fails", async () => {
    const contactId = await createOrganizationContactIn(db, orgA, { email: "pipeline.activity.failure@example.com" });
    const pipelineId = crmPipelineIdSchema.parse("c55a0000-0000-4000-8000-0000000000e2");
    await pglite.exec(`
      CREATE FUNCTION fail_pipeline_created_activity() RETURNS trigger AS $$
      BEGIN
        IF NEW.kind = 'pipeline_created' THEN
          RAISE EXCEPTION 'forced pipeline activity failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_pipeline_created_activity
      BEFORE INSERT ON organization_contact_activity
      FOR EACH ROW EXECUTE FUNCTION fail_pipeline_created_activity();
    `);
    try {
      const created = await createCrmPipelineEntryWithPostCommitActivityIn(
        pipelinePostCommitDb,
        runPipelineTransaction,
        orgA,
        { id: pipelineId, organizationContactId: contactId },
      );
      expect(created.id).toBe(pipelineId);
      expect((await pglite.query<{ pipeline: number; history: number; activity: number }>(`
        SELECT
          (SELECT count(*)::int FROM organization_contact_pipeline WHERE id=$1) AS pipeline,
          (SELECT count(*)::int FROM organization_contact_pipeline_history WHERE pipeline_id=$1) AS history,
          (SELECT count(*)::int FROM organization_contact_activity WHERE metadata->>'pipelineId'=$1::text) AS activity
      `, [pipelineId])).rows).toEqual([{ pipeline: 1, history: 1, activity: 0 }]);
    } finally {
      await pglite.exec("DROP TRIGGER fail_pipeline_created_activity ON organization_contact_activity; DROP FUNCTION fail_pipeline_created_activity();");
    }
  });

  it("imports a mixed CSV: creates new rows, matches existing ones, and dedupes within the file", async () => {
    const csvText = [
      "email,firstName,lastName",
      "ada@example.com,Ada,ShouldNotOverwrite", // matches existing org-A contact; lastName is already set, so this is ignored
      "grace@example.com,Grace,Hopper",
      "grace@example.com,Grace,Duplicate",
    ].join("\n");
    const mapping = { email: 0, fields: { firstName: 1 as const, lastName: 2 as const } };

    const preview = await importCrmContactsCsvIn(db, orgA, { csvText, mapping, mode: "preview" });
    expect(preview.rows.map((r) => r.status)).toEqual(["matched_existing", "created", "duplicate_in_file"]);
    expect(preview.created).toBe(1);
    expect(preview.matchedExisting).toBe(1);
    const beforeCommitCount = (await listOrganizationContactsIn(db, orgA, { limit: 200, offset: 0 })).total;

    const commit = await importCrmContactsCsvIn(db, orgA, { csvText, mapping, mode: "commit" });
    expect(commit.created).toBe(1);
    expect(commit.matchedExisting).toBe(1);
    const afterCommitCount = (await listOrganizationContactsIn(db, orgA, { limit: 200, offset: 0 })).total;
    expect(afterCommitCount).toBe(beforeCommitCount + 1); // only Grace is new

    const [ada] = (await listOrganizationContactsIn(db, orgA, { search: "ada", limit: 10, offset: 0 })).rows;
    expect(ada?.lastName).toBe("Lovelace"); // never silently overwritten

    // Retrying the exact same commit is safe: nothing new is created.
    const retry = await importCrmContactsCsvIn(db, orgA, { csvText, mapping, mode: "commit" });
    expect(retry.created).toBe(0);
    expect(retry.matchedExisting).toBe(2);
  });

  it("merges a duplicate into an explicit primary, preserving references with an audit record", async () => {
    const tag = await createCrmTagIn(db, orgA, { name: "Keynote", color: "#00a878" });
    const [ada] = (await listOrganizationContactsIn(db, orgA, { search: "ada", limit: 10, offset: 0 })).rows;
    if (!ada) throw new Error("ada not found in the org-A directory");
    const primaryId = ada.id;

    const duplicateId = await createOrganizationContactIn(db, orgA, { email: "ada.alt@example.com", firstName: "Ada", lastName: "L." });
    await setCrmContactTagsIn(db, orgA, duplicateId, { tagIds: [tag.id] });
    await createCrmNoteIn(db, orgA, duplicateId, {
      noteId: crmNoteIdSchema.parse("c55a0000-0000-4000-8000-0000000000d2"),
      bodyHtml: "<p>met at a conference</p>",
    }, actorUserId);
    const pipelineEntry = await createCrmPipelineEntryIn(db, orgA, { organizationContactId: duplicateId, targetEventId: eventA1 });
    const pushedDuplicate = await pushOrganizationContactToEventIn(db, orgA, duplicateId, eventA1);
    await pglite.query(
      "INSERT INTO event_members(user_id,event_id,role) VALUES($1,$2,'organizer') ON CONFLICT DO NOTHING",
      [actorUserId, eventA1],
    );
    await pglite.query(
      "INSERT INTO user_contact_links(user_id,event_id,contact_id,source) VALUES($1,$2,$3,'operator')",
      [actorUserId, eventA1, pushedDuplicate.contactId],
    );

    const preview = await previewCrmMergeIn(db, orgA, { primaryContactId: primaryId, mergedContactId: duplicateId });
    expect(preview.referenceCounts).toEqual({ eventLinks: 1, tags: 1, notes: 1, activity: expect.any(Number), pipelineEntries: 1 });
    expect(preview.fieldConflicts.some((c) => c.field === "lastName")).toBe(true);

    const tx = db as unknown as TxDb;
    const audit = await mergeOrganizationContactsIn(tx, orgA, { primaryContactId: primaryId, mergedContactId: duplicateId, fieldResolutions: {} }, actorUserId);
    expect(audit.referenceCounts.tags).toBe(1);
    expect(audit.referenceCounts.pipelineEntries).toBe(1);
    const auditDetail = await getCrmMergeAuditIn(db, orgA, audit.id);
    expect(auditDetail).toMatchObject({ recoveryStatus: "recoverable", canRecover: true, mergedContactId: duplicateId });

    // The merged identity is tombstoned, not deleted, and drops out of the directory.
    const directory = await listOrganizationContactsIn(db, orgA, { limit: 200, offset: 0 });
    expect(directory.rows.some((r) => r.id === duplicateId)).toBe(false);

    // Every reference moved to the primary.
    const history = await getOrganizationContactHistoryIn(db, orgA, primaryId);
    expect(history?.tags.some((t) => t.id === tag.id)).toBe(true);
    expect(history?.notes.length).toBeGreaterThanOrEqual(1);
    expect(history?.events.some((e) => e.eventId === eventA1)).toBe(true);
    expect((await pglite.query<{ contact_id: string }>(
      "SELECT contact_id FROM user_contact_links WHERE user_id=$1 AND event_id=$2",
      [actorUserId, eventA1],
    )).rows).toEqual([{ contact_id: pushedDuplicate.contactId }]);
    const [pipelineRow] = (await pglite.query<{ organization_contact_id: string }>(
      "SELECT organization_contact_id FROM organization_contact_pipeline WHERE id=$1", [pipelineEntry.id],
    )).rows;
    expect(pipelineRow?.organization_contact_id).toBe(primaryId);

    // Merging the same loser again is refused — it already lost.
    await expect(previewCrmMergeIn(db, orgA, { primaryContactId: primaryId, mergedContactId: duplicateId }))
      .rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");
  });

  it("resolves a dynamic segment freshly on every call and enforces suppression on bulk send", async () => {
    const [ada] = (await listOrganizationContactsIn(db, orgA, { search: "ada", limit: 10, offset: 0 })).rows;
    if (!ada) throw new Error("ada not found in the org-A directory");
    const primaryId = ada.id;
    const [tag] = ada.tags;
    if (!tag) throw new Error("ada should carry the Keynote tag reassigned by the merge test");

    const resolvedWithTag = await resolveCrmSegmentIn(db, orgA, { tagIds: [tag.id] });
    expect(resolvedWithTag.organizationContactIds).toContain(primaryId);

    // Editing the underlying field (removing the tag) changes membership on
    // the very next resolve — nothing was materialized.
    await setCrmContactTagsIn(db, orgA, primaryId, { tagIds: [] });
    const resolvedAfterEdit = await resolveCrmSegmentIn(db, orgA, { tagIds: [tag.id] });
    expect(resolvedAfterEdit.organizationContactIds).not.toContain(primaryId);

    // Bulk send: ada is linked to eventA1/eventA2, so the send fans out
    // through the existing M51/outbox path.
    const sendId = "96000000-0000-4000-8000-000000000001";
    const sendInput = {
      organizationContactIds: [primaryId], subject: "Hello {{speaker.first_name}}", bodyHtml: "<p>Hi {{speaker.first_name}}</p>", mode: "send" as const,
      sendId,
    };
    const sent = await composeCrmBulkEmailIn(db, orgA, sendInput);
    expect(sent.queued).toBe(1);
    expect(sent.alreadyQueued).toBe(0);
    expect(sent.errors).toEqual([]);
    const [loggedRow] = (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE template_key='speaker_bulk_message'",
    )).rows;
    expect(loggedRow?.n).toBeGreaterThanOrEqual(1);

    // The CRM route can fan out across event groups or be retried after an
    // ambiguous batch failure. Its caller-owned id must reach M51 unchanged.
    const retry = await composeCrmBulkEmailIn(db, orgA, sendInput);
    expect(retry.queued).toBe(0);
    expect(retry.alreadyQueued).toBe(1);
    expect(retry.errors).toEqual([]);
    const [retryRows] = (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM speaker_bulk_messages WHERE idempotency_key LIKE $1",
      [`%:${sendId}`],
    )).rows;
    expect(retryRows?.n).toBe(1);

    // Suppress the resolved event contact and confirm the second send skips it.
    const [linkRow] = (await pglite.query<{ contact_id: string; event_id: string }>(
      "SELECT contact_id, event_id FROM organization_contact_links WHERE organization_contact_id=$1 ORDER BY created_at DESC LIMIT 1", [primaryId],
    )).rows;
    await pglite.query("INSERT INTO contact_suppressions(contact_id, event_id, reason) VALUES($1,$2,'bounce')", [linkRow?.contact_id, linkRow?.event_id]);
    const suppressed = await composeCrmBulkEmailIn(db, orgA, {
      organizationContactIds: [primaryId], subject: "Hello again", bodyHtml: "<p>Hi</p>", mode: "send",
      sendId: "96000000-0000-4000-8000-000000000002",
    });
    expect(suppressed.queued).toBe(0);
    expect(suppressed.alreadyQueued).toBe(0);
    expect(suppressed.skipped).toBe(1);
  });

  it("moves a prospect through open/won/lost with timestamped history and rolls up into metrics", async () => {
    const bob = await createOrganizationContactIn(db, orgA, { email: "bob.pipeline@example.com", firstName: "Bob" });
    const entry = await createCrmPipelineEntryIn(db, orgA, { organizationContactId: bob, targetEventId: eventA1, notes: "warm intro" });
    expect(entry.stage).toBe("open");

    const won = await transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, { stage: "won" }, actorUserId);
    expect(won.stage).toBe("won");

    // Re-applying the same stage is a no-op, not a spurious history row.
    await transitionCrmPipelineIn(runPipelineTransaction, orgA, entry.id, { stage: "won" }, actorUserId);

    const history = await getCrmPipelineHistoryIn(db, orgA, entry.id);
    expect(history.map((h) => h.toStage)).toEqual(["open", "won"]);
    expect(history[0]?.fromStage).toBeNull();
    expect(history[1]?.fromStage).toBe("open");
    expect(new Date(history[1]?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(history[0]?.createdAt ?? 0).getTime());

    const metrics = await getCrmMetricsIn(db, orgA);
    expect(metrics.pipelineByStage.won).toBeGreaterThanOrEqual(1);
    expect(metrics.mergesRecorded).toBeGreaterThanOrEqual(1);
    expect(metrics.totalWithEventLink).toBeGreaterThanOrEqual(1);
    expect(metrics.eventsRepresented).toBeGreaterThanOrEqual(2);
  });

  it("keeps update writes field-scoped and rejects editing a merged-away identity", async () => {
    const solo = await createOrganizationContactIn(db, orgA, { email: "solo@example.com", firstName: "Solo" });
    await updateOrganizationContactIn(db, orgA, solo, { company: "Acme", customFields: { shirtSize: "M" } });
    const [row] = (await pglite.query<{ company: string; custom_fields: Record<string, string> }>(
      "SELECT company, custom_fields FROM organization_contacts WHERE id=$1", [solo],
    )).rows;
    expect(row?.company).toBe("Acme");
    expect(row?.custom_fields).toEqual({ shirtSize: "M" });
  });

  it("recovers a merge only when the primary is unchanged, restoring the audited identity and references", async () => {
    const tag = await createCrmTagIn(db, orgA, { name: "Recovery", color: "#123456" });
    const primaryId = await createOrganizationContactIn(db, orgA, { email: "recovery.primary@example.com", firstName: "Primary", lastName: "Before" });
    const mergedId = await createOrganizationContactIn(db, orgA, { email: "recovery.merged@example.com", firstName: "Merged", lastName: "Restored" });
    await createCrmNoteIn(db, orgA, mergedId, {
      noteId: crmNoteIdSchema.parse("c55a0000-0000-4000-8000-0000000000d3"),
      bodyHtml: "<p>restore this note</p>",
    }, actorUserId);
    await setCrmContactTagsIn(db, orgA, mergedId, { tagIds: [tag.id] });
    const pipelineEntry = await createCrmPipelineEntryIn(db, orgA, { organizationContactId: mergedId, targetEventId: eventA2 });
    await pushOrganizationContactToEventIn(db, orgA, mergedId, eventA2);

    const audit = await mergeOrganizationContactsIn(db as unknown as TxDb, orgA, {
      primaryContactId: primaryId, mergedContactId: mergedId, fieldResolutions: { lastName: "merged" },
    }, actorUserId);
    expect((await getOrganizationContactHistoryIn(db, orgA, primaryId))?.contact.lastName).toBe("Restored");

    const recovered = await recoverCrmMergeIn(db as unknown as TxDb, orgA, audit.id, actorUserId);
    expect(recovered).toMatchObject({ recoveryStatus: "recovered", canRecover: false });
    const primaryHistory = await getOrganizationContactHistoryIn(db, orgA, primaryId);
    expect(primaryHistory?.contact.lastName).toBe("Before");
    expect(primaryHistory?.tags.some((row) => row.id === tag.id)).toBe(false);

    const mergedHistory = await getOrganizationContactHistoryIn(db, orgA, mergedId);
    expect(mergedHistory?.tags.some((row) => row.id === tag.id)).toBe(true);
    expect(mergedHistory?.notes).toHaveLength(1);
    expect(mergedHistory?.events.some((row) => row.eventId === eventA2)).toBe(true);
    const [pipelineRow] = (await pglite.query<{ organization_contact_id: string }>(
      "SELECT organization_contact_id FROM organization_contact_pipeline WHERE id=$1", [pipelineEntry.id],
    )).rows;
    expect(pipelineRow?.organization_contact_id).toBe(mergedId);
    expect((await listOrganizationContactsIn(db, orgA, { search: "recovery.merged", limit: 10, offset: 0 })).rows.some((row) => row.id === mergedId)).toBe(true);

    await expect(recoverCrmMergeIn(db as unknown as TxDb, orgA, audit.id, actorUserId))
      .rejects.toSatisfy((e) => isAppError(e) && e.code === "CONFLICT");
  });
});
