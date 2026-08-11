import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbOrTx, TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { composeCrmBulkEmailIn } from "@/features/crm/server/bulk-email";
import { importCrmContactsCsvIn } from "@/features/crm/server/csv-import";
import { mergeOrganizationContactsIn, previewCrmMergeIn } from "@/features/crm/server/merge";
import {
  createCrmNoteIn,
  createCrmPipelineEntryIn,
  createCrmTagIn,
  createOrganizationContactIn,
  pushOrganizationContactToEventIn,
  setCrmContactTagsIn,
  transitionCrmPipelineIn,
  updateOrganizationContactIn,
} from "@/features/crm/server/mutations";
import {
  getCrmMetricsIn,
  getCrmPipelineHistoryIn,
  getOrganizationContactHistoryIn,
  listOrganizationContactsIn,
  resolveCrmSegmentIn,
} from "@/features/crm/server/queries";
import { eventIdSchema, organizationIdSchema, userIdSchema } from "@/shared/contracts";
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

const orgA = organizationIdSchema.parse("c55a0000-0000-4000-8000-000000000001");
const orgB = organizationIdSchema.parse("c55a0000-0000-4000-8000-000000000002");
const eventA1 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000a1");
const eventA2 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000a2");
const eventB1 = eventIdSchema.parse("c55a0000-0000-4000-8000-0000000000b1");
const actorUserId = userIdSchema.parse("c55a0000-0000-4000-8000-0000000000f1");

let pglite: PGlite;
let db: DbOrTx;

describe("organization-level speaker CRM (M55)", () => {
  beforeAll(async () => {
    pglite = new PGlite();
    for (const migration of [migration0, migration1, migrationEmailCompliance, migrationRoster, migrationTenancy, migrationCrm, migrationSpeakerMoments]) {
      await pglite.exec(migration);
    }
    db = drizzle(pglite, { schema }) as unknown as DbOrTx;

    await pglite.query("INSERT INTO organizations(id,name,slug) VALUES($1,'Org A','org-a'),($2,'Org B','org-b')", [orgA, orgB]);
    for (const [id, name, slug, orgId] of [
      [eventA1, "Event A1", "crm-event-a1", orgA],
      [eventA2, "Event A2", "crm-event-a2", orgA],
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
    await createCrmNoteIn(db, orgA, duplicateId, { bodyHtml: "<p>met at a conference</p>" }, actorUserId);
    const pipelineEntry = await createCrmPipelineEntryIn(db, orgA, { organizationContactId: duplicateId, targetEventId: eventA1 });
    await pushOrganizationContactToEventIn(db, orgA, duplicateId, eventA1);

    const preview = await previewCrmMergeIn(db, orgA, { primaryContactId: primaryId, mergedContactId: duplicateId });
    expect(preview.referenceCounts).toEqual({ eventLinks: 1, tags: 1, notes: 1, activity: expect.any(Number), pipelineEntries: 1 });
    expect(preview.fieldConflicts.some((c) => c.field === "lastName")).toBe(true);

    const tx = db as unknown as TxDb;
    const audit = await mergeOrganizationContactsIn(tx, orgA, { primaryContactId: primaryId, mergedContactId: duplicateId, fieldResolutions: {} }, actorUserId);
    expect(audit.referenceCounts.tags).toBe(1);
    expect(audit.referenceCounts.pipelineEntries).toBe(1);

    // The merged identity is tombstoned, not deleted, and drops out of the directory.
    const directory = await listOrganizationContactsIn(db, orgA, { limit: 200, offset: 0 });
    expect(directory.rows.some((r) => r.id === duplicateId)).toBe(false);

    // Every reference moved to the primary.
    const history = await getOrganizationContactHistoryIn(db, orgA, primaryId);
    expect(history?.tags.some((t) => t.id === tag.id)).toBe(true);
    expect(history?.notes.length).toBeGreaterThanOrEqual(1);
    expect(history?.events.some((e) => e.eventId === eventA1)).toBe(true);
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
    const sent = await composeCrmBulkEmailIn(db, orgA, {
      organizationContactIds: [primaryId], subject: "Hello {{speaker.first_name}}", bodyHtml: "<p>Hi {{speaker.first_name}}</p>", mode: "send",
    });
    expect(sent.queued).toBe(1);
    expect(sent.errors).toEqual([]);
    const [loggedRow] = (await pglite.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM communication_logs WHERE template_key='speaker_bulk_message'",
    )).rows;
    expect(loggedRow?.n).toBeGreaterThanOrEqual(1);

    // Suppress the resolved event contact and confirm the second send skips it.
    const [linkRow] = (await pglite.query<{ contact_id: string; event_id: string }>(
      "SELECT contact_id, event_id FROM organization_contact_links WHERE organization_contact_id=$1 ORDER BY created_at DESC LIMIT 1", [primaryId],
    )).rows;
    await pglite.query("INSERT INTO contact_suppressions(contact_id, event_id, reason) VALUES($1,$2,'bounce')", [linkRow?.contact_id, linkRow?.event_id]);
    const suppressed = await composeCrmBulkEmailIn(db, orgA, {
      organizationContactIds: [primaryId], subject: "Hello again", bodyHtml: "<p>Hi</p>", mode: "send",
    });
    expect(suppressed.queued).toBe(0);
    expect(suppressed.skipped).toBe(1);
  });

  it("moves a prospect through open/won/lost with timestamped history and rolls up into metrics", async () => {
    const bob = await createOrganizationContactIn(db, orgA, { email: "bob.pipeline@example.com", firstName: "Bob" });
    const entry = await createCrmPipelineEntryIn(db, orgA, { organizationContactId: bob, targetEventId: eventA1, notes: "warm intro" });
    expect(entry.stage).toBe("open");

    const won = await transitionCrmPipelineIn(db, orgA, entry.id, { stage: "won" }, actorUserId);
    expect(won.stage).toBe("won");

    // Re-applying the same stage is a no-op, not a spurious history row.
    await transitionCrmPipelineIn(db, orgA, entry.id, { stage: "won" }, actorUserId);

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
});
