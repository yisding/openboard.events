import { and, asc, eq, sql } from "drizzle-orm";
import type { SeedCtx } from "./lib/helpers";
import { communicationLogs, contacts, portalTokens, sessions, submissions } from "@/db/schema";
import { sealPortalLoginPayload } from "@/features/auth";
import { sha256 } from "@/features/auth/server/crypto";
import { seedDefaultTemplates } from "@/features/comms";
import {
  contactIdSchema,
  eventIdSchema,
  idem,
  sessionIdSchema,
  submissionIdSchema,
  taskIdSchema,
  tokenIdSchema,
} from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";

function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) return (result as { rows: Row[] }).rows;
  return [];
}

export async function seedComms(ctx: SeedCtx): Promise<void> {
  const { tx } = ctx;
  const eventId = eventIdSchema.parse(ctx.eventId);
  await seedDefaultTemplates(tx, eventId);
  const [event] = await tx.select({ slug: sql<string>`slug` }).from(sql`events`).where(sql`id=${eventId}`).limit(1);
  const [defaultContact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.eventId, eventId)).orderBy(asc(contacts.createdAt)).limit(1);
  const [unsubscribed] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.eventId, eventId), sql`${contacts.unsubscribedAt} IS NOT NULL`)).limit(1);
  const [received] = await tx.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.eventId, eventId), eq(submissions.status, "pending"))).orderBy(asc(submissions.createdAt)).limit(1);
  const [accepted] = await tx.select({ id: submissions.id, revision: submissions.notifyRevision }).from(submissions).where(and(eq(submissions.eventId, eventId), eq(submissions.status, "accepted"))).orderBy(asc(submissions.createdAt)).limit(1);
  const [declined] = await tx.select({ id: submissions.id, revision: submissions.notifyRevision }).from(submissions).where(and(eq(submissions.eventId, eventId), eq(submissions.status, "declined"))).orderBy(asc(submissions.createdAt)).limit(1);
  const assignmentResult = await tx.execute(sql`SELECT task_id,contact_id,submission_id FROM task_assignments_v WHERE event_id=${eventId} AND NOT completed ORDER BY due_at NULLS LAST LIMIT 1`);
  const [assignment] = rowsOf<{ task_id: string; contact_id: string; submission_id: string | null }>(assignmentResult);
  const scheduled = await tx.select({ id: sessions.id, revision: sessions.scheduleRevision, contactId: sql<string>`ss.contact_id` })
    .from(sessions).innerJoin(sql`session_speakers ss`, sql`ss.session_id=${sessions.id} AND ss.event_id=${sessions.eventId}`)
    .where(and(eq(sessions.eventId, eventId), eq(sessions.status, "published"), sql`${sessions.startsAt} IS NOT NULL`))
    .orderBy(asc(sessions.startsAt)).limit(2);
  if (!event || !defaultContact || !received || !accepted || !declined || !assignment || scheduled.length === 0) {
    // The upstream seed modules are still no-ops, which is the documented state
    // while their workstreams fill them in. Skipping keeps `pnpm seed` a working
    // command for everyone else; a genuine failure below still throws.
    ctx.log("skipped — needs seeded contacts, submissions, an open task assignment and a published session");
    return;
  }

  const contactId = contactIdSchema.parse(defaultContact.id);
  const receivedId = submissionIdSchema.parse(received.id);
  const acceptedId = submissionIdSchema.parse(accepted.id);
  const declinedId = submissionIdSchema.parse(declined.id);
  const taskContactId = contactIdSchema.parse(unsubscribed?.id ?? assignment.contact_id);
  const taskId = taskIdSchema.parse(assignment.task_id);
  const taskSubmissionId = assignment.submission_id ? submissionIdSchema.parse(assignment.submission_id) : null;
  const assignedKey = idem.taskAssigned(eventId, taskId, contactIdSchema.parse(assignment.contact_id), taskSubmissionId);
  const reminderKey = idem.taskReminder(eventId, taskId, taskContactId, taskSubmissionId, -1);
  const firstSession = scheduled[0];
  if (!firstSession) throw new Error("seedComms requires a published session");
  const secondSession = scheduled[1] ?? firstSession;
  const firstSessionId = sessionIdSchema.parse(firstSession.id);
  const secondSessionId = sessionIdSchema.parse(secondSession.id);
  const firstSessionContact = contactIdSchema.parse(firstSession.contactId);
  const secondSessionContact = contactIdSchema.parse(secondSession.contactId);

  const baseRows = [
    { id: ctx.id("comm", "submission-received"), eventId, contactId, templateKey: "submission_received" as const, idempotencyKey: idem.received(eventId, receivedId), submissionId: receivedId },
    { id: ctx.id("comm", "submission-accepted"), eventId, contactId, templateKey: "submission_accepted" as const, idempotencyKey: idem.decision(eventId, acceptedId, accepted.revision), submissionId: acceptedId },
    { id: ctx.id("comm", "submission-declined"), eventId, contactId, templateKey: "submission_declined" as const, idempotencyKey: idem.decision(eventId, declinedId, declined.revision), submissionId: declinedId },
    { id: ctx.id("comm", "task-assigned"), eventId, contactId: contactIdSchema.parse(assignment.contact_id), templateKey: "task_assigned" as const, idempotencyKey: assignedKey, taskId, ...(taskSubmissionId ? { submissionId: taskSubmissionId } : {}) },
    { id: ctx.id("comm", "task-reminder"), eventId, contactId: taskContactId, templateKey: "task_reminder" as const, idempotencyKey: reminderKey, taskId, ...(taskSubmissionId ? { submissionId: taskSubmissionId } : {}) },
    { id: ctx.id("comm", "schedule-assigned"), eventId, contactId: firstSessionContact, templateKey: "schedule_assigned" as const, idempotencyKey: `${eventId}:sched:${firstSessionId}:${firstSessionContact}:${firstSession.revision}`, sessionId: firstSessionId },
    { id: ctx.id("comm", "schedule-changed"), eventId, contactId: secondSessionContact, templateKey: "schedule_changed" as const, idempotencyKey: `${eventId}:sched:${secondSessionId}:${secondSessionContact}:${secondSession.revision + (secondSessionId === firstSessionId ? 1 : 0)}`, sessionId: secondSessionId },
  ];
  await tx.insert(communicationLogs).values(baseRows).onConflictDoNothing({ target: communicationLogs.idempotencyKey });

  const env = getEnv();
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required to seed portal_login delivery");
  const loginTokenId = tokenIdSchema.parse(ctx.id("token", "portal-login"));
  const raw = "seed-portal-login-token";
  await tx.insert(portalTokens).values({
    id: loginTokenId,
    eventId,
    contactId,
    purpose: "magic_link",
    tokenHash: await sha256(raw),
    otpHash: await sha256("123456"),
    expiresAt: new Date(ctx.now.getTime() + 15 * 60_000),
  }).onConflictDoNothing({ target: portalTokens.id });
  const loginKey = idem.portalLogin(eventId, contactId, loginTokenId);
  const secretPayloadCiphertext = await sealPortalLoginPayload({
    otp: "123456",
    magicLink: `${env.APP_BASE_URL}/portal/${encodeURIComponent(event.slug)}/verify?token=${encodeURIComponent(raw)}`,
  }, { eventId, contactId, tokenId: loginTokenId }, env.SESSION_SECRET);
  await tx.insert(communicationLogs).values({
    id: ctx.id("comm", "portal-login"),
    eventId,
    contactId,
    templateKey: "portal_login",
    idempotencyKey: loginKey,
    secretPayloadCiphertext,
  }).onConflictDoNothing({ target: communicationLogs.idempotencyKey });
  ctx.log("seeded communication templates, reminder rules, and 8 outbox rows");
}
