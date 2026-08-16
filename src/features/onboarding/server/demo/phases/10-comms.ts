import { communicationLogs, reminderRules } from "@/db/schema";
import { DEMO_MAIL_SKIP_REASON } from "@/features/comms";
import { demoLocal } from "../clock";
import { COMM_LOG_ROWS, type DemoCommLogRow } from "../dataset";
import { demoId } from "../ids";
import { demoContactId, type PhaseCtx } from "./context";

/**
 * Phase 10 — the outbox nobody will ever receive.
 *
 * Both writes here are documented direct inserts (design §2.4), mirroring
 * `reminders.ts`'s own bulk-insert precedent rather than going through
 * `saveReminderRules`/an admin route: there is no "create a backdated,
 * already-terminal log row" writer anywhere in the product, because a real
 * organizer never wants one. Provisioning is the one caller allowed to want
 * exactly that.
 *
 * **Verified discrepancy, not introduced here.** `seedDefaultTemplates`
 * (`comms/server/templates.ts`, called from inside `createEventIn` — phase 1,
 * not this one) already seeds three reminder rules at −7, −1 and +1 days for
 * every event, demo or not. Design §2.4 describes phase 10 as producing "4
 * reminder rules (enabled)" as if starting from nothing; it is really "the
 * three defaults every event already gets, plus one more rung." Reusing the
 * three existing offsets rather than proposing a colliding set of four new
 * ones is what keeps this phase's own upsert exact — an offset this phase
 * does not name is left exactly as `seedDefaultTemplates` set it, and no
 * fifth, orphaned row is ever created.
 */
const REMINDER_OFFSETS: readonly number[] = [-7, -1, 1, 7];

/** A plausible send hour for an offset-day row; the one `hoursAgo` row (the
 *  most recent, design §2.4's "−1 h" endpoint) uses plain instant arithmetic
 *  instead, the same discipline `clock.ts`'s own `comms.latestLogAt` uses. */
function instantFor(now: Date, row: DemoCommLogRow): Date {
  return row.hoursAgo !== undefined
    ? new Date(now.getTime() - row.hoursAgo * 60 * 60 * 1000)
    : demoLocal(now, row.offsetDays ?? 0, "10:00");
}

export async function runCommsPhase(ctx: PhaseCtx): Promise<void> {
  const { dbOrTx, eventId, now } = ctx;

  await dbOrTx.insert(reminderRules)
    .values(REMINDER_OFFSETS.map((offsetDays) => ({ eventId, offsetDays, enabled: true })))
    .onConflictDoUpdate({
      target: [reminderRules.eventId, reminderRules.offsetDays],
      set: { enabled: true, updatedAt: now },
    });

  await dbOrTx.insert(communicationLogs)
    .values(COMM_LOG_ROWS.map((row) => {
      const instant = instantFor(now, row);
      return {
        id: demoId(eventId, `comm-log:${row.key}`),
        eventId,
        contactId: demoContactId(eventId, row.speakerKey),
        templateKey: row.templateKey,
        // `communication_logs.idempotency_key` is globally unique — verified
        // Appendix A #2 — so every seeded row is namespaced under the event,
        // never the bare dataset key alone.
        idempotencyKey: `demo:${eventId}:${row.key}`,
        // MTP-18 §4/26 is pass/fail: every row on a demo event's delivery log
        // reads `Skipped`, with this reason. Backdated history used to be
        // seeded `sent`/`failed` for texture — nothing was ever delivered (the
        // recipients are `.demo.invalid`), but the status column an organizer
        // reads said it had been, which is the one thing the demo must never
        // claim. The live dispatcher stamps exactly this pair on a demo row;
        // provisioning now stamps it too, so the two paths agree and the
        // guarantee holds for rows nobody watched being written.
        status: "skipped" as const,
        subjectRendered: row.subjectRendered,
        error: DEMO_MAIL_SKIP_REASON,
        attempts: 0,
        // The design's own text calls for `next_attempt_at = NULL`; the
        // column is `NOT NULL DEFAULT now()` (verified `src/db/schema/comms.ts`),
        // so NULL is not representable. It does not matter functionally —
        // `claimRows` only ever selects `status = 'queued'`, which none of
        // these nine rows ever are — so it is simply pinned to the row's own
        // instant rather than left to a fresh `now()` default.
        nextAttemptAt: instant,
        createdAt: instant,
        sentAt: null,
      };
    }))
    .onConflictDoNothing({ target: communicationLogs.idempotencyKey });
}
