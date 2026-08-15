import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { commLogIdSchema, contactIdSchema, eventIdSchema, taskIdSchema, type CommLogId } from "@/shared/contracts";
import { DEFAULT_TEMPLATES, EVENT_EDITABLE_TEMPLATE_KEYS } from "./templates";
import { isAppError } from "@/shared/lib/errors";
import {
  getLogDetailIn,
  listOpenAssignmentsForContactIn,
  listReminderRulesIn,
  listTemplatesIn,
  retryFailedCommunicationsIn,
  saveReminderRulesIn,
  saveTemplateIn,
} from "./admin-mutations";
import { scanRemindersIn } from "./reminders";
import { seedDefaultTemplates } from "./templates";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");
// M50 is additive on top of the base schema; applying it keeps this fixture
// aligned with the columns the repository modules now read.
const migrationReviewOps = readFileSync(new URL("../../../../drizzle/0004_review_operations.sql", import.meta.url), "utf8");
// M51 appended `speaker_bulk_message` to `template_key`; `seedDefaultTemplates`
// needs every migration that ever appended a label, in order.
const migrationRoster = readFileSync(new URL("../../../../drizzle/0008_speaker_roster_operations.sql", import.meta.url), "utf8");
// M42 adds the admin_password_reset / admin_email_verification template keys,
// which `seedDefaultTemplates` inserts for every event.
const migrationProductAuth = readFileSync(new URL("../../../../drizzle/0009_product_auth.sql", import.meta.url), "utf8");
// M43's `organizations` table, which M44's `organization_invitations`/
// `organization_audit_log` FK against; M44 appended `organization_invited` to
// `template_key`, which `seedDefaultTemplates` also inserts for every event.
const migrationTenancy = readFileSync(new URL("../../../../drizzle/0010_organization_tenancy.sql", import.meta.url), "utf8");
const migrationUserManagement = readFileSync(new URL("../../../../drizzle/0011_user_management.sql", import.meta.url), "utf8");

const eventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const speakerId = contactIdSchema.parse("e0000000-0000-4000-8000-000000000010");
const taskId = taskIdSchema.parse("e0000000-0000-4000-8000-000000000040");
const secondTaskId = taskIdSchema.parse("e0000000-0000-4000-8000-000000000041");

async function expectAppError(work: Promise<unknown>, code: string): Promise<void> {
  try {
    await work;
    throw new Error(`expected AppError(${code}) but the call succeeded`);
  } catch (error) {
    if (!isAppError(error)) throw error;
    expect(error.code).toBe(code);
  }
}

describe("comms admin mutations", () => {
  let pglite: PGlite;
  let tx: TxDb;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(migration0);
    await pglite.exec(migration1);
    await pglite.exec(migrationReviewOps);
    await pglite.exec(migrationRoster);
    await pglite.exec(migrationProductAuth);
    await pglite.exec(migrationTenancy);
    await pglite.exec(migrationUserManagement);
    tx = drizzle(pglite, { schema }) as unknown as TxDb;
  });

  beforeEach(async () => {
    await pglite.query("DELETE FROM events");
    await pglite.query(
      "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'AI Engineer','ai-engineer','Fort Mason','America/Los_Angeles','2026-09-15T16:00:00Z','2026-09-17T01:00:00Z')",
      [eventId],
    );
    await seedDefaultTemplates(tx, eventId);
    await pglite.query("INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'speaker@example.com','Nadia','Lee')", [speakerId, eventId]);
  });

  describe("listTemplates / saveTemplate", () => {
    // M50/M51 appended keys after this test was first written; asserted
    // against the contract's own enum order (never a hand-copied literal
    // list, which is exactly what went stale before) — see contracts.test.ts
    // for the length guard.
    it("returns every template key in enum order, never DB order", async () => {
      const rows = await listTemplatesIn(tx, eventId);
      const keys = rows.map((row) => row.key);
      expect(keys).toEqual(EVENT_EDITABLE_TEMPLATE_KEYS);
      expect(keys).not.toContain("admin_password_reset");
      expect(keys).not.toContain("admin_email_verification");
      // M44 team invitations render fixed copy from the admin outbox, so a
      // rail row for them would be a control that changes nothing.
      expect(keys).not.toContain("organization_invited");
    });

    // An event seeded before a template key existed had no row for it, and the
    // whole Communications page went down rather than showing the default.
    it("backfills a missing template with its built-in default instead of failing the page", async () => {
      await pglite.query("DELETE FROM email_templates WHERE event_id=$1 AND key='submission_received'", [eventId]);
      await pglite.query("UPDATE email_templates SET subject='Edited by the organizer' WHERE event_id=$1 AND key='task_reminder'", [eventId]);

      const rows = await listTemplatesIn(tx, eventId);

      expect(rows.map((row) => row.key)).toEqual(EVENT_EDITABLE_TEMPLATE_KEYS);
      expect(rows.find((row) => row.key === "submission_received")?.subject).toBe(DEFAULT_TEMPLATES.submission_received.subject);
      // The backfill only fills gaps — edited copy on the keys that do exist
      // must survive it untouched.
      expect(rows.find((row) => row.key === "task_reminder")?.subject).toBe("Edited by the organizer");
      // A backfilled row is real, so the optimistic-concurrency save path has
      // something to compare against.
      const restored = rows.find((row) => row.key === "submission_received");
      if (!restored) throw new Error("expected the backfilled row");
      const saved = await saveTemplateIn(tx, eventId, "submission_received", {
        subject: "We got it",
        bodyHtml: "<p>Thanks</p>",
        enabled: true,
        expectedUpdatedAt: restored.updatedAt,
      });
      expect(saved.subject).toBe("We got it");
    });

    // Removing a rung is a deliberate act; reading the templates must not undo it.
    it("leaves the reminder ladder alone while backfilling templates", async () => {
      await pglite.query("DELETE FROM email_templates WHERE event_id=$1 AND key='portal_login'", [eventId]);
      await pglite.query("DELETE FROM reminder_rules WHERE event_id=$1", [eventId]);

      await listTemplatesIn(tx, eventId);

      expect(await listReminderRulesIn(tx, eventId)).toEqual([]);
    });

    it("rejects attempts to edit a platform authentication template", async () => {
      await expectAppError(
        saveTemplateIn(tx, eventId, "admin_password_reset", {
          subject: "Reset your password",
          bodyHtml: "<p>Reset</p>",
          enabled: true,
          expectedUpdatedAt: new Date().toISOString(),
        }),
        "VALIDATION",
      );
    });

    it("rejects attempts to edit the team invitation template", async () => {
      await expectAppError(
        saveTemplateIn(tx, eventId, "organization_invited", {
          subject: "Join us",
          bodyHtml: "<p>Join</p>",
          enabled: false,
          expectedUpdatedAt: new Date().toISOString(),
        }),
        "VALIDATION",
      );
    });

    it("rejects an unknown template variable with the offending token named", async () => {
      const existing = (await listTemplatesIn(tx, eventId)).find((row) => row.key === "task_reminder");
      if (!existing) throw new Error("seed missing task_reminder");
      await expectAppError(
        saveTemplateIn(tx, eventId, "task_reminder", {
          subject: "Hi {{speaker.nickname}}",
          bodyHtml: "<p>{{task.name}}</p>",
          enabled: true,
          expectedUpdatedAt: existing.updatedAt,
        }),
        "TEMPLATE_VAR_MISSING",
      );
    });

    it("sanitizes a <script> payload on save", async () => {
      const existing = (await listTemplatesIn(tx, eventId)).find((row) => row.key === "submission_accepted");
      if (!existing) throw new Error("seed missing submission_accepted");
      const saved = await saveTemplateIn(tx, eventId, "submission_accepted", {
        subject: "Congratulations {{speaker.first_name}}",
        bodyHtml: '<script>alert(1)</script><p>hi {{submission.title}}</p>',
        enabled: true,
        expectedUpdatedAt: existing.updatedAt,
      });
      expect(saved.bodyHtml).not.toContain("<script>");
      expect(saved.bodyHtml).toContain("<p>hi");
      const result = await pglite.query<{ body_html: string }>("SELECT body_html FROM email_templates WHERE event_id=$1 AND key='submission_accepted'", [eventId]);
      expect(result.rows[0]?.body_html).not.toContain("<script>");
    });

    it("preserves supported merge-token links when a template is saved", async () => {
      const existing = (await listTemplatesIn(tx, eventId)).find((row) => row.key === "task_reminder");
      if (!existing) throw new Error("seed missing task_reminder");
      const saved = await saveTemplateIn(tx, eventId, "task_reminder", {
        subject: "Reminder: {{task.name}}",
        bodyHtml: '<p><a href="{{portal.magic_link}}">Open portal</a> or <a href="{{unsubscribe.url}}">unsubscribe</a>.</p>',
        enabled: true,
        expectedUpdatedAt: existing.updatedAt,
      });

      expect(saved.bodyHtml).toContain('href="{{portal.magic_link}}"');
      expect(saved.bodyHtml).toContain('href="{{unsubscribe.url}}"');
    });

    it("rejects a save against a stale expectedUpdatedAt with 409 STALE_WRITE", async () => {
      await expectAppError(
        saveTemplateIn(tx, eventId, "task_assigned", {
          subject: "New task",
          bodyHtml: "<p>{{task.name}}</p>",
          enabled: true,
          expectedUpdatedAt: new Date(0).toISOString(),
        }),
        "STALE_WRITE",
      );
    });

    it("updates enabled/subject/body and advances updatedAt on a clean save", async () => {
      const before = (await listTemplatesIn(tx, eventId)).find((row) => row.key === "schedule_changed");
      if (!before) throw new Error("seed missing schedule_changed");
      const saved = await saveTemplateIn(tx, eventId, "schedule_changed", {
        subject: "Updated: {{session.title}}",
        bodyHtml: "<p>New time: {{session.start_time_local}}</p>",
        enabled: false,
        expectedUpdatedAt: before.updatedAt,
      });
      expect(saved.enabled).toBe(false);
      expect(saved.subject).toBe("Updated: {{session.title}}");
      expect(new Date(saved.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(before.updatedAt).getTime());
    });
  });

  describe("listReminderRules / saveReminderRules", () => {
    it("seeds the 3-rung ladder", async () => {
      const rules = await listReminderRulesIn(tx, eventId);
      expect(rules.map((rule) => [rule.offsetDays, rule.enabled])).toEqual([[-7, true], [-1, true], [1, true]]);
    });

    it("disabling a rung stops it from firing on the next reminder scan", async () => {
      await pglite.query(
        "INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Main CFP','open')",
        ["e0000000-0000-4000-8000-000000000020", eventId],
      );
      await pglite.query(
        "INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id,decided_at) VALUES($1,$2,$3,1,9,'accepted','Agents in prod','cfp',$4,'2026-01-01T00:00:00Z')",
        ["e0000000-0000-4000-8000-000000000030", eventId, "e0000000-0000-4000-8000-000000000020", speakerId],
      );
      await pglite.query(
        "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
        [eventId, "e0000000-0000-4000-8000-000000000030", speakerId],
      );
      await pglite.query(
        "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,created_at) VALUES($1,$2,'Upload slides','contact','manual',now() - interval '10 days',now() - interval '30 days')",
        [taskId, eventId],
      );

      const rules = await listReminderRulesIn(tx, eventId);
      await saveReminderRulesIn(tx, eventId, rules.map((rule) => rule.offsetDays === -7 ? { offsetDays: rule.offsetDays, enabled: false } : { offsetDays: rule.offsetDays, enabled: rule.enabled }));
      expect((await listReminderRulesIn(tx, eventId)).find((rule) => rule.offsetDays === -7)?.enabled).toBe(false);

      await scanRemindersIn(tx);
      const reminders = await pglite.query<{ error: string | null }>(
        "SELECT error FROM communication_logs WHERE template_key='task_reminder'",
      );
      expect(reminders.rows.some((row) => row.error?.includes("offset -7"))).toBe(false);
    });

    it("replaces the set: an offset dropped from the payload is deleted", async () => {
      await saveReminderRulesIn(tx, eventId, [{ offsetDays: -7, enabled: true }, { offsetDays: 2, enabled: true }]);
      const rules = await listReminderRulesIn(tx, eventId);
      expect(rules.map((rule) => rule.offsetDays).sort((a, b) => a - b)).toEqual([-7, 2]);
    });

    it("keeps the complete previous ladder when replacement fails, then retries cleanly", async () => {
      const values = async () => (await listReminderRulesIn(tx, eventId))
        .map((rule) => [rule.offsetDays, rule.enabled]);
      expect(await values()).toEqual([[-7, true], [-1, true], [1, true]]);

      await pglite.exec(`
        CREATE FUNCTION fail_reminder_rule_delete() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced reminder rule delete failure';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER fail_reminder_rule_delete
        BEFORE DELETE ON reminder_rules
        FOR EACH ROW EXECUTE FUNCTION fail_reminder_rule_delete();
      `);

      try {
        await expect(saveReminderRulesIn(tx, eventId, [
          { offsetDays: -7, enabled: true },
          { offsetDays: -2, enabled: true },
          { offsetDays: 1, enabled: true },
        ])).rejects.toThrow("Failed query");
        expect(await values()).toEqual([[-7, true], [-1, true], [1, true]]);
      } finally {
        await pglite.exec("DROP TRIGGER fail_reminder_rule_delete ON reminder_rules; DROP FUNCTION fail_reminder_rule_delete();");
      }

      await saveReminderRulesIn(tx, eventId, [
        { offsetDays: -7, enabled: true },
        { offsetDays: -2, enabled: true },
        { offsetDays: 1, enabled: true },
      ]);
      expect(await values()).toEqual([[-7, true], [-2, true], [1, true]]);

      await saveReminderRulesIn(tx, eventId, []);
      expect(await values()).toEqual([]);
    });
  });

  describe("getLogDetail", () => {
    it("returns the stored body, idempotency key and attempts, tolerating no live-fallback mode", async () => {
      const logId = "e0000000-0000-4000-8000-000000000050";
      await pglite.query(
        `INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status,subject_rendered,body_rendered_html,attempts,provider_message_id)
         VALUES($1,$2,$3,'submission_received','key-1','sent','Welcome','<p>hi</p>',1,'resend_123')`,
        [logId, eventId, speakerId],
      );
      const detail = await getLogDetailIn(tx, eventId, logId as CommLogId);
      expect(detail.subjectRendered).toBe("Welcome");
      expect(detail.bodyRenderedHtml).toBe("<p>hi</p>");
      expect(detail.idempotencyKey).toBe("key-1");
      expect(detail.attempts).toBe(1);
      expect(detail.providerMessageId).toBe("resend_123");
      expect(typeof detail.previewFallback).toBe("boolean");
    });

    it("404s for a real row belonging to another event, and for an id that exists nowhere", async () => {
      // A genuine cross-tenant read: the row EXISTS, is readable by its own
      // event, and is invisible to the neighbouring one. An id that never
      // existed would 404 for trivial reasons and would prove nothing about
      // the `eventId` predicate in `getLogDetailIn`'s WHERE clause.
      const otherEventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000099");
      const otherSpeakerId = contactIdSchema.parse("e0000000-0000-4000-8000-000000000098");
      await pglite.query(
        "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'Neighbour Conf','neighbour','Pier 27','America/Los_Angeles','2026-11-01T16:00:00Z','2026-11-02T01:00:00Z')",
        [otherEventId],
      );
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'other@example.com','Ola','Mo')",
        [otherSpeakerId, otherEventId],
      );

      const ourLogId = "e0000000-0000-4000-8000-000000000052";
      const theirLogId = "e0000000-0000-4000-8000-000000000053";
      await pglite.query(
        `INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status,subject_rendered) VALUES
           ($1,$3,$5,'submission_received','ours-1','sent','Ours'),
           ($2,$4,$6,'submission_received','theirs-1','sent','Theirs')`,
        [ourLogId, theirLogId, eventId, otherEventId, speakerId, otherSpeakerId],
      );

      // Each row is readable by its own event…
      expect((await getLogDetailIn(tx, eventId, ourLogId as CommLogId)).subjectRendered).toBe("Ours");
      expect((await getLogDetailIn(tx, otherEventId, theirLogId as CommLogId)).subjectRendered).toBe("Theirs");
      // …and by no other, in either direction.
      await expectAppError(getLogDetailIn(tx, otherEventId, ourLogId as CommLogId), "NOT_FOUND");
      await expectAppError(getLogDetailIn(tx, eventId, theirLogId as CommLogId), "NOT_FOUND");
      // An id that exists in no event at all is still a 404, not a crash.
      await expectAppError(getLogDetailIn(tx, eventId, "e0000000-0000-4000-8000-000000000051" as CommLogId), "NOT_FOUND");
    });
  });

  describe("retryFailedCommunications", () => {
    it("requeues only eligible event rows in place and preserves their logical identity", async () => {
      const otherEventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000091");
      const otherSpeakerId = contactIdSchema.parse("e0000000-0000-4000-8000-000000000092");
      const eligibleId = commLogIdSchema.parse("e0000000-0000-4000-8000-000000000060");
      const sentId = commLogIdSchema.parse("e0000000-0000-4000-8000-000000000061");
      const credentialId = commLogIdSchema.parse("e0000000-0000-4000-8000-000000000062");
      const crossEventId = commLogIdSchema.parse("e0000000-0000-4000-8000-000000000063");

      await pglite.query(
        "INSERT INTO events(id,name,slug,location,timezone,starts_at,ends_at) VALUES($1,'Other','other-retry','Elsewhere','UTC','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')",
        [otherEventId],
      );
      await pglite.query(
        "INSERT INTO contacts(id,event_id,email,first_name,last_name) VALUES($1,$2,'other-retry@example.com','Other','Person')",
        [otherSpeakerId, otherEventId],
      );
      await pglite.query(
        `INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status,attempts,error,sent_at) VALUES
          ($1,$5,$6,'reviewer_invited','retry-same-logical-message','failed',6,'provider timeout',NULL),
          ($2,$5,$6,'reviewer_invited','retry-sent-message','sent',1,NULL,now()),
          ($3,$5,$6,'portal_login','retry-expired-credential','failed',1,'payload invalid',NULL),
          ($4,$7,$8,'reviewer_invited','retry-cross-event','failed',6,'provider timeout',NULL)`,
        [eligibleId, sentId, credentialId, crossEventId, eventId, speakerId, otherEventId, otherSpeakerId],
      );

      const result = await retryFailedCommunicationsIn(tx, eventId, [eligibleId, sentId, credentialId, crossEventId]);
      expect(result).toEqual({
        outcomes: [
          { logId: eligibleId, outcome: "requeued" },
          { logId: sentId, outcome: "ineligible" },
          { logId: credentialId, outcome: "ineligible" },
          { logId: crossEventId, outcome: "not_found" },
        ],
        requeued: 1,
        alreadyQueued: 0,
        ineligible: 2,
        notFound: 1,
      });

      const rows = await pglite.query<{
        id: string;
        status: string;
        attempts: number;
        error: string | null;
        idempotency_key: string;
      }>("SELECT id,status,attempts,error,idempotency_key FROM communication_logs ORDER BY id");
      const byId = new Map(rows.rows.map((row) => [row.id, row]));
      expect(byId.get(eligibleId)).toMatchObject({
        status: "queued",
        attempts: 0,
        error: null,
        idempotency_key: "retry-same-logical-message",
      });
      expect(byId.get(sentId)).toMatchObject({ status: "sent", attempts: 1 });
      expect(byId.get(credentialId)).toMatchObject({ status: "failed", attempts: 1 });
      expect(byId.get(crossEventId)).toMatchObject({ status: "failed", attempts: 6 });
      expect(rows.rows).toHaveLength(4);

      const repeated = await retryFailedCommunicationsIn(tx, eventId, [eligibleId]);
      expect(repeated).toMatchObject({ requeued: 0, alreadyQueued: 1, ineligible: 0, notFound: 0 });
      expect((await pglite.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM communication_logs WHERE idempotency_key='retry-same-logical-message'",
      )).rows[0]?.count).toBe(1);
    });

    it("allows only one of two concurrent retries to requeue the row", async () => {
      const logId = commLogIdSchema.parse("e0000000-0000-4000-8000-000000000064");
      await pglite.query(
        "INSERT INTO communication_logs(id,event_id,contact_id,template_key,idempotency_key,status,attempts,error) VALUES($1,$2,$3,'reviewer_invited','retry-concurrent','failed',6,'provider timeout')",
        [logId, eventId, speakerId],
      );

      const results = await Promise.all([
        retryFailedCommunicationsIn(tx, eventId, [logId]),
        retryFailedCommunicationsIn(tx, eventId, [logId]),
      ]);
      expect(results.map((result) => result.outcomes[0]?.outcome).sort()).toEqual(["already_queued", "requeued"]);
      expect((await pglite.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM communication_logs WHERE idempotency_key='retry-concurrent'",
      )).rows[0]?.count).toBe(1);
    });
  });

  describe("listOpenAssignmentsForContact", () => {
    it("lists only this contact's open assignments, earliest due date first", async () => {
      // Contact-targeted tasks assign to `accepted_speakers_v` only (resolution
      // #14), so an accepted submission naming this contact is the precondition.
      await pglite.query(
        "INSERT INTO forms(id,event_id,context,internal_name,status) VALUES($1,$2,'cfp','Main CFP','open')",
        ["e0000000-0000-4000-8000-000000000021", eventId],
      );
      await pglite.query(
        "INSERT INTO submissions(id,event_id,form_id,form_version,code,status,title,source,submitter_contact_id,decided_at) VALUES($1,$2,$3,1,11,'accepted','Agents in prod','cfp',$4,now())",
        ["e0000000-0000-4000-8000-000000000031", eventId, "e0000000-0000-4000-8000-000000000021", speakerId],
      );
      await pglite.query(
        "INSERT INTO submission_participants(event_id,submission_id,contact_id,is_primary,sort_order) VALUES($1,$2,$3,true,0)",
        [eventId, "e0000000-0000-4000-8000-000000000031", speakerId],
      );
      await pglite.query(
        "INSERT INTO portal_tasks(id,event_id,name,target_type,completion_mode,due_at,created_at) VALUES($1,$2,'Upload slides','contact','manual',now() + interval '5 days',now()),($3,$2,'Confirm bio','contact','manual',now() + interval '1 days',now())",
        [taskId, eventId, secondTaskId],
      );
      const rows = await listOpenAssignmentsForContactIn(tx, eventId, speakerId);
      expect(rows.map((row) => row.taskId)).toEqual([secondTaskId, taskId]);
    });

    it("returns nothing for a contact with no open assignments", async () => {
      const otherContact = contactIdSchema.parse("e0000000-0000-4000-8000-000000000011");
      await pglite.query("INSERT INTO contacts(id,event_id,email) VALUES($1,$2,'nobody@example.com')", [otherContact, eventId]);
      expect(await listOpenAssignmentsForContactIn(tx, eventId, otherContact)).toEqual([]);
    });
  });
});
