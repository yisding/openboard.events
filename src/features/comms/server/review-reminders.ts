import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx, type TxDb } from "@/db/client";
import { contacts } from "@/db/schema";
import { getOrCreateContact, updateContactFields } from "@/features/portal/index.contacts";
import { idem, type ContactId, type EventId, type PlanId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { enqueueEmail } from "@/shared/server/enqueue-email";

/**
 * M50 — review reminders.
 *
 * "Who still owes me scores" is the question a review week is made of, and the
 * answer already exists in `review_assignments`; this module only turns it into
 * outbox rows. It writes nothing itself: every row goes through `enqueueEmail`,
 * which is the repo's single outbox writer, and there is no new sender.
 *
 * Reminders are deliberately scoped to *outstanding* work in an *open* window.
 * Nagging somebody about a round that has not opened is noise, and nagging them
 * about one that has closed is worse — there is nothing they can do about it.
 */

export type ReviewReminderTarget = {
  reviewerUserId: UserId;
  name: string;
  email: string;
  outstanding: number;
};

/**
 * `enqueueEmail` is typed against `TxDb` because its other callers are the
 * audited transactional writers. A reminder burst must NOT open a ninth `withTx`
 * path (resolution #4), and the single `INSERT … ON CONFLICT DO NOTHING` it
 * issues behaves identically on the `neon-http` handle, so the handle is passed
 * through unchanged — the same reasoning, and the same helper name, as M36's
 * reminder scan.
 */
function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

type OutstandingRow = {
  reviewer_user_id: string;
  name: string;
  email: string;
  outstanding: number;
  contact_id: string | null;
};

async function ensureReviewerContact(
  dbOrTx: DbOrTx,
  eventId: EventId,
  target: ReviewReminderTarget & { contactId: string | null },
): Promise<ContactId> {
  if (target.contactId) return target.contactId as ContactId;

  const contactId = await getOrCreateContact(asOutboxWriter(dbOrTx), eventId, target.email);
  const [contact] = await dbOrTx.select({ firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)))
    .limit(1);
  if (contact && contact.firstName.trim() === "" && contact.lastName.trim() === "" && target.name.trim() !== "") {
    const [first, ...rest] = target.name.trim().split(/\s+/u);
    await updateContactFields(dbOrTx, eventId, contactId, { firstName: first ?? "", lastName: rest.join(" ") });
  }
  return contactId;
}

/**
 * Reviewers on a round with work still to finish, and the event contact each
 * one's mail would go to.
 *
 * Reviewers are `users`; the outbox addresses `contacts`. The join is by email
 * inside this event, so a reviewer who is also a speaker keeps one contact row
 * and one communication log rather than acquiring a shadow identity.
 */
export async function listOutstandingReviewersIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
): Promise<Array<ReviewReminderTarget & { contactId: string | null }>> {
  const result = await dbOrTx.execute<OutstandingRow>(sql`
    SELECT u.id AS reviewer_user_id, u.name, u.email, c.id AS contact_id,
           count(*)::int AS outstanding
    FROM review_assignments ra
    JOIN users u ON u.id = ra.reviewer_user_id
    LEFT JOIN contacts c ON c.event_id = ra.event_id AND lower(c.email) = lower(u.email)
    LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
      AND r.reviewer_user_id = ra.reviewer_user_id AND r.submitted_at IS NOT NULL
    WHERE ra.event_id = ${eventId} AND ra.plan_id = ${planId}
      AND ra.status = 'assigned' AND r.id IS NULL
    GROUP BY u.id, u.name, u.email, c.id
    ORDER BY lower(u.name), u.email
  `);
  return (result.rows ?? []).map((row) => ({
    reviewerUserId: row.reviewer_user_id as UserId,
    name: row.name,
    email: row.email,
    outstanding: Number(row.outstanding),
    contactId: row.contact_id,
  }));
}

/**
 * Enqueue one reminder per named reviewer who still has outstanding work.
 *
 * `attemptId` is generated once when the organizer opens the exact-recipient
 * confirmation and retained across every retry of that dialog. It makes a
 * response lost after commit safe to retry even after the clock crosses a
 * minute boundary, while opening a new confirmation remains a new nudge.
 */
export async function sendReviewRemindersIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  reviewerUserIds: readonly UserId[] | null,
  attemptId: string,
  now: number = Date.now(),
): Promise<{ enqueued: number; skipped: number }> {
  const planRows = await dbOrTx.execute<{ status: string; opens_at: string | null; closes_at: string | null }>(sql`
    SELECT status, opens_at, closes_at FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}
  `);
  const plan = (planRows.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");

  const opensAt = plan.opens_at ? new Date(plan.opens_at).getTime() : null;
  const closesAt = plan.closes_at ? new Date(plan.closes_at).getTime() : null;
  const windowOpen = plan.status === "open"
    && (opensAt === null || now >= opensAt)
    && (closesAt === null || now < closesAt);
  if (!windowOpen) {
    throw new AppError("CONFLICT", "Reminders only go out while the round is open");
  }

  const wanted = reviewerUserIds === null ? null : new Set<string>(reviewerUserIds);
  const targets = (await listOutstandingReviewersIn(dbOrTx, eventId, planId))
    .filter((target) => wanted === null || wanted.has(target.reviewerUserId));

  let enqueued = 0;
  const remindedUserIds: UserId[] = [];
  for (const target of targets) {
    // Existing event members are valid reviewers even when they have never
    // appeared in the speaker CRM. The outbox still needs an event-scoped
    // contact for suppression, rendering, and delivery history, so provision
    // that identity just in time through the canonical contact writers.
    const contactId = await ensureReviewerContact(dbOrTx, eventId, target);
    await enqueueEmail(asOutboxWriter(dbOrTx), {
      eventId,
      templateKey: "review_reminder",
      contactId,
      idempotencyKey: idem.reviewReminder(eventId, planId, target.reviewerUserId, attemptId),
    });
    remindedUserIds.push(target.reviewerUserId);
    enqueued += 1;
  }

  if (enqueued > 0) {
    await dbOrTx.execute(sql`
      UPDATE review_assignments SET last_reminded_at = now(), updated_at = now()
      WHERE event_id = ${eventId} AND plan_id = ${planId} AND status = 'assigned'
        AND reviewer_user_id = ANY(${sql`ARRAY[${sql.join(
          remindedUserIds.map((reviewerUserId) => sql`${reviewerUserId}::uuid`),
          sql`, `,
        )}]`})
    `);
  }
  return { enqueued, skipped: 0 };
}

export const listOutstandingReviewers = (eventId: EventId, planId: PlanId) =>
  listOutstandingReviewersIn(db, eventId, planId);
export const sendReviewReminders = (eventId: EventId, planId: PlanId, reviewerUserIds: readonly UserId[] | null, attemptId: string) =>
  sendReviewRemindersIn(db, eventId, planId, reviewerUserIds, attemptId);
