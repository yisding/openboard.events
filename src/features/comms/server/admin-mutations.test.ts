import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TxDb } from "@/db/client";
import * as schema from "@/db/schema";
import { contactIdSchema, eventIdSchema, taskIdSchema, type CommLogId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import {
  getLogDetailIn,
  listOpenAssignmentsForContactIn,
  listReminderRulesIn,
  listTemplatesIn,
  saveReminderRulesIn,
  saveTemplateIn,
} from "./admin-mutations";
import { scanRemindersIn } from "./reminders";
import { seedDefaultTemplates } from "./templates";

const migration0 = readFileSync(new URL("../../../../drizzle/0000_init.sql", import.meta.url), "utf8");
const migration1 = readFileSync(new URL("../../../../drizzle/0001_views_triggers.sql", import.meta.url), "utf8");

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
    it("returns the 8 template keys in enum order, never DB order", async () => {
      const rows = await listTemplatesIn(tx, eventId);
      expect(rows.map((row) => row.key)).toEqual([
        "submission_received", "submission_accepted", "submission_declined",
        "task_assigned", "task_reminder", "schedule_assigned", "schedule_changed", "portal_login",
      ]);
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
