import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { calendarInvites, communicationLogs, contacts, contactSuppressions, events, forms, portalTasks, rooms, sessions, sessionSpeakers, speakerBulkMessages, submissions, tracks } from "@/db/schema";
import { issuePortalToken, openAdminLinkPayload, openPortalLoginPayload, type AdminLinkPayload } from "@/features/auth";
import { issueOrganizationInvitationTokenIn } from "@/features/organizations";
import { isTransactionalTemplate, organizationInvitationIdSchema, tokenIdSchema, type ContactId, type EventId, type TemplateKey, type TemplateVars } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { formatInZone } from "@/shared/lib/time";
import { isEmailAllowed } from "@/shared/server/email-allowlist";
import { escapeHtml } from "./render";
import { signUnsubscribeToken } from "./unsubscribe";

export type OutboxRow = typeof communicationLogs.$inferSelect;

/**
 * M42 — admin/organizer auth mail. Grouped here because three separate
 * decisions key off it: the sealed link payload is opened instead of a portal
 * OTP, no speaker-portal magic link is minted, and the dispatcher redacts the
 * stored body.
 */
export function isAdminAuthTemplate(key: TemplateKey): boolean {
  return key === "admin_password_reset" || key === "admin_email_verification";
}

/**
 * M44 legacy event-scoped team invitations. New invitations use the encrypted
 * product outbox; this branch remains so rows queued before that migration can
 * still render without a speaker-portal credential.
 */
export function isOrganizationInviteTemplate(key: TemplateKey): boolean {
  return key === "organization_invited";
}

export class SkipEmail extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipEmail";
  }
}

export type BuiltContext = {
  vars: TemplateVars;
  recipientEmail: string;
  recipientName: string;
  eventName: string;
  logoUrl?: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
  calendarDownloadUrl?: string;
  templateOverride?: { subject?: string; bodyHtml?: string };
};

function rowsOf<Row>(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: Row[] }).rows;
  }
  return [];
}

function formatDue(value: Date | string | null, timezone: string): string {
  return value ? formatInZone(value, timezone, "date") : "No due date";
}

function buildOutstandingList(items: Array<{ name: string; dueAt: Date | string | null }>, timezone: string): string {
  const rows = items.map((item) => `<li>${escapeHtml(item.name)} — ${escapeHtml(formatDue(item.dueAt, timezone))}</li>`).join("");
  return `<ul>${rows || "<li>No other outstanding tasks</li>"}</ul>`;
}

function googleTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function buildCalendarLinks(args: { title: string; startsAt: Date; endsAt: Date; location: string; downloadUrl: string }) {
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", args.title);
  google.searchParams.set("dates", `${googleTimestamp(args.startsAt)}/${googleTimestamp(args.endsAt)}`);
  google.searchParams.set("location", args.location);
  const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", args.title);
  outlook.searchParams.set("startdt", args.startsAt.toISOString());
  outlook.searchParams.set("enddt", args.endsAt.toISOString());
  outlook.searchParams.set("location", args.location);
  const googleUrl = google.toString();
  const outlookUrl = outlook.toString();
  return calendarTemplateVars({ googleUrl, outlookUrl, downloadUrl: args.downloadUrl });
}

function calendarTemplateVars(args: { googleUrl: string; outlookUrl: string; downloadUrl: string }) {
  const buttonsHtml = `<p><a href="${escapeHtml(args.googleUrl)}">Add to Google Calendar</a> · <a href="${escapeHtml(args.outlookUrl)}">Add to Outlook</a> · <a href="${escapeHtml(args.downloadUrl)}">Download calendar invite</a></p>`;
  return { google_url: args.googleUrl, outlook_url: args.outlookUrl, download_url: args.downloadUrl, buttons_html: buttonsHtml };
}

export function applyCalendarInvite(
  context: BuiltContext,
  invite: { googleUrl: string; outlookUrl: string; downloadUrl: string },
): BuiltContext {
  return {
    ...context,
    vars: { ...context.vars, calendar: calendarTemplateVars(invite) } as TemplateVars,
    calendarDownloadUrl: invite.downloadUrl,
  };
}

/**
 * M50 review mail. The reviewer is a `users` row, so the plan and the reviewer
 * are recovered from the idempotency key — the same trick `portal_login` uses
 * for its token id, and the reason both key recipes are pinned in `contracts`.
 *
 * `outstanding` is counted at render time rather than at enqueue time: a
 * reviewer who finished between the click and the send is told nothing at all,
 * rather than being nagged about work they have already done.
 *
 * The two keys are not the same question, and conflating them silently ate the
 * invitation. A *reminder* is about a round somebody is on: no round, nothing to
 * chase, skip. An *invitation* is enqueued by `createEventReviewer`, which
 * creates the account and the membership and nothing else — being on a round is
 * the organizer's next action, not a precondition — so it renders whether or not
 * a round exists yet, preferring the reviewer's own round, then the event's
 * current one, and naming none when the event has none.
 */
async function buildReviewVars(row: OutboxRow, dbOrTx: DbOrTx, env: RuntimeEnv) {
  const segments = row.idempotencyKey.split(":");
  const isReminder = row.templateKey === "review_reminder";
  const planId = isReminder ? segments[2] : null;
  const reviewerUserId = isReminder ? segments[3] : segments[2];
  if (!reviewerUserId) throw new AppError("VALIDATION", "review reminder idempotency key is malformed");

  const planResult = await dbOrTx.execute(sql`
    SELECT p.name, p.closes_at,
      (SELECT count(*) FROM review_assignments ra
       LEFT JOIN reviews r ON r.plan_id = ra.plan_id AND r.submission_id = ra.submission_id
         AND r.reviewer_user_id = ra.reviewer_user_id AND r.submitted_at IS NOT NULL
       WHERE ra.plan_id = p.id AND ra.reviewer_user_id = ${reviewerUserId}
         AND ra.status = 'assigned' AND r.id IS NULL)::int AS outstanding
    FROM evaluation_plans p
    WHERE p.event_id = ${row.eventId}
      AND (${planId}::uuid IS NULL OR p.id = ${planId}::uuid)
      AND (${!isReminder}
           OR EXISTS (SELECT 1 FROM reviewer_assignments a WHERE a.plan_id = p.id AND a.user_id = ${reviewerUserId}))
    -- An invitation prefers a round the reviewer is already on; a reminder only
    -- ever sees those, so the first key is a no-op for it.
    ORDER BY EXISTS (SELECT 1 FROM reviewer_assignments a WHERE a.plan_id = p.id AND a.user_id = ${reviewerUserId}) DESC,
             (p.status = 'open') DESC, p.round ASC, p.created_at ASC
    LIMIT 1
  `);
  const [plan] = rowsOf<{ name: string; closes_at: Date | string | null; outstanding: number }>(planResult);
  if (isReminder) {
    if (!plan) throw new SkipEmail("reviewer is no longer on a review round");
    if (Number(plan.outstanding ?? 0) === 0) throw new SkipEmail("reviewer has nothing outstanding");
  }
  const outstanding = Number(plan?.outstanding ?? 0);

  const [event] = await dbOrTx.select({ timezone: events.timezone }).from(events)
    .where(eq(events.id, row.eventId)).limit(1);
  return {
    // Naming a round that does not exist would be the one lie an invitation
    // cannot afford: the reviewer would go looking for it.
    round: plan?.name ?? "not yet announced",
    queue_url: `${env.APP_BASE_URL}/events/${encodeURIComponent(row.eventId)}/review${planId ? `?planId=${encodeURIComponent(planId)}` : ""}`,
    outstanding: String(outstanding),
    closes_at: plan?.closes_at ? formatInZone(plan.closes_at, event?.timezone ?? "UTC", "dateTime") : "when the organizers close it",
  };
}

export async function buildContext(row: OutboxRow, dbOrTx: DbOrTx = db, env: RuntimeEnv = getEnv()): Promise<BuiltContext> {
  const [base] = await dbOrTx.select({
    eventName: events.name,
    eventSlug: events.slug,
    eventTimezone: events.timezone,
    eventStartsAt: events.startsAt,
    eventEndsAt: events.endsAt,
    eventLocation: events.location,
    eventPhysicalAddress: events.physicalAddress,
    logoFileId: events.logoFileId,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    unsubscribedAt: contacts.unsubscribedAt,
    suppressedAt: contactSuppressions.suppressedAt,
    suppressionReason: contactSuppressions.reason,
  }).from(events).innerJoin(contacts, and(eq(contacts.eventId, events.id), eq(contacts.id, row.contactId)))
    .leftJoin(contactSuppressions, eq(contactSuppressions.contactId, contacts.id))
    .where(eq(events.id, row.eventId)).limit(1);
  if (!base) throw new SkipEmail("contact no longer exists");
  if (!isEmailAllowed(base.email, env)) throw new SkipEmail("not in EMAIL_ALLOWLIST");
  // P3-EMAIL: a hard bounce/complaint (Resend webhook, `suppressedAt`) blocks
  // EVERY send, including decision/schedule/portal-login — the address is
  // provider-confirmed undeliverable or has reported the sender as spam, so
  // there is no "essential" mail worth risking reputation to still send.
  if (base.suppressedAt) throw new SkipEmail(`contact suppressed (${base.suppressionReason ?? "unknown"})`);
  // The contact's own opt-out only withholds non-essential mail — see
  // `isTransactionalTemplate` for the fleet-wide policy this now applies to
  // every key, not just `task_reminder` (PLAN roadmap P3-EMAIL).
  if (base.unsubscribedAt && !isTransactionalTemplate(row.templateKey)) throw new SkipEmail("contact unsubscribed from non-essential email");

  const contactId = row.contactId as ContactId;
  const eventId = row.eventId as EventId;
  let unsubscribeUrl = `${env.APP_BASE_URL}/portal/${encodeURIComponent(base.eventSlug)}/unsubscribe`;
  if (!isTransactionalTemplate(row.templateKey)) {
    // M46 — dedicated key, not SESSION_SECRET (see UNSUBSCRIBE_SECRET's env.ts
    // comment and unsubscribe.ts's configuredSecret()).
    if (!env.UNSUBSCRIBE_SECRET) throw new AppError("INTERNAL", "UNSUBSCRIBE_SECRET is required for unsubscribe links");
    const unsubscribeToken = await signUnsubscribeToken({ eventId, contactId }, env.UNSUBSCRIBE_SECRET);
    unsubscribeUrl += `?token=${encodeURIComponent(unsubscribeToken)}`;
  }
  let magicLink = "";
  let otpCode: string | undefined;
  let adminLink: AdminLinkPayload | undefined;
  let orgInvite: Awaited<ReturnType<typeof issueOrganizationInvitationTokenIn>> | undefined;
  if (isAdminAuthTemplate(row.templateKey)) {
    // M42 — the reset/verification URL travels sealed in the outbox row, the
    // same way `portal_login`'s OTP does, and is bound by AAD to this event,
    // this contact and the link id at the tail of the idempotency key.
    if (!row.secretPayloadCiphertext) throw new AppError("VALIDATION", "admin auth link payload is missing");
    if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin auth delivery");
    const linkId = row.idempotencyKey.split(":").at(-1);
    if (!linkId) throw new AppError("VALIDATION", "admin auth idempotency key is malformed");
    adminLink = await openAdminLinkPayload(row.secretPayloadCiphertext, { eventId, contactId, linkId }, env.SESSION_SECRET);
  } else if (isOrganizationInviteTemplate(row.templateKey)) {
    // M44 legacy compatibility: mint the join token for an event-scoped row
    // queued before product-level invitation delivery existed.
    const invitationId = organizationInvitationIdSchema.safeParse(row.idempotencyKey.split(":")[2]);
    if (!invitationId.success) throw new AppError("VALIDATION", "organization invite idempotency key is malformed");
    const issued = await issueOrganizationInvitationTokenIn(dbOrTx, invitationId.data);
    if (!issued) throw new SkipEmail("invitation is no longer pending");
    orgInvite = issued;
  } else if (row.templateKey === "portal_login") {
    if (!row.secretPayloadCiphertext) throw new AppError("VALIDATION", "portal login payload is missing");
    if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal login delivery");
    const parsedTokenId = tokenIdSchema.safeParse(row.idempotencyKey.split(":").at(-1));
    if (!parsedTokenId.success) throw new AppError("VALIDATION", "portal login idempotency key is malformed");
    const tokenId = parsedTokenId.data;
    const payload = await openPortalLoginPayload(row.secretPayloadCiphertext, { eventId, contactId, tokenId }, env.SESSION_SECRET);
    magicLink = payload.magicLink;
    otpCode = payload.otp;
  } else {
    magicLink = "";
  }

  const common = {
    event: {
      name: base.eventName,
      start_date: formatInZone(base.eventStartsAt, base.eventTimezone, "date"),
      location: base.eventLocation?.trim() || "Location to be announced",
      timezone: base.eventTimezone,
    },
    speaker: {
      first_name: base.firstName.trim() || "there",
      last_name: base.lastName.trim(),
      email: base.email,
    },
    portal: { magic_link: magicLink },
    unsubscribe: { url: unsubscribeUrl },
  };
  let vars: TemplateVars;
  let templateOverride: BuiltContext["templateOverride"];
  let calendarDownloadUrl: string | undefined;

  if (row.templateKey.startsWith("submission_")) {
    if (!row.submissionId) throw new AppError("TEMPLATE_VAR_MISSING", "missing variable submission.id");
    const [submission] = await dbOrTx.select({
      title: submissions.title,
      code: submissions.code,
      status: submissions.status,
      confirmationSubject: forms.confirmationSubject,
      confirmationBodyHtml: forms.confirmationBodyHtml,
    }).from(submissions).leftJoin(forms, and(eq(forms.id, submissions.formId), eq(forms.eventId, submissions.eventId)))
      .where(and(eq(submissions.id, row.submissionId), eq(submissions.eventId, row.eventId))).limit(1);
    if (!submission) throw new SkipEmail("submission no longer exists");
    if (row.templateKey === "submission_accepted" && submission.status !== "accepted") throw new SkipEmail("submission is no longer accepted");
    if (row.templateKey === "submission_declined" && submission.status !== "declined") throw new SkipEmail("submission is no longer declined");
    vars = { ...common, submission: { title: submission.title, code: `SESS-${submission.code}` } } as TemplateVars;
    if (row.templateKey === "submission_received" && (submission.confirmationSubject || submission.confirmationBodyHtml)) {
      templateOverride = {
        ...(submission.confirmationSubject ? { subject: submission.confirmationSubject } : {}),
        ...(submission.confirmationBodyHtml ? { bodyHtml: submission.confirmationBodyHtml } : {}),
      };
    }
  } else if (row.templateKey === "task_assigned" || row.templateKey === "task_reminder") {
    if (!row.taskId) throw new AppError("TEMPLATE_VAR_MISSING", "missing variable task.id");
    const assignmentResult = await dbOrTx.execute(sql`
      SELECT task_id, completed FROM task_assignments_v
      WHERE event_id=${row.eventId} AND task_id=${row.taskId} AND contact_id=${row.contactId}
        AND submission_id IS NOT DISTINCT FROM ${row.submissionId}
      LIMIT 1
    `);
    const [assignment] = rowsOf<{ task_id: string; completed: boolean }>(assignmentResult);
    if (!assignment) throw new SkipEmail("task is no longer assigned");
    if (assignment.completed) throw new SkipEmail("task is already completed");
    const [task] = await dbOrTx.select({ name: portalTasks.name, dueAt: portalTasks.dueAt }).from(portalTasks)
      .where(and(eq(portalTasks.id, row.taskId), eq(portalTasks.eventId, row.eventId))).limit(1);
    if (!task) throw new SkipEmail("task no longer exists");
    const outstandingResult = await dbOrTx.execute(sql`
      SELECT t.name, a.due_at
      FROM task_assignments_v a JOIN portal_tasks t ON t.id=a.task_id AND t.event_id=a.event_id
      WHERE a.event_id=${row.eventId} AND a.contact_id=${row.contactId} AND NOT a.completed
      ORDER BY a.due_at NULLS LAST, t.name
    `);
    const outstanding = rowsOf<{ name: string; due_at: Date | string | null }>(outstandingResult)
      .map((item) => ({ name: item.name, dueAt: item.due_at }));
    vars = {
      ...common,
      task: { name: task.name, due_date: formatDue(task.dueAt, base.eventTimezone) },
      tasks: { outstanding_list: buildOutstandingList(outstanding, base.eventTimezone) },
    } as TemplateVars;
  } else if (row.templateKey === "schedule_assigned" || row.templateKey === "schedule_changed") {
    if (!row.sessionId) throw new AppError("TEMPLATE_VAR_MISSING", "missing variable session.id");
    const [session] = await dbOrTx.select({
      title: sessions.title,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      status: sessions.status,
      speakerContactId: sessionSpeakers.contactId,
      room: rooms.name,
      track: tracks.name,
    }).from(sessions).leftJoin(sessionSpeakers, and(
      eq(sessionSpeakers.eventId, sessions.eventId),
      eq(sessionSpeakers.sessionId, sessions.id),
      eq(sessionSpeakers.contactId, row.contactId),
    )).leftJoin(rooms, and(eq(rooms.id, sessions.roomId), eq(rooms.eventId, sessions.eventId)))
      .leftJoin(tracks, and(eq(tracks.id, sessions.trackId), eq(tracks.eventId, sessions.eventId)))
      .where(and(eq(sessions.id, row.sessionId), eq(sessions.eventId, row.eventId))).limit(1);
    if (!session) throw new SkipEmail("session no longer exists");
    const scheduled = Boolean(session.startsAt && session.endsAt && session.status === "published" && session.speakerContactId);
    if (!scheduled) {
      const [existingInvite] = await dbOrTx.select({ lastMethod: calendarInvites.lastMethod }).from(calendarInvites)
        .where(and(
          eq(calendarInvites.eventId, row.eventId),
          eq(calendarInvites.contactId, row.contactId),
          eq(calendarInvites.sessionId, row.sessionId),
        )).limit(1);
      if (!existingInvite) throw new SkipEmail("session is no longer published and scheduled");
      templateOverride = {
        subject: "Schedule removed: {{session.title}}",
        bodyHtml: "<p><strong>{{session.title}}</strong> is no longer on the published schedule.</p>{{calendar.buttons_html}}",
      };
    }
    const { raw: calendarToken } = await issuePortalToken(dbOrTx, { contactId, eventId, purpose: "ics_download", ttl: "P365D" });
    const downloadUrl = `${env.APP_BASE_URL}/cal/${encodeURIComponent(calendarToken)}/${encodeURIComponent(row.sessionId)}`;
    calendarDownloadUrl = downloadUrl;
    const startsAt = session.startsAt ?? base.eventStartsAt;
    const endsAt = session.endsAt ?? base.eventEndsAt;
    vars = {
      ...common,
      session: {
        title: session.title,
        start_time_local: formatInZone(startsAt, base.eventTimezone, "dateTime"),
        end_time_local: formatInZone(endsAt, base.eventTimezone, "time"),
        timezone: base.eventTimezone,
        room: session.room ?? "Room to be announced",
        track: session.track ?? "General",
      },
      calendar: buildCalendarLinks({ title: session.title, startsAt, endsAt, location: session.room ?? base.eventLocation ?? "", downloadUrl }),
    } as TemplateVars;
  } else if (row.templateKey === "reviewer_invited" || row.templateKey === "review_reminder") {
    vars = { ...common, review: await buildReviewVars(row, dbOrTx, env) } as TemplateVars;
  } else if (row.templateKey === "speaker_bulk_message") {
    // M51 — the organizer-typed subject/body for this one recipient, keyed by
    // the exact idempotency key this outbox row carries (one row per
    // `composeBulkSpeakerEmailIn` call, resolution #4: no ninth `withTx`, so
    // the content is written by a single-statement insert at compose time and
    // only ever read back here).
    const [message] = await dbOrTx.select({ subject: speakerBulkMessages.subject, bodyHtml: speakerBulkMessages.bodyHtml })
      .from(speakerBulkMessages)
      .where(and(eq(speakerBulkMessages.eventId, row.eventId), eq(speakerBulkMessages.idempotencyKey, row.idempotencyKey)))
      .limit(1);
    if (!message) throw new SkipEmail("bulk message content is no longer available");
    templateOverride = { subject: message.subject, bodyHtml: message.bodyHtml };
    vars = { ...common } as TemplateVars;
  } else if (adminLink) {
    // M42. `common.portal` is dropped rather than passed through: the admin
    // templates' var schema has no `portal` key, and there is no magic link to
    // put in it (nothing is minted below for these keys).
    const adminCommon = { event: common.event, speaker: common.speaker, unsubscribe: common.unsubscribe };
    vars = {
      ...adminCommon,
      admin: {
        name: base.firstName.trim() || base.email,
        action_url: adminLink.url,
        expires_in: adminLink.expiresIn,
      },
    } as unknown as TemplateVars;
  } else if (orgInvite) {
    // M44. Same `portal`-dropping treatment as `adminLink` above, and for the
    // same reason: the recipient is joining the admin app, not the speaker
    // portal.
    const inviteCommon = { event: common.event, speaker: common.speaker, unsubscribe: common.unsubscribe };
    vars = {
      ...inviteCommon,
      invite: {
        organization_name: orgInvite.organizationName,
        inviter_name: orgInvite.inviterEmail,
        role: orgInvite.role,
        action_url: `${env.APP_BASE_URL}/join?token=${encodeURIComponent(orgInvite.raw)}`,
        expires_at: formatInZone(orgInvite.expiresAt, base.eventTimezone, "dateTime"),
      },
    } as unknown as TemplateVars;
  } else {
    vars = { ...common, otp: { code: otpCode } } as TemplateVars;
  }

  // A speaker-portal magic link is minted for every template that offers the
  // `portal.magic_link` token. `portal_login` already carries its own; M42's
  // admin auth mail and M44's team-invitation mail deliberately have none —
  // see `isAdminAuthTemplate`/`isOrganizationInviteTemplate`.
  if (row.templateKey !== "portal_login" && !isAdminAuthTemplate(row.templateKey) && !isOrganizationInviteTemplate(row.templateKey)) {
    const { raw } = await issuePortalToken(dbOrTx, { contactId, eventId, purpose: "magic_link", ttl: "P30D" });
    common.portal.magic_link = `${env.APP_BASE_URL}/portal/${encodeURIComponent(base.eventSlug)}/verify?token=${encodeURIComponent(raw)}`;
  }

  return {
    vars,
    recipientEmail: base.email,
    recipientName: `${base.firstName} ${base.lastName}`.trim() || base.email,
    eventName: base.eventName,
    unsubscribeUrl,
    ...(calendarDownloadUrl ? { calendarDownloadUrl } : {}),
    ...(base.logoFileId ? { logoUrl: `${env.APP_BASE_URL}/f/${base.logoFileId}` } : {}),
    ...(base.eventPhysicalAddress ? { physicalAddress: base.eventPhysicalAddress } : {}),
    ...(templateOverride ? { templateOverride } : {}),
  };
}
