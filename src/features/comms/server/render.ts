import { parseTag } from "xss";
import { TEMPLATE_VAR_SCHEMAS, type TemplateKey, type TemplateVars } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { emailLayout, type EmailLayoutMeta } from "./layout";
import { DEFAULT_TEMPLATES } from "./templates";

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/gu;
// Built by buildOutstandingList from individually escaped task names/dates.
// Built by buildCalendarButtons from individually escaped application URLs.
const PRE_ESCAPED = new Set(["tasks.outstanding_list", "calendar.buttons_html"]);

const COMMON_TOKENS = [
  "event.name", "event.start_date", "event.location", "event.timezone",
  "speaker.first_name", "speaker.last_name", "speaker.email",
  "portal.magic_link", "unsubscribe.url",
] as const;
const ADMIN_AUTH_TOKENS = [
  "event.name", "event.start_date", "event.location", "event.timezone",
  "speaker.first_name", "speaker.last_name", "speaker.email",
  "unsubscribe.url",
  "admin.name", "admin.action_url", "admin.expires_in",
] as const;
const TOKENS_BY_KEY: Record<TemplateKey, readonly string[]> = {
  submission_received: [...COMMON_TOKENS, "submission.title", "submission.code"],
  submission_accepted: [...COMMON_TOKENS, "submission.title", "submission.code"],
  submission_declined: [...COMMON_TOKENS, "submission.title", "submission.code"],
  task_assigned: [...COMMON_TOKENS, "task.name", "task.due_date", "tasks.outstanding_list"],
  task_reminder: [...COMMON_TOKENS, "task.name", "task.due_date", "tasks.outstanding_list"],
  schedule_assigned: [...COMMON_TOKENS, "session.title", "session.start_time_local", "session.end_time_local", "session.timezone", "session.room", "session.track", "calendar.google_url", "calendar.outlook_url", "calendar.download_url", "calendar.buttons_html"],
  schedule_changed: [...COMMON_TOKENS, "session.title", "session.start_time_local", "session.end_time_local", "session.timezone", "session.room", "session.track", "calendar.google_url", "calendar.outlook_url", "calendar.download_url", "calendar.buttons_html"],
  portal_login: [...COMMON_TOKENS, "otp.code"],
  reviewer_invited: [...COMMON_TOKENS, "review.round", "review.queue_url", "review.outstanding", "review.closes_at"],
  review_reminder: [...COMMON_TOKENS, "review.round", "review.queue_url", "review.outstanding", "review.closes_at"],
  // M51 — bulk speaker email offers only the common merge surface.
  speaker_bulk_message: [...COMMON_TOKENS],
  // M42 — admin auth mail. `portal.magic_link` is absent on purpose: these go
  // to an organizer signing in to the admin app, and offering a speaker-portal
  // link as a merge token would let an organizer put a second, month-long
  // credential into a security email. See `TEMPLATE_VAR_SCHEMAS` in contracts.
  admin_password_reset: [...ADMIN_AUTH_TOKENS],
  admin_email_verification: [...ADMIN_AUTH_TOKENS],
  // M44 — team invitations. Same shape as `ADMIN_AUTH_TOKENS`: no
  // `portal.magic_link`, see the doc comment on `organization_invited` in
  // `TEMPLATE_VAR_SCHEMAS`.
  organization_invited: [
    "event.name", "event.start_date", "event.location", "event.timezone",
    "speaker.first_name", "speaker.last_name", "speaker.email",
    "unsubscribe.url",
    "invite.organization_name", "invite.inviter_name", "invite.role", "invite.action_url", "invite.expires_at",
  ],
};

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function decodeEntities(value: string): string {
  return value.replaceAll("&nbsp;", " ").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replace(/&#(\d+);/gu, (_match, code: string) => String.fromCodePoint(Number(code)));
}

export function stripHtml(html: string): string {
  const withLines = html.replace(/<br\s*\/?\s*>/giu, "\n").replace(/<\/p\s*>/giu, "\n");
  const withoutTags = parseTag(withLines, () => "", (value) => value);
  return decodeEntities(withoutTags).replace(/[ \t]+\n/gu, "\n").replace(/\n[ \t]+/gu, "\n").replace(/\n{3,}/gu, "\n\n").replace(/[ \t]{2,}/gu, " ").trim();
}

function resolve(vars: TemplateVars, path: string): string {
  let value: unknown = vars;
  for (const part of path.split(".")) {
    value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[part] : undefined;
  }
  if (value === undefined || value === null || value === "" || typeof value === "object") {
    throw new AppError("TEMPLATE_VAR_MISSING", `missing variable ${path}`);
  }
  const text = String(value);
  return PRE_ESCAPED.has(path) ? text : escapeHtml(text);
}

function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(TOKEN, (_token, path: string) => resolve(vars, path));
}

export function validateTemplateBody(key: TemplateKey, subject: string, body: string): { ok: true } | { ok: false; unknownTokens: string[] } {
  const allowed = new Set(TOKENS_BY_KEY[key]);
  const found = new Set<string>();
  for (const template of [subject, body]) {
    for (const match of template.matchAll(TOKEN)) if (match[1]) found.add(match[1]);
  }
  const unknownTokens = [...found].filter((token) => !allowed.has(token)).sort();
  return unknownTokens.length === 0 ? { ok: true } : { ok: false, unknownTokens };
}

export function renderTemplateContent(key: TemplateKey, subjectTemplate: string, bodyTemplate: string, vars: TemplateVars, layoutMeta?: Partial<EmailLayoutMeta>): { subject: string; html: string; text: string } {
  const validation = validateTemplateBody(key, subjectTemplate, bodyTemplate);
  if (!validation.ok) throw new AppError("TEMPLATE_VAR_MISSING", `unknown template variable ${validation.unknownTokens.join(", ")}`);
  const subject = stripHtml(interpolate(subjectTemplate, vars));
  const body = interpolate(bodyTemplate, vars);
  const parsed = TEMPLATE_VAR_SCHEMAS[key].safeParse(vars);
  if (!parsed.success) {
    const path = parsed.error.issues[0]?.path.join(".") ?? "template context";
    throw new AppError("TEMPLATE_VAR_MISSING", `missing variable ${path}`);
  }
  const eventName = escapeHtml(vars.event.name);
  const html = emailLayout(body, key, {
    eventName,
    ...(layoutMeta?.logoUrl ? { logoUrl: escapeHtml(layoutMeta.logoUrl) } : {}),
    ...(layoutMeta?.unsubscribeUrl ? { unsubscribeUrl: escapeHtml(layoutMeta.unsubscribeUrl) } : {}),
    ...(layoutMeta?.physicalAddress ? { physicalAddress: escapeHtml(layoutMeta.physicalAddress) } : {}),
  });
  const text = stripHtml(html);
  if (!text) throw new AppError("TEMPLATE_VAR_MISSING", "rendered email text is empty");
  return { subject, html, text };
}

export function renderTemplate(key: TemplateKey, vars: TemplateVars): { subject: string; html: string; text: string } {
  const template = DEFAULT_TEMPLATES[key];
  return renderTemplateContent(key, template.subject, template.bodyHtml, vars);
}
