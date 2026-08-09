import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { calendarInvites, communicationLogs, contacts, events, forms, portalTasks, rooms, sessions, submissions, tracks } from "@/db/schema";
import { issuePortalToken, openPortalLoginPayload } from "@/features/auth";
import { tokenIdSchema, type ContactId, type EventId, type TemplateVars } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { formatInZone } from "@/shared/lib/time";
import { escapeHtml } from "./render";
import { signUnsubscribeToken } from "./unsubscribe";

export type OutboxRow = typeof communicationLogs.$inferSelect;

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

function allowlisted(email: string, env: RuntimeEnv): boolean {
  if (env.EMAIL_MODE !== "send" || !env.EMAIL_ALLOWLIST) return true;
  const normalized = email.toLowerCase();
  return env.EMAIL_ALLOWLIST.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    .some((entry) => entry.startsWith("@") ? normalized.endsWith(entry) : normalized === entry);
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

export async function buildContext(row: OutboxRow, dbOrTx: DbOrTx = db, env: RuntimeEnv = getEnv()): Promise<BuiltContext> {
  const [base] = await dbOrTx.select({
    eventName: events.name,
    eventSlug: events.slug,
    eventTimezone: events.timezone,
    eventStartsAt: events.startsAt,
    eventEndsAt: events.endsAt,
    eventLocation: events.location,
    logoFileId: events.logoFileId,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    unsubscribedAt: contacts.unsubscribedAt,
  }).from(events).innerJoin(contacts, and(eq(contacts.eventId, events.id), eq(contacts.id, row.contactId)))
    .where(eq(events.id, row.eventId)).limit(1);
  if (!base) throw new SkipEmail("contact no longer exists");
  if (!allowlisted(base.email, env)) throw new SkipEmail("not in EMAIL_ALLOWLIST");
  if (row.templateKey === "task_reminder" && base.unsubscribedAt) throw new SkipEmail("contact unsubscribed from reminders");

  const contactId = row.contactId as ContactId;
  const eventId = row.eventId as EventId;
  let unsubscribeUrl = `${env.APP_BASE_URL}/portal/${encodeURIComponent(base.eventSlug)}/unsubscribe`;
  if (row.templateKey === "task_reminder") {
    if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for unsubscribe links");
    const unsubscribeToken = await signUnsubscribeToken({ eventId, contactId }, env.SESSION_SECRET);
    unsubscribeUrl += `?token=${encodeURIComponent(unsubscribeToken)}`;
  }
  let magicLink = "";
  let otpCode: string | undefined;
  if (row.templateKey === "portal_login") {
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
      room: rooms.name,
      track: tracks.name,
    }).from(sessions).leftJoin(rooms, and(eq(rooms.id, sessions.roomId), eq(rooms.eventId, sessions.eventId)))
      .leftJoin(tracks, and(eq(tracks.id, sessions.trackId), eq(tracks.eventId, sessions.eventId)))
      .where(and(eq(sessions.id, row.sessionId), eq(sessions.eventId, row.eventId))).limit(1);
    if (!session) throw new SkipEmail("session no longer exists");
    const scheduled = Boolean(session.startsAt && session.endsAt && session.status === "published");
    if (!scheduled) {
      const [existingInvite] = await dbOrTx.select({ lastMethod: calendarInvites.lastMethod }).from(calendarInvites)
        .where(and(
          eq(calendarInvites.eventId, row.eventId),
          eq(calendarInvites.contactId, row.contactId),
          eq(calendarInvites.sessionId, row.sessionId),
        )).limit(1);
      if (existingInvite?.lastMethod !== "request") throw new SkipEmail("session is no longer published and scheduled");
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
  } else {
    vars = { ...common, otp: { code: otpCode } } as TemplateVars;
  }

  if (row.templateKey !== "portal_login") {
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
    ...(templateOverride ? { templateOverride } : {}),
  };
}
