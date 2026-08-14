import { and, eq, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts } from "@/db/schema";
// The `In` variant, not the barrel's `listLog`: this whole read threads a
// single `dbOrTx` through every query (contact, submissions, tasks, comms) so
// a PGlite test can exercise it end to end without a live Neon connection.
import { listLogIn } from "@/features/comms/index.log";
// The client-safe barrel: it re-exports `toPortalStatus` straight off
// `server/guards.ts` with no path back through `server/mutations.ts` (which
// imports `updateContactFields` from this feature's own barrel). Importing the
// full `@/features/submissions` barrel here would close that loop; this import
// carries the exact same function without it.
import { toPortalStatus } from "@/features/submissions/index.client";
import type { CommLogRow, ConfirmationStatus, ContactId, EventId, OutstandingTasksRow, ParticipantRole, SubmissionId, SubmissionStatus } from "@/shared/contracts";
import type { SpeakerRecord } from "../types";
import { stripHtml } from "@/features/comms/index.render";
import { listMyTasksIn } from "../task-runtime/server/queries";

type ContactSpeakerRow = {
  id: string;
  eventId: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  jobTitle: string | null;
  bioHtml: string | null;
  headshotFileId: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  confirmation: SpeakerRecord["confirmation"];
};

export function contactSpeakerRecord(row: ContactSpeakerRow): SpeakerRecord {
  const firstInitial = row.firstName.trim().charAt(0);
  const lastInitial = row.lastName.trim().charAt(0);
  const completed = [row.firstName, row.lastName, row.company, row.jobTitle, row.bioHtml, row.headshotFileId]
    .filter(Boolean).length;
  return {
    id: row.id,
    eventId: row.eventId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    company: row.company ?? "",
    title: row.jobTitle ?? "",
    bio: row.bioHtml ? stripHtml(row.bioHtml) : "",
    location: "",
    website: row.websiteUrl ?? "",
    linkedin: row.linkedinUrl ?? "",
    avatar: `${firstInitial}${lastInitial}`.toUpperCase() || "?",
    avatarColor: "#007454",
    hasHeadshot: row.headshotFileId !== null,
    confirmation: row.confirmation,
    profileCompletion: Math.round((completed / 6) * 100),
    tags: [],
  };
}

export async function getAdminSpeakerIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
): Promise<SpeakerRecord | null> {
  const [row] = await dbOrTx.select({
    id: contacts.id,
    eventId: contacts.eventId,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    company: contacts.company,
    jobTitle: contacts.jobTitle,
    bioHtml: contacts.bioHtml,
    headshotFileId: contacts.headshotFileId,
    linkedinUrl: contacts.linkedinUrl,
    websiteUrl: contacts.websiteUrl,
    confirmation: contacts.confirmationStatus,
  }).from(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId))).limit(1);
  return row ? contactSpeakerRecord(row) : null;
}

export function getAdminSpeaker(eventId: EventId, contactId: ContactId): Promise<SpeakerRecord | null> {
  return getAdminSpeakerIn(db, eventId, contactId);
}

// ---------------------------------------------------------------------------
// M27 — the Speakers admin list and detail reads. Every count here comes off
// the read-model views (`accepted_speakers_v`, `missing_assets_v`,
// `speaker_outstanding_v`) rather than a hand-rolled join, so this table, the
// portal task panel and the dashboard can never disagree about how much work
// a speaker has left (resolution #14's fan-out rule, consumed not re-derived).
// ---------------------------------------------------------------------------

export type ContactFilters = {
  q?: string;
  accepted?: boolean;
  missing?: "bio" | "headshot" | "either";
  confirmation?: ConfirmationStatus;
  sort?: "name" | "openTasks" | "confirmation";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type SpeakerOptionRow = { contactId: ContactId; name: string };

/**
 * Every contact on the event as (id, display name), for the pickers that attach
 * a person to something — the agenda's session dialog and the Add abstract
 * drawer. One query, so those two surfaces cannot disagree about who exists on
 * the event or what they are called.
 *
 * The name falls back to the email rather than to a placeholder: a contact
 * created from an invited speaker's address alone still has to be pickable by
 * something the organizer recognises, and "Unnamed contact" three times over is
 * not a list anyone can choose from.
 */
export async function listSpeakerOptionsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<SpeakerOptionRow[]> {
  const result = await dbOrTx.execute<{ id: string; name: string; email: string }>(sql`
    SELECT id,
           btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) AS name,
           email
    FROM contacts
    WHERE event_id = ${eventId}
    ORDER BY lower(last_name), lower(first_name), email
    LIMIT 500
  `);
  return (result.rows ?? []).map((row) => ({
    contactId: row.id as ContactId,
    name: row.name.trim() || row.email,
  }));
}

export const listSpeakerOptions = (eventId: EventId) => listSpeakerOptionsIn(db, eventId);

export type ContactListRow = {
  contactId: ContactId;
  name: string;
  email: string;
  jobTitle: string | null;
  company: string | null;
  headshotFileId: string | null;
  confirmationStatus: ConfirmationStatus;
  isAcceptedSpeaker: boolean;
  submissionCount: number;
  openTasks: number;
  overdueTasks: number;
  missingBio: boolean;
  missingHeadshot: boolean;
};

type ContactListRawRow = {
  contactId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  company: string | null;
  headshotFileId: string | null;
  confirmationStatus: ConfirmationStatus;
  isAcceptedSpeaker: boolean;
  submissionCount: number | string;
  openTasks: number | string | null;
  overdueTasks: number | string | null;
  missingBio: boolean;
  missingHeadshot: boolean;
};

function toContactListRow(row: ContactListRawRow): ContactListRow {
  return {
    contactId: row.contactId as ContactId,
    // A contact with no name renders their email, not "undefined undefined"
    // (R10) — `name` below is already coalesced to the email in SQL.
    name: row.name,
    email: row.email,
    jobTitle: row.jobTitle,
    company: row.company,
    headshotFileId: row.headshotFileId,
    confirmationStatus: row.confirmationStatus,
    isAcceptedSpeaker: row.isAcceptedSpeaker,
    submissionCount: Number(row.submissionCount ?? 0),
    // `speaker_outstanding_v` has no row for a contact with zero assignments
    // (never an accepted speaker, or an accepted secondary participant who owns none) —
    // that is a legitimate "0 open, 0 overdue", not a missing value (edge
    // case: secondary-participant-only contact in the work order).
    openTasks: Number(row.openTasks ?? 0),
    overdueTasks: Number(row.overdueTasks ?? 0),
    missingBio: row.missingBio,
    missingHeadshot: row.missingHeadshot,
  };
}

/**
 * Shared by the list and the detail read so the two can never disagree about a
 * row's shape. `nameSort` rides along only so `ORDER BY` can reference it —
 * Postgres resolves a *bare* output alias in `ORDER BY` against the SELECT
 * list, but the moment that alias is wrapped in an expression (`lower(name)`)
 * it goes back to resolving against the FROM-list instead, where no such
 * column exists.
 */
const CONTACT_SELECT_BASE = sql`
  c.id AS "contactId",
  coalesce(nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.email) AS name,
  lower(coalesce(nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.email)) AS "nameSort",
  c.email,
  c.job_title AS "jobTitle",
  c.company,
  c.headshot_file_id AS "headshotFileId",
  c.confirmation_status AS "confirmationStatus",
  (asv.contact_id IS NOT NULL) AS "isAcceptedSpeaker",
  coalesce(sc.n, 0)::int AS "submissionCount",
  so.open_count AS "openTasks",
  so.overdue_count AS "overdueTasks",
  coalesce(ma.missing_bio, false) AS "missingBio",
  coalesce(ma.missing_headshot, false) AS "missingHeadshot"
`;

const CONTACT_JOINS = sql`
  FROM contacts c
  LEFT JOIN accepted_speakers_v asv ON asv.event_id = c.event_id AND asv.contact_id = c.id
  LEFT JOIN missing_assets_v ma ON ma.event_id = c.event_id AND ma.contact_id = c.id
  LEFT JOIN speaker_outstanding_v so ON so.event_id = c.event_id AND so.contact_id = c.id
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS n FROM submission_participants sp WHERE sp.event_id = c.event_id AND sp.contact_id = c.id
  ) sc ON true
`;

function contactFilterClauses(eventId: EventId, filters: ContactFilters): SQL[] {
  const clauses = [sql`c.event_id = ${eventId}`];
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    clauses.push(sql`lower(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'') || ' ' || c.email) LIKE ${`%${q}%`}`);
  }
  if (filters.accepted) clauses.push(sql`asv.contact_id IS NOT NULL`);
  if (filters.missing === "bio") clauses.push(sql`ma.missing_bio IS TRUE`);
  else if (filters.missing === "headshot") clauses.push(sql`ma.missing_headshot IS TRUE`);
  else if (filters.missing === "either") clauses.push(sql`(ma.missing_bio IS TRUE OR ma.missing_headshot IS TRUE)`);
  if (filters.confirmation) clauses.push(sql`c.confirmation_status = ${filters.confirmation}`);
  return clauses;
}

/** Sorting by `openTasks` puts nulls (never-assigned contacts) last, in either direction. */
function contactOrderClause(sort: ContactFilters["sort"], dir: ContactFilters["dir"]): SQL {
  const direction = dir === "desc" ? sql`DESC` : sql`ASC`;
  if (sort === "openTasks") return sql`so.open_count ${direction} NULLS LAST, "nameSort" ASC`;
  if (sort === "confirmation") return sql`c.confirmation_status ${direction}, "nameSort" ASC`;
  return sql`"nameSort" ${direction}`;
}

export async function listContactsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: ContactFilters = {},
): Promise<{ rows: ContactListRow[]; total: number }> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const where = sql.join(contactFilterClauses(eventId, filters), sql` AND `);
  const order = contactOrderClause(filters.sort, filters.dir);

  const result = await dbOrTx.execute<ContactListRawRow & { total: number | string }>(sql`
    SELECT ${CONTACT_SELECT_BASE}, count(*) OVER ()::int AS total
    ${CONTACT_JOINS}
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
  const raw = result.rows ?? [];

  // The window count rides on the returned rows; a page past the end (or a
  // filter with zero matches) has nothing to ride on, so ask separately —
  // otherwise a narrowed filter reports total=0 with no way to tell "no
  // matches" from "matches exist, just not on this page".
  let total = Number(raw[0]?.total ?? 0);
  if (raw.length === 0) {
    const counted = await dbOrTx.execute<{ total: number | string }>(sql`
      SELECT count(*)::int AS total ${CONTACT_JOINS} WHERE ${where}
    `);
    total = Number((counted.rows ?? [])[0]?.total ?? 0);
  }

  return { rows: raw.map(toContactListRow), total };
}

export function listContacts(eventId: EventId, filters: ContactFilters = {}): Promise<{ rows: ContactListRow[]; total: number }> {
  return listContactsIn(db, eventId, filters);
}

export type SpeakerDetailDTO = {
  contact: ContactListRow & {
    bioHtml: string | null;
    pronouns: string | null;
    gender: string | null;
    salutation: string | null;
    links: { linkedin: string | null; twitter: string | null; facebook: string | null; website: string | null };
    unsubscribedAt: string | null;
  };
  submissions: Array<{ submissionId: SubmissionId; code: number; title: string; portalStatus: ReturnType<typeof toPortalStatus>; isPrimary: boolean; role: ParticipantRole }>;
  tasks: Array<{ taskId: string; name: string; submissionId: SubmissionId | null; dueAt: string | null; completed: boolean; overdue: boolean }>;
  comms: CommLogRow[];
};

type SpeakerDetailContactRow = ContactListRawRow & {
  bioHtml: string | null;
  pronouns: string | null;
  gender: string | null;
  salutation: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
  unsubscribedAt: string | Date | null;
};

type SubmissionRow = { submissionId: string; code: number | string; title: string; status: SubmissionStatus; isPrimary: boolean; role: ParticipantRole };

/**
 * (eventId, contactId) scoped together (R4) — a contact id from another event
 * returns null here, which every caller (the route, the page) turns into a 404
 * rather than another event's row.
 */
export async function getSpeakerDetailIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<SpeakerDetailDTO | null> {
  const contactResult = await dbOrTx.execute<SpeakerDetailContactRow>(sql`
    SELECT ${CONTACT_SELECT_BASE},
      c.bio_html AS "bioHtml", c.pronouns, c.gender, c.salutation,
      c.linkedin_url AS "linkedinUrl", c.twitter_url AS "twitterUrl", c.facebook_url AS "facebookUrl", c.website_url AS "websiteUrl",
      c.unsubscribed_at AS "unsubscribedAt"
    ${CONTACT_JOINS}
    WHERE c.event_id = ${eventId} AND c.id = ${contactId}
    LIMIT 1
  `);
  const [row] = contactResult.rows ?? [];
  if (!row) return null;

  const submissionsResult = await dbOrTx.execute<SubmissionRow>(sql`
    SELECT s.id AS "submissionId", s.code, s.title, s.status, sp.is_primary AS "isPrimary", sp.role
    FROM submission_participants sp
    JOIN submissions s ON s.id = sp.submission_id AND s.event_id = sp.event_id
    WHERE sp.event_id = ${eventId} AND sp.contact_id = ${contactId}
    ORDER BY sp.is_primary DESC, s.code ASC
  `);

  // Tasks come straight off `task_assignments_v` via the portal's own task
  // runtime query — the same one a speaker's own Tasks page reads — so an
  // organizer never sees a different "0 of 0" than the speaker does.
  const tasks = await listMyTasksIn(dbOrTx, eventId, contactId);
  // Real comms history (M34 is merged): the same `listLog` the comms admin
  // audit view reads, scoped to this contact.
  const comms = await listLogIn(dbOrTx, eventId, { contactId });

  return {
    contact: {
      ...toContactListRow(row),
      bioHtml: row.bioHtml,
      pronouns: row.pronouns,
      gender: row.gender,
      salutation: row.salutation,
      links: { linkedin: row.linkedinUrl, twitter: row.twitterUrl, facebook: row.facebookUrl, website: row.websiteUrl },
      unsubscribedAt: row.unsubscribedAt ? new Date(row.unsubscribedAt).toISOString() : null,
    },
    submissions: (submissionsResult.rows ?? []).map((submission) => ({
      submissionId: submission.submissionId as SubmissionId,
      code: Number(submission.code),
      title: submission.title,
      // Queue states never leak here either — the same mapping the abstracts
      // table and the portal use, imported rather than reimplemented.
      portalStatus: toPortalStatus(submission.status),
      isPrimary: submission.isPrimary,
      role: submission.role,
    })),
    tasks: tasks.map((task) => ({
      taskId: task.taskId,
      name: task.taskName,
      submissionId: task.submissionId as SubmissionId | null,
      dueAt: task.dueAt,
      completed: task.completed,
      overdue: task.overdue,
    })),
    comms,
  };
}

export function getSpeakerDetail(eventId: EventId, contactId: ContactId): Promise<SpeakerDetailDTO | null> {
  return getSpeakerDetailIn(db, eventId, contactId);
}

/**
 * The `OutstandingTasksRow` read (M02 §11), owned here because this module
 * already joins `speaker_outstanding_v` for the Tasks column. `/api/v1`'s
 * `/speakers/outstanding-tasks` publishes a different shape — it adds `email`
 * and drops `doneCount` — so it keeps its own projection; what must not drift
 * is the counting rule, and both read the same view with the same
 * `open_count > 0` restriction ("outstanding", not "every assignee") and the
 * same tie-break order.
 *
 * `name` is coalesced to the email exactly as `CONTACT_SELECT_BASE` does, so a
 * contact with no name renders their email here too rather than a blank.
 */
export async function getOutstandingTasksViewIn(dbOrTx: DbOrTx, eventId: EventId): Promise<OutstandingTasksRow[]> {
  const result = await dbOrTx.execute<{
    contactId: string;
    name: string;
    openCount: number | string;
    overdueCount: number | string;
    doneCount: number | string;
  }>(sql`
    SELECT c.id AS "contactId",
      coalesce(nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), c.email) AS name,
      so.open_count AS "openCount",
      so.overdue_count AS "overdueCount",
      so.done_count AS "doneCount"
    FROM speaker_outstanding_v so
    JOIN contacts c ON c.id = so.contact_id AND c.event_id = so.event_id
    WHERE so.event_id = ${eventId} AND so.open_count > 0
    ORDER BY so.open_count DESC, so.overdue_count DESC, name ASC, c.id ASC
  `);
  return (result.rows ?? []).map((row) => ({
    contactId: row.contactId as ContactId,
    name: row.name,
    openCount: Number(row.openCount ?? 0),
    overdueCount: Number(row.overdueCount ?? 0),
    doneCount: Number(row.doneCount ?? 0),
  }));
}

export function getOutstandingTasksView(eventId: EventId): Promise<OutstandingTasksRow[]> {
  return getOutstandingTasksViewIn(db, eventId);
}
