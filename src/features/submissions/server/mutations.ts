import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import { rowsOf } from "@/db/query-result";
import { contacts, emailTemplates, events, forms, submissionAnswers, submissionParticipants, submissionTags, submissions } from "@/db/schema";
import {
  LIMITS,
  acceptedForSchedulingRowSchema,
  answerValueSchema,
  formIdSchema,
  idem,
  type AcceptedForSchedulingRow,
  type AnswerValue,
  type CleanAnswers,
  type ContactId,
  type CreateSubmissionInput,
  type EventId,
  type FormId,
  type SubmissionKind,
  type SubmissionId,
  type SubmissionStatus,
  type UserId,
} from "@/shared/contracts";
import {
  deriveMappedFields,
  getPinnedSnapshotIn,
  secondaryParticipantRoleSchema,
  type SecondaryParticipantRole,
} from "@/features/forms/index.submission";
import { getOrCreateContact, updateContactFields } from "@/features/portal";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { formatInZone } from "@/shared/lib/time";
import { renderTemplateContent } from "@/features/comms/server/render";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { assertTransition } from "./guards";
import type { SubmissionFieldPatch } from "./filters";
export { formatCode } from "./guards";

/**
 * The result shape M18 publishes. Contracts froze the *input* verbatim but not
 * this, so it lives with its only producer rather than being invented twice.
 */
export type CreateSubmissionResult = {
  submissionId: SubmissionId;
  code: number;
  status: SubmissionStatus;
  promotedFromDraft: boolean;
};

export type DraftParticipantInput = {
  clientId: string;
  email: string;
  role: SecondaryParticipantRole;
  isPrimary: false;
  sortOrder: number;
  answers: CleanAnswers;
};

/**
 * The only file in the repository that inserts into `submissions`. Six callers
 * across four lanes go through these functions, which is what keeps the code
 * allocation, the limit rule and the outbox write from being reimplemented
 * three different ways.
 */

/**
 * The one code allocator. It runs inside the caller's transaction — hence the
 * `tx` first argument — because the sequence bump and the insert that uses it
 * have to be atomic, or two simultaneous submits get the same code and the
 * `UNIQUE (event_id, code)` index rejects one of them at random.
 */
export async function nextSubmissionCode(tx: TxDb, eventId: EventId): Promise<number> {
  const result = await tx.execute<{ submission_seq: number }>(sql`
    UPDATE events SET submission_seq = submission_seq + 1 WHERE id = ${eventId} RETURNING submission_seq
  `);
  const code = (result.rows ?? [])[0]?.submission_seq;
  if (code === undefined) throw new AppError("NOT_FOUND", "Event not found");
  return Number(code);
}

type FormRow = { id: string; kind: SubmissionKind; sendConfirmation: boolean; submissionLimit: number | null };

async function loadForm(tx: TxDb, eventId: EventId, formId: FormId): Promise<FormRow> {
  const [form] = await tx
    .select({ id: forms.id, kind: forms.kind, sendConfirmation: forms.sendConfirmation, submissionLimit: forms.submissionLimit })
    .from(forms)
    .where(and(eq(forms.id, formId), eq(forms.eventId, eventId)))
    .limit(1);
  if (!form) throw new AppError("NOT_FOUND", "Form not found");
  return form;
}

/** Openness is decided by the database clock, never by the client's. */
async function assertFormOpen(tx: TxDb, formId: FormId): Promise<void> {
  const result = await tx.execute<{ open: boolean | null }>(sql`SELECT is_form_open(${formId}) AS open`);
  if ((result.rows ?? [])[0]?.open !== true) {
    throw new AppError("FORM_CLOSED", "This form is no longer accepting submissions");
  }
}

/**
 * Drafts never consume the limit — a speaker who starts three drafts has still
 * submitted nothing.
 */
async function assertUnderLimit(
  tx: TxDb,
  eventId: EventId,
  formId: FormId,
  contactId: ContactId,
  formLimit: number | null,
  eventCap: number,
): Promise<void> {
  const limit = formLimit ?? eventCap;
  const result = await tx.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count FROM submissions
    WHERE event_id = ${eventId} AND form_id = ${formId} AND submitter_contact_id = ${contactId}
      AND status NOT IN ('draft', 'withdrawn')
  `);
  const used = Number((result.rows ?? [])[0]?.count ?? 0);
  if (used >= limit) {
    throw new AppError("LIMIT_REACHED", `You have reached the limit of ${limit} submissions for this form`);
  }
}

function assertOnePrimary(participants: CreateSubmissionInput["participants"]): void {
  const primaries = participants.filter((participant) => participant.isPrimary);
  if (participants.length > 0 && primaries.length !== 1) {
    throw new AppError("VALIDATION", "A submission needs exactly one primary participant");
  }
}

async function writeParticipants(tx: TxDb, eventId: EventId, submissionId: string, input: CreateSubmissionInput): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const participant of input.participants) {
    const [row] = await tx.insert(submissionParticipants).values({
      eventId,
      submissionId,
      contactId: participant.contactId,
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: participant.sortOrder,
    }).onConflictDoUpdate({
      target: [submissionParticipants.submissionId, submissionParticipants.contactId],
      set: { role: participant.role, isPrimary: participant.isPrimary, sortOrder: participant.sortOrder },
    }).returning({ id: submissionParticipants.id, contactId: submissionParticipants.contactId });
    if (!row) throw new AppError("INTERNAL", "Could not store a submission participant");
    ids.set(row.contactId, row.id);
  }
  return ids;
}

async function replaceAnswers(
  tx: TxDb,
  eventId: EventId,
  submissionId: string,
  answers: CleanAnswers,
  participantIds: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  // Draft saves and final submit are snapshots, not patches. Removing rows first
  // also discards an answer to a question that has since become hidden.
  await tx.delete(submissionAnswers).where(eq(submissionAnswers.submissionId, submissionId));
  await insertAnswers(tx, eventId, submissionId, answers, participantIds);
}

async function insertAnswers(
  tx: TxDb,
  eventId: EventId,
  submissionId: string,
  answers: CleanAnswers,
  participantIds: ReadonlyMap<string, string> = new Map(),
): Promise<void> {
  // One statement, not one per answer. This runs inside the transaction holding
  // the event row's FOR UPDATE lock, over a per-transaction WebSocket pool, so
  // every extra round trip here is time no other submit on this event can use.
  // A single INSERT cannot touch one conflict target twice, which the old
  // row-at-a-time loop tolerated. Nothing here has to collapse duplicates:
  // CleanAnswers is branded, and its schema already rejects a repeated
  // field/participant pair before a caller can reach this function.
  if (answers.length === 0) return;

  const values = answers.map((answer) => {
    const participantId = answer.participantId ? participantIds.get(answer.participantId) : null;
    if (answer.participantId && !participantId) {
      throw new AppError("VALIDATION", "An answer belongs to an unknown participant");
    }
    return sql`(
      ${eventId}, ${submissionId}, ${answer.fieldId},
      ${participantId ?? null}::uuid, ${JSON.stringify(answer.value)}::jsonb
    )`;
  });
  await tx.execute(sql`
    INSERT INTO submission_answers (event_id, submission_id, field_id, participant_id, value)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (submission_id, field_id, participant_id)
    DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `);
}

/**
 * Routing stamps on create only. `updateSubmissionFromCfp` never re-runs it: an
 * organizer who re-routes a submission by hand must not have that undone the
 * next time the speaker edits a typo.
 */
async function writeTags(tx: TxDb, eventId: EventId, submissionId: string, input: CreateSubmissionInput): Promise<void> {
  const tagIds = new Set([...(input.routing?.addTagIds ?? []), ...(input.tagIds ?? [])]);
  for (const tagId of tagIds) {
    await tx.insert(submissionTags)
      .values({ eventId, submissionId, tagId })
      .onConflictDoNothing();
  }
}

function submissionColumns(input: CreateSubmissionInput) {
  const title = input.fields.title.slice(0, LIMITS.TITLE);
  return {
    title,
    descriptionHtml: input.fields.descriptionHtml ? sanitize(input.fields.descriptionHtml) : null,
    trackId: input.routing?.setTrackId ?? input.fields.trackId ?? null,
    formatId: input.fields.formatId ?? null,
    level: input.fields.level ?? null,
    language: input.fields.language ?? null,
    capacity: input.fields.capacity ?? null,
    startsAt: input.fields.startsAt ?? null,
    endsAt: input.fields.endsAt ?? null,
    clientSessionId: input.fields.clientSessionId ?? null,
  };
}

export async function createSubmissionIn(tx: TxDb, eventId: EventId, input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  assertOnePrimary(input.participants);
  const status: SubmissionStatus = input.initialStatus ?? "pending";

  // Serializes submits per event, which is what closes the two-tab race on the
  // limit check and on the code sequence.
  const [event] = await tx.execute<{ id: string; submission_cap_per_user: number }>(sql`
    SELECT id, submission_cap_per_user FROM events WHERE id = ${eventId} FOR UPDATE
  `).then((result) => result.rows ?? []);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  // Organizer-created abstracts have no speaker draft to promote, so their
  // client-generated row id is the replay key. The event lock above serializes
  // concurrent retries; a committed first attempt is returned before another
  // code, participant set, or tag set can be allocated.
  if (input.requestedSubmissionId) {
    if (input.source !== "manual") {
      throw new AppError("VALIDATION", "Only organizer-created abstracts can supply a creation request ID");
    }
    const replay = (await tx.execute<{ event_id: string; code: number; status: SubmissionStatus; source: string }>(sql`
      SELECT event_id, code, status, source
      FROM submissions
      WHERE id = ${input.requestedSubmissionId}
      FOR UPDATE
    `)).rows?.[0];
    if (replay) {
      if (replay.event_id !== eventId || replay.source !== "manual") {
        throw new AppError("CONFLICT", "That abstract creation request was already used");
      }
      return {
        submissionId: input.requestedSubmissionId,
        code: Number(replay.code),
        status: replay.status,
        promotedFromDraft: false,
      };
    }
  }

  // Idempotency precedes mutable deadline and limit gates. A response can be
  // lost after commit; retrying that exact draft must return the committed row,
  // even if the form closed or the first submit consumed the final slot.
  if (input.draftSubmissionId) {
    const alreadySubmitted = (await tx.execute<{ id: string; code: number; status: SubmissionStatus }>(sql`
      SELECT id, code, status FROM submissions
      WHERE id = ${input.draftSubmissionId} AND event_id = ${eventId} AND status <> 'draft'
      FOR UPDATE
    `)).rows?.[0];
    if (alreadySubmitted) {
      return {
        submissionId: alreadySubmitted.id as SubmissionId,
        code: Number(alreadySubmitted.code),
        status: alreadySubmitted.status,
        promotedFromDraft: true,
      };
    }
  }

  let form: FormRow | null = null;
  if (input.formId) {
    form = await loadForm(tx, eventId, input.formId);
    if (input.enforce?.deadline !== false) await assertFormOpen(tx, input.formId);
    if (input.enforce?.limit !== false && input.submitterContactId) {
      await assertUnderLimit(tx, eventId, input.formId, input.submitterContactId, form.submissionLimit, Number(event.submission_cap_per_user));
    }
  }
  // A form-backed submission inherits the form's configured kind. Keeping an
  // independent caller value here would allow a form foreign key and its
  // submission kind to contradict each other.
  const kind = form?.kind ?? input.kind;

  const columns = submissionColumns(input);

  // Draft promotion keeps the code the speaker has already been shown. A new
  // one here would renumber their submission between the wizard and the
  // confirmation email.
  //
  // Only a CFP submit promotes: an organizer adding an abstract by hand must
  // not silently overwrite the draft a speaker is still working on.
  let promotedFromDraft = false;
  let submissionId: string;
  let code: number;
  const draft = input.source === "cfp" && input.formId && input.submitterContactId
    ? (await tx.execute<{ id: string; code: number }>(sql`
      SELECT id, code FROM submissions
      WHERE event_id = ${eventId} AND form_id = ${input.formId}
        AND submitter_contact_id = ${input.submitterContactId} AND status = 'draft'
      FOR UPDATE
    `)).rows?.[0]
    : undefined;

  if (draft) {
    promotedFromDraft = true;
    submissionId = draft.id;
    code = Number(draft.code);
    // Give callers the same stable AppError as every other lifecycle mutation;
    // do not defer illegal draft jumps to the database trigger.
    assertTransition("draft", status);
    await tx.update(submissions).set({
      ...columns,
      status,
      formVersion: input.formVersion,
      source: input.source,
      kind,
      // A promotion that stays a draft has not been submitted, so it must not
      // carry a submitted_at that every downstream sort trusts.
      ...(status === "draft" ? {} : { submittedAt: new Date() }),
      rowVersion: sql`${submissions.rowVersion} + 1`,
      updatedAt: new Date(),
    }).where(eq(submissions.id, submissionId));
  } else {
    code = await nextSubmissionCode(tx, eventId);
    const [inserted] = await tx.insert(submissions).values({
      ...(input.requestedSubmissionId ? { id: input.requestedSubmissionId } : {}),
      eventId,
      formId: input.formId,
      formVersion: input.formVersion,
      code,
      kind,
      status,
      source: input.source,
      submitterContactId: input.submitterContactId,
      ...(status === "draft" ? {} : { submittedAt: new Date() }),
      ...columns,
    }).returning({ id: submissions.id });
    if (!inserted) throw new AppError("INTERNAL", "Could not create the submission");
    submissionId = inserted.id;
  }

  const participantIds = await writeParticipants(tx, eventId, submissionId, input);
  await replaceAnswers(tx, eventId, submissionId, input.answers, participantIds);
  await writeTags(tx, eventId, submissionId, input);

  // The per-form toggle decides for CFP submits, because M16 never passes the
  // flag — which is why turning it off in form settings really does mean zero
  // rows here.
  const sendConfirmation = input.sendConfirmation ?? form?.sendConfirmation ?? true;
  if (sendConfirmation && status !== "draft" && input.submitterContactId) {
    await enqueueEmail(tx, {
      eventId,
      templateKey: "submission_received",
      contactId: input.submitterContactId,
      idempotencyKey: idem.received(eventId, submissionId as SubmissionId),
      refs: { submissionId: submissionId as SubmissionId },
    });
  }

  return { submissionId: submissionId as SubmissionId, code, status, promotedFromDraft };
}

export function createSubmission(eventId: EventId, input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  return withTx((tx) => createSubmissionIn(tx, eventId, input));
}

/**
 * The CFP Account step calls this, so the server draft exists — and has its code
 * — from the moment a speaker gives their email, rather than only at submit.
 * Calling it again is the same row: one draft per (form, contact).
 */
export async function upsertDraft(
  eventId: EventId,
  contactId: ContactId,
  formId: FormId,
  formVersion: number,
): Promise<{
  submissionId: SubmissionId;
  code: number;
  answers: Record<string, AnswerValue>;
  participants: Array<Pick<DraftParticipantInput, "clientId" | "email" | "role" | "isPrimary" | "sortOrder"> & { answers: Record<string, AnswerValue> }>;
}> {
  return withTx(async (tx) => {
    // The form_id foreign key proves the form exists, not that it belongs to
    // this event — without this a caller could start a draft against another
    // event's form and the row would look legitimate.
    const form = await loadForm(tx, eventId, formId);
    // Starting (or resuming) a draft is itself a write against the form, so it
    // must agree with the other three call sites: the database clock decides,
    // via the same is_form_open() predicate, never a JS comparison (S2).
    await assertFormOpen(tx, formId);

    const existing = (await tx.execute<{ id: string; code: number }>(sql`
      SELECT id, code FROM submissions
      WHERE event_id = ${eventId} AND form_id = ${formId} AND submitter_contact_id = ${contactId} AND status = 'draft'
      FOR UPDATE
    `)).rows?.[0];

    if (existing) {
      await tx.update(submissions)
        .set({ formVersion, kind: form.kind, updatedAt: new Date() })
        .where(eq(submissions.id, existing.id));
      const rows = await tx.select({ fieldId: submissionAnswers.fieldId, value: submissionAnswers.value })
        .from(submissionAnswers)
        .where(and(eq(submissionAnswers.submissionId, existing.id), isNull(submissionAnswers.participantId)));
      const participantRows = await tx.select({
        id: submissionParticipants.id,
        email: contacts.email,
        role: submissionParticipants.role,
        isPrimary: submissionParticipants.isPrimary,
        sortOrder: submissionParticipants.sortOrder,
      })
        .from(submissionParticipants)
        .innerJoin(contacts, and(eq(contacts.id, submissionParticipants.contactId), eq(contacts.eventId, submissionParticipants.eventId)))
        .where(and(eq(submissionParticipants.submissionId, existing.id), eq(submissionParticipants.eventId, eventId), eq(submissionParticipants.isPrimary, false)))
        .orderBy(submissionParticipants.sortOrder);
      const participantAnswerRows = await tx.select({
        participantId: submissionAnswers.participantId,
        fieldId: submissionAnswers.fieldId,
        value: submissionAnswers.value,
      })
        .from(submissionAnswers)
        .where(eq(submissionAnswers.submissionId, existing.id));
      const answersByParticipant = new Map<string, Record<string, AnswerValue>>();
      for (const row of participantAnswerRows) {
        if (!row.participantId) continue;
        const answers = answersByParticipant.get(row.participantId) ?? {};
        answers[row.fieldId] = answerValueSchema.parse(row.value);
        answersByParticipant.set(row.participantId, answers);
      }
      return {
        submissionId: existing.id as SubmissionId,
        code: Number(existing.code),
        answers: Object.fromEntries(rows.map((row) => [row.fieldId, answerValueSchema.parse(row.value)])),
        participants: participantRows.map((row) => ({
          clientId: row.id,
          email: row.email,
          role: secondaryParticipantRoleSchema.parse(row.role),
          isPrimary: false as const,
          sortOrder: row.sortOrder,
          answers: answersByParticipant.get(row.id) ?? {},
        })),
      };
    }

    // FOR UPDATE cannot lock a row that does not exist, so two first-time calls
    // both reach here. The partial unique index is what actually decides;
    // ON CONFLICT turns the loser into a read instead of a duplicate-key error.
    const code = await nextSubmissionCode(tx, eventId);
    const upserted = (await tx.execute<{ id: string; code: number }>(sql`
      INSERT INTO submissions (event_id, form_id, form_version, code, kind, status, source, submitter_contact_id, title)
      VALUES (${eventId}, ${formId}, ${formVersion}, ${code}, ${form.kind}, 'draft', 'cfp', ${contactId}, '')
      ON CONFLICT (event_id, form_id, submitter_contact_id) WHERE status = 'draft' AND form_id IS NOT NULL AND submitter_contact_id IS NOT NULL
      DO UPDATE SET form_version = EXCLUDED.form_version, kind = EXCLUDED.kind, updated_at = now()
      RETURNING id, code
    `)).rows?.[0];
    const inserted = upserted ? { id: upserted.id, code: Number(upserted.code) } : undefined;
    if (!inserted) throw new AppError("INTERNAL", "Could not start the draft");

    await tx.insert(submissionParticipants).values({
      eventId,
      submissionId: inserted.id,
      contactId,
      role: "speaker",
      isPrimary: true,
      sortOrder: 0,
    }).onConflictDoNothing();

    // The losing racer's allocated code is simply unused; a gap in the sequence
    // costs nothing, a duplicate submission costs a speaker their proposal.
    return { submissionId: inserted.id as SubmissionId, code: inserted.code, answers: {}, participants: [] };
  });
}

/**
 * Replace an authenticated speaker's incomplete draft answers.
 *
 * `saved: false` is the already-submitted case. Submit promotes the draft row
 * in place, so the wizard's last debounced autosave can arrive after the
 * promotion has happened — a race the client also guards, but which the network
 * can produce on its own. That is not a failure to report to a speaker who has
 * just seen their confirmation code: the answers being written are the ones
 * already committed, so this reports the promoted row and writes nothing. A
 * speaker with no submission at all for this form still gets `NOT_FOUND`.
 */
export async function saveDraftAnswers(
  eventId: EventId,
  contactId: ContactId,
  formId: FormId,
  formVersion: number,
  answers: CleanAnswers,
  participants?: DraftParticipantInput[],
): Promise<{ submissionId: SubmissionId; saved: boolean }> {
  return withTx(async (tx) => {
    const draft = (await tx.execute<{ id: string }>(sql`
      SELECT id FROM submissions
      WHERE event_id = ${eventId} AND form_id = ${formId}
        AND submitter_contact_id = ${contactId} AND status = 'draft'
      FOR UPDATE
    `)).rows?.[0];
    if (!draft) {
      const committed = (await tx.execute<{ id: string }>(sql`
        SELECT id FROM submissions
        WHERE event_id = ${eventId} AND form_id = ${formId}
          AND submitter_contact_id = ${contactId} AND status <> 'draft'
        ORDER BY created_at DESC
        LIMIT 1
      `)).rows?.[0];
      if (!committed) throw new AppError("NOT_FOUND", "Draft not found");
      return { submissionId: committed.id as SubmissionId, saved: false };
    }
    // Same is_form_open() predicate as the other three write paths (S2):
    // a draft that is still open when the speaker loaded the page can go
    // stale mid-edit, and the autosave must stop writing once it does.
    await assertFormOpen(tx, formId);
    const participantIds = new Map<string, string>();
    if (participants) {
      const emails = new Set<string>();
      const clientIds = new Set<string>();
      await tx.delete(submissionParticipants).where(and(
        eq(submissionParticipants.submissionId, draft.id),
        eq(submissionParticipants.isPrimary, false),
      ));
      for (const participant of participants) {
        const email = participant.email.trim().toLowerCase();
        if (!email || emails.has(email)) throw new AppError("VALIDATION", "Participant emails must be unique");
        if (clientIds.has(participant.clientId)) throw new AppError("VALIDATION", "Participant client IDs must be unique");
        emails.add(email);
        clientIds.add(participant.clientId);
        const participantContactId = await getOrCreateContact(tx, eventId, email);
        if (participantContactId === contactId) throw new AppError("VALIDATION", "Participant emails must be unique");
        const [row] = await tx.insert(submissionParticipants).values({
          eventId,
          submissionId: draft.id,
          contactId: participantContactId,
          role: participant.role,
          isPrimary: false,
          sortOrder: participant.sortOrder,
        }).returning({ id: submissionParticipants.id });
        if (!row) throw new AppError("INTERNAL", "Could not store a draft participant");
        participantIds.set(participant.clientId, row.id);
      }
    }
    await replaceAnswers(tx, eventId, draft.id, answers, participantIds);
    await tx.update(submissions)
      .set({ formVersion, updatedAt: new Date() })
      .where(eq(submissions.id, draft.id));
    return { submissionId: draft.id as SubmissionId, saved: true };
  });
}

export type TransitionResult = { changed: SubmissionId[]; stale: SubmissionId[] };

/**
 * Guarded bulk transition. `expectedFrom` is what the organizer's screen showed;
 * a row that has moved since is reported `stale` rather than overwritten, which
 * is the difference between two organizers working the queue together and one of
 * them silently undoing the other.
 *
 * The SET clause mirrors what the database trigger does on a final→non-final
 * move, so the application and the trigger agree instead of fighting: undoing a
 * decision clears `notified_at` and bumps `notify_revision`, which is what makes
 * a later re-notify a *new* email rather than a suppressed duplicate.
 */
export async function transitionStatus(
  eventId: EventId,
  ids: SubmissionId[],
  to: SubmissionStatus,
  expectedFrom: SubmissionStatus | SubmissionStatus[],
  actorUserId: UserId | null = null,
): Promise<TransitionResult> {
  if (ids.length === 0) return { changed: [], stale: [] };
  const from = Array.isArray(expectedFrom) ? expectedFrom : [expectedFrom];
  // A friendly error before the trigger's 23514, for the cases a UI can prevent.
  for (const source of from) assertTransition(source, to);

  const updated = await db.execute<{ id: string }>(sql`
    WITH audit_context AS (
      SELECT
        set_config('openboard.submission_status_source', ${actorUserId ? "organizer" : "system"}, true),
        set_config('openboard.actor_user_id', ${actorUserId ?? ""}, true),
        set_config('openboard.actor_contact_id', '', true)
    ), changed AS (
      UPDATE submissions SET
        status = ${to},
        row_version = row_version + 1,
        updated_at = now(),
        notified_at = CASE WHEN status IN ('accepted','declined') AND ${to} NOT IN ('accepted','declined') THEN NULL ELSE notified_at END,
        notify_revision = notify_revision + CASE WHEN status IN ('accepted','declined') AND ${to} NOT IN ('accepted','declined') THEN 1 ELSE 0 END
      FROM audit_context
      WHERE event_id = ${eventId}
        AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND status IN (${sql.join(from.map((status) => sql`${status}`), sql`, `)})
      RETURNING submissions.id
    )
    SELECT id FROM changed
  `);

  const changed = (updated.rows ?? []).map((row: { id: string }) => row.id as SubmissionId);
  const changedSet = new Set<string>(changed);
  return { changed, stale: ids.filter((id) => !changedSet.has(id)) };
}

export type NotifyResult = {
  accepted: SubmissionId[];
  declined: SubmissionId[];
  emailsQueued: number;
  skippedNoRecipient: SubmissionId[];
};

export type DecisionEmailPreviewSample = {
  decision: "accepted" | "declined";
  recipientName: string;
  recipientEmail: string;
  submissionTitle: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  templateEnabled: boolean;
};

export type NotifyPreview = {
  accepted: number;
  declined: number;
  emailsQueued: number;
  skippedNoRecipient: number;
  queueRevision: string;
  samples: DecisionEmailPreviewSample[];
};

type PreviewQueueRow = {
  id: string;
  status: "accept_queue" | "decline_queue";
  title: string;
  code: number;
  notifyRevision: number;
  recipientId: string | null;
};

type QueueRevisionRow = Pick<PreviewQueueRow, "id" | "status" | "notifyRevision">;

function decisionQueueRevision(rows: QueueRevisionRow[]): string {
  return rows
    .map((row) => `${row.status}:${row.id}:${row.notifyRevision}`)
    .sort()
    .join("|") || "empty";
}

/**
 * Read-only decision-email preflight. It uses the current queue rows, current
 * recipient records, and current templates, but deliberately does not mint a
 * portal credential. Preview-only links are visibly marked in the UI and are
 * replaced by fresh per-recipient links when the outbox actually renders.
 */
export async function previewNotifyQueuesIn(dbOrTx: DbOrTx, eventId: EventId): Promise<NotifyPreview> {
  const queueResult = await dbOrTx.execute(sql`
    SELECT s.id, s.status, s.title, s.code, s.notify_revision AS "notifyRevision",
      COALESCE(s.submitter_contact_id, (
        SELECT sp.contact_id FROM submission_participants sp
        WHERE sp.submission_id = s.id AND sp.event_id = s.event_id AND sp.is_primary
        LIMIT 1
      )) AS "recipientId"
    FROM submissions s
    WHERE s.event_id = ${eventId}
      AND s.status IN ('accept_queue', 'decline_queue')
      AND s.notified_at IS NULL
    ORDER BY s.code, s.id
  `);
  const rows = rowsOf<PreviewQueueRow>(queueResult);
  const accepted = rows.filter((row) => row.status === "accept_queue");
  const declined = rows.filter((row) => row.status === "decline_queue");
  const deliverable = rows.filter((row) => row.recipientId !== null);

  const [event] = await dbOrTx.select({
    name: events.name,
    slug: events.slug,
    timezone: events.timezone,
    startsAt: events.startsAt,
    location: events.location,
    physicalAddress: events.physicalAddress,
    logoFileId: events.logoFileId,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  const samples: DecisionEmailPreviewSample[] = [];
  for (const [decision, candidates, templateKey] of [
    ["accepted", accepted, "submission_accepted"],
    ["declined", declined, "submission_declined"],
  ] as const) {
    const sample = candidates.find((row) => row.recipientId !== null);
    if (!sample?.recipientId) continue;
    const [[contact], [template]] = await Promise.all([
      dbOrTx.select({ email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName })
        .from(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, sample.recipientId))).limit(1),
      dbOrTx.select({ subject: emailTemplates.subject, bodyHtml: emailTemplates.bodyHtml, enabled: emailTemplates.enabled })
        .from(emailTemplates).where(and(eq(emailTemplates.eventId, eventId), eq(emailTemplates.key, templateKey))).limit(1),
    ]);
    if (!contact) continue;
    if (!template) throw new AppError("NOT_FOUND", `${decision === "accepted" ? "Acceptance" : "Decline"} email template not found`);
    // The template contract validates links as absolute URLs. `.invalid` is a
    // reserved, non-routable domain, so a preview can never become a usable
    // credential even if somebody copies it out of the message body.
    const previewBase = `https://preview.invalid/portal/${encodeURIComponent(event.slug)}`;
    const rendered = renderTemplateContent(templateKey, template.subject, template.bodyHtml, {
      event: {
        name: event.name,
        start_date: formatInZone(event.startsAt, event.timezone, "date"),
        location: event.location?.trim() || "Location to be announced",
        timezone: event.timezone,
      },
      speaker: {
        first_name: contact.firstName.trim() || "there",
        last_name: contact.lastName.trim(),
        email: contact.email,
      },
      portal: { magic_link: `${previewBase}/verify?token=preview-only` },
      unsubscribe: { url: `${previewBase}/unsubscribe?token=preview-only` },
      submission: { title: sample.title, code: `SESS-${sample.code}` },
    }, {
      ...(event.logoFileId ? { logoUrl: `/f/${event.logoFileId}` } : {}),
      unsubscribeUrl: `${previewBase}/unsubscribe?token=preview-only`,
      ...(event.physicalAddress ? { physicalAddress: event.physicalAddress } : {}),
    });
    samples.push({
      decision,
      recipientName: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
      recipientEmail: contact.email,
      submissionTitle: sample.title,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
      templateEnabled: template.enabled,
    });
  }

  return {
    accepted: accepted.length,
    declined: declined.length,
    emailsQueued: deliverable.length,
    skippedNoRecipient: rows.length - deliverable.length,
    queueRevision: decisionQueueRevision(rows),
    samples,
  };
}

export function previewNotifyQueues(eventId: EventId): Promise<NotifyPreview> {
  return previewNotifyQueuesIn(db, eventId);
}

type QueueRow = { id: string; notify_revision: number; recipient: string | null; primary_contact: string | null };

/**
 * Finalize both queues and enqueue exactly one email per submission.
 *
 * `notified_at IS NULL` in the WHERE clause is the idempotency: pressing Notify
 * twice finds nothing the second time. The idempotency key carries
 * `notify_revision`, so an organizer who undoes a decision and re-notifies gets a
 * genuinely new email rather than one the outbox silently swallows as a duplicate.
 *
 * The recipient is the submitter — the primary contact — and nobody else.
 * Co-speakers learn through the portal; mailing all of them turns one decision
 * into four emails, three of which nobody asked for.
 */
export async function notifyQueues(
  eventId: EventId,
  expectedQueueRevision?: string,
  actorUserId: UserId | null = null,
): Promise<NotifyResult> {
  return withTx(async (tx) => {
    // Freeze the exact set reviewed in the preflight. Locking the current rows
    // and updating only those ids also keeps a newly queued decision from
    // slipping into this batch between the preview and the two UPDATEs below.
    const queueRows = (await tx.execute<QueueRevisionRow>(sql`
      SELECT id, status, notify_revision AS "notifyRevision"
      FROM submissions
      WHERE event_id = ${eventId}
        AND status IN ('accept_queue', 'decline_queue')
        AND notified_at IS NULL
      ORDER BY status, id
      FOR UPDATE
    `)).rows ?? [];
    if (expectedQueueRevision && decisionQueueRevision(queueRows) !== expectedQueueRevision) {
      throw new AppError("STALE_WRITE", "Decision queues changed. Review a fresh preview before sending.");
    }

    const finalize = async (queue: "accept_queue" | "decline_queue", decided: "accepted" | "declined") => {
      const ids = queueRows.filter((row) => row.status === queue).map((row) => row.id);
      if (ids.length === 0) return [];
      const result = await tx.execute<QueueRow>(sql`
        WITH audit_context AS (
          SELECT
            set_config('openboard.submission_status_source', ${actorUserId ? "notification" : "system"}, true),
            set_config('openboard.actor_user_id', ${actorUserId ?? ""}, true),
            set_config('openboard.actor_contact_id', '', true)
        )
        UPDATE submissions s SET status = ${decided}, notified_at = now(), row_version = row_version + 1, updated_at = now()
        FROM audit_context
        WHERE s.event_id = ${eventId} AND s.status = ${queue} AND s.notified_at IS NULL
          AND s.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        RETURNING s.id, s.notify_revision,
          -- Two different people, deliberately. The decision email goes to whoever
          -- submitted; the confirmation belongs to whoever is actually presenting,
          -- and a submitter may have named somebody else as primary.
          COALESCE(s.submitter_contact_id, (
            SELECT sp.contact_id FROM submission_participants sp
            WHERE sp.submission_id = s.id AND sp.event_id = s.event_id AND sp.is_primary
            LIMIT 1
          )) AS recipient,
          (
            SELECT sp.contact_id FROM submission_participants sp
            WHERE sp.submission_id = s.id AND sp.event_id = s.event_id AND sp.is_primary
            LIMIT 1
          ) AS primary_contact
      `);
      return result.rows ?? [];
    };

    const acceptedRows = await finalize("accept_queue", "accepted");
    const declinedRows = await finalize("decline_queue", "declined");

    const skippedNoRecipient: SubmissionId[] = [];
    let emailsQueued = 0;

    for (const [rows, templateKey] of [
      [acceptedRows, "submission_accepted"],
      [declinedRows, "submission_declined"],
    ] as const) {
      for (const row of rows) {
        if (!row.recipient) {
          // A submission with nobody on it is a data problem, not a reason to
          // fail the whole batch; it is reported so somebody can fix it.
          skippedNoRecipient.push(row.id as SubmissionId);
          continue;
        }
        const contactId = row.recipient as ContactId;
        await enqueueEmail(tx, {
          eventId,
          templateKey,
          contactId,
          idempotencyKey: idem.decision(eventId, row.id as SubmissionId, Number(row.notify_revision)),
          refs: { submissionId: row.id as SubmissionId },
        });
        emailsQueued += 1;

        // Auto-confirm on acceptance: there is no speaker-facing confirm button,
        // so an accepted speaker is confirmed until an organizer says otherwise.
        // It follows the *primary participant*, not the submitter — confirming
        // the person who filled the form in on somebody else's behalf says the
        // wrong speaker is coming.
        const confirmed = (row.primary_contact ?? row.recipient) as ContactId | null;
        if (templateKey === "submission_accepted" && confirmed) {
          await updateContactFields(tx, eventId, confirmed, { confirmationStatus: "confirmed" });
        }
      }
    }

    return {
      accepted: acceptedRows.map((row) => row.id as SubmissionId),
      declined: declinedRows.map((row) => row.id as SubmissionId),
      emailsQueued,
      skippedNoRecipient,
    };
  });
}

/**
 * The speaker's own edit, until the form closes — M41's path and the third of
 * this module's four audited `withTx` compositions.
 *
 * Ownership is the *submitter* alone. A co-speaker is on the submission and can
 * read it in the portal, but only the person who submitted may change it: two
 * people editing one proposal from two browsers, with no locking between them,
 * silently loses one of their edits. A caller who is not the submitter gets
 * `NOT_FOUND` rather than `FORBIDDEN`, so probing ids reveals nothing about
 * which submissions exist.
 */
export async function updateSubmissionFromCfp(
  eventId: EventId,
  contactId: ContactId,
  submissionId: SubmissionId,
  answers: CleanAnswers,
): Promise<{ rowVersion: number }> {
  return withTx(async (tx) => {
    const submission = (await tx.execute<{
      id: string; form_id: string | null; form_version: number | null; status: SubmissionStatus;
    }>(sql`
      SELECT id, form_id, form_version, status FROM submissions
      WHERE id = ${submissionId} AND event_id = ${eventId} AND submitter_contact_id = ${contactId}
      FOR UPDATE
    `)).rows?.[0];
    if (!submission) throw new AppError("NOT_FOUND", "Submission not found");

    // A decided submission is what the programme was built on. Editing it after
    // the fact would change the talk an organizer accepted without telling them.
    if (submission.status !== "draft" && submission.status !== "pending") {
      throw new AppError("STALE_STATUS", "This submission can no longer be edited");
    }
    if (!submission.form_id || submission.form_version === null) {
      throw new AppError("NOT_FOUND", "This submission has no form to edit against");
    }

    // Sessionboard's deadline closes new *and updated* submissions, and it is the
    // database clock that decides — never a timestamp the client sent.
    const formId = formIdSchema.parse(submission.form_id);
    await assertFormOpen(tx, formId);

    // The *pinned* version. An edit means "these are my answers to the form I
    // filled in", not "to the form as the organizer has since rewritten it".
    const formVersion = Number(submission.form_version);
    const snapshot = await getPinnedSnapshotIn(tx, eventId, formId, formVersion);
    if (!snapshot) throw new AppError("NOT_FOUND", "The form version this submission was written against is missing");

    const fieldIds = snapshot.sections.flatMap((section) => section.fields.map((field) => field.id));
    const known = new Set<string>(fieldIds);
    for (const answer of answers) {
      // Fail loudly: an answer to a field this form version never had is a
      // client bug, and writing it would make the drawer render an orphan.
      if (!known.has(answer.fieldId)) {
        throw new AppError("VALIDATION", "An answer does not belong to this form version");
      }
    }

    const participants = await tx
      .select({ id: submissionParticipants.id, contactId: submissionParticipants.contactId })
      .from(submissionParticipants)
      .where(and(eq(submissionParticipants.submissionId, submissionId), eq(submissionParticipants.eventId, eventId)));
    const participantIds = new Map(participants.map((participant) => [participant.contactId, participant.id]));

    // Scoped replace rather than a blind delete-all: a question that has since
    // left the form keeps its answer for the organizer's "no longer on this
    // form" group, while a field the speaker just cleared really does empty.
    if (fieldIds.length > 0) {
      await tx.execute(sql`
        DELETE FROM submission_answers
        WHERE submission_id = ${submissionId} AND event_id = ${eventId}
          AND field_id IN (${sql.join(fieldIds.map((fieldId) => sql`${fieldId}`), sql`, `)})
      `);
    }
    await insertAnswers(tx, eventId, submissionId, answers, participantIds);

    // `maps_to` only, and only the columns this form actually maps — never a
    // whole-row write. Routing is *not* re-run (guardrail): an organizer who
    // re-routed this submission by hand must not have it undone by a typo fix.
    const mapped = deriveMappedFields(snapshot, answers).submission;
    const set: SQL[] = [sql`row_version = row_version + 1`, sql`updated_at = now()`];
    if (mapped.title !== undefined) set.push(sql`title = ${mapped.title.slice(0, LIMITS.TITLE)}`);
    if (mapped.descriptionHtml !== undefined) set.push(sql`description_html = ${sanitize(mapped.descriptionHtml)}`);
    if (mapped.level !== undefined) set.push(sql`level = ${mapped.level}`);
    // A mapped choice that resolves to no vocabulary id means "this option is not
    // tied to a track" — it is not an instruction to clear the track the routing
    // rules stamped, so only a real id is written here.
    if (mapped.trackId) set.push(sql`track_id = ${mapped.trackId}`);
    if (mapped.formatId) set.push(sql`format_id = ${mapped.formatId}`);

    const updated = (await tx.execute<{ row_version: number }>(sql`
      UPDATE submissions SET ${sql.join(set, sql`, `)}
      WHERE id = ${submissionId} AND event_id = ${eventId}
      RETURNING row_version
    `)).rows?.[0];
    if (!updated) throw new AppError("INTERNAL", "Could not save the submission");
    return { rowVersion: Number(updated.row_version) };
  });
}

/**
 * Speaker-initiated withdrawal. A speaker may only ever cause `draft→pending`
 * (by submitting) and `*→withdrawn`; that rule lives here rather than in the
 * portal UI, because a UI that hides a button has not prevented the request.
 *
 * `declined` is deliberately absent from the guard — the transition matrix has
 * no `declined→withdrawn` edge, and a speaker withdrawing a rejected proposal
 * would erase the decision an organizer already sent them.
 *
 * A row that has moved on, belongs to somebody else, or does not exist all read
 * the same: `NOT_FOUND`.
 */
export async function withdraw(eventId: EventId, contactId: ContactId, submissionId: SubmissionId): Promise<void> {
  const updated = await db.execute<{ id: string }>(sql`
    WITH audit_context AS (
      SELECT
        set_config('openboard.submission_status_source', 'speaker', true),
        set_config('openboard.actor_user_id', '', true),
        set_config('openboard.actor_contact_id', ${contactId}, true)
    ), changed AS (
      UPDATE submissions SET
        status = 'withdrawn',
        row_version = row_version + 1,
        updated_at = now(),
        notified_at = CASE WHEN status IN ('accepted','declined') THEN NULL ELSE notified_at END,
        notify_revision = notify_revision + CASE WHEN status IN ('accepted','declined') THEN 1 ELSE 0 END
      FROM audit_context
      WHERE event_id = ${eventId} AND id = ${submissionId} AND submitter_contact_id = ${contactId}
        AND status IN ('draft','pending','accept_queue','decline_queue','accepted')
      RETURNING submissions.id
    )
    SELECT id FROM changed
  `);
  if ((updated.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Submission not found");
}

/**
 * What the agenda promotes from. `alreadyPromoted` is what stops a second click
 * turning one accepted abstract into two sessions — the `sessions.submission_id`
 * unique constraint is the backstop, this is the affordance.
 *
 * A single statement on `neon-http`: reads never open one of the eight audited
 * transactions.
 */
export async function getAcceptedForScheduling(eventId: EventId): Promise<AcceptedForSchedulingRow[]> {
  const result = await db.execute<Record<string, unknown>>(sql`
    SELECT
      s.id AS "submissionId",
      s.code::int AS code,
      s.title,
      s.description_html AS "descriptionHtml",
      s.track_id AS "trackId",
      s.format_id AS "formatId",
      EXISTS (SELECT 1 FROM sessions ss WHERE ss.submission_id = s.id AND ss.event_id = s.event_id) AS "alreadyPromoted",
      COALESCE((
        SELECT json_agg(json_build_object(
          'contactId', sp.contact_id,
          'name', btrim(c.first_name || ' ' || c.last_name),
          'role', sp.role,
          'isPrimary', sp.is_primary
        ) ORDER BY sp.is_primary DESC, sp.sort_order, c.email)
        FROM submission_participants sp
        JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
        WHERE sp.submission_id = s.id AND sp.event_id = s.event_id
      ), '[]'::json) AS speakers
    FROM submissions s
    WHERE s.event_id = ${eventId} AND s.status = 'accepted'
    ORDER BY s.code
  `);
  return (result.rows ?? []).map((row) => acceptedForSchedulingRowSchema.parse(row));
}

/** A `timestamptz` as the driver hands it back — a string over HTTP, a `Date` in tests. */
function toDateOrNull(value: string | Date | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

/**
 * The organizer's drawer save (M17). It lives here rather than beside the reads
 * because every write that touches `submissions` / `submission_tags` from a
 * create or edit path belongs to this module's single writer (resolution #8).
 *
 * `expectedRowVersion` is the whole point: a save composed against what the
 * drawer showed must not resurrect a title over a status somebody else changed
 * in the meantime. Zero rows matched means the row moved — 409 `STALE_WRITE` —
 * and the caller refetches rather than being told the save worked.
 *
 * The tag reconciliation rides in the same statement as the update through
 * data-modifying CTEs, so tags can never be written for a save that lost the
 * `row_version` race. That is also why this needs no ninth `withTx`.
 */
export async function updateSubmissionFields(
  eventId: EventId,
  submissionId: SubmissionId,
  patch: SubmissionFieldPatch,
  expectedRowVersion: number,
): Promise<{ rowVersion: number }> {
  const set: SQL[] = [sql`row_version = row_version + 1`, sql`updated_at = now()`];
  if (patch.title !== undefined) {
    // 255 is the column, the contract and the counter. The counter is not the
    // enforcement, so a longer title is refused rather than silently truncated.
    if (patch.title.length > LIMITS.TITLE) throw new AppError("VALIDATION", `A title may be at most ${LIMITS.TITLE} characters`);
    set.push(sql`title = ${patch.title}`);
  }
  if (patch.descriptionHtml !== undefined) {
    // Public attacker-controlled HTML rendered in the admin panel: sanitized on
    // write, so every reader of the column can trust it.
    set.push(sql`description_html = ${patch.descriptionHtml === null ? null : sanitize(patch.descriptionHtml)}`);
  }
  if (patch.trackId !== undefined) set.push(sql`track_id = ${patch.trackId}::uuid`);
  if (patch.formatId !== undefined) set.push(sql`format_id = ${patch.formatId}::uuid`);
  if (patch.level !== undefined) set.push(sql`level = ${patch.level}`);
  if (patch.language !== undefined) set.push(sql`language = ${patch.language}`);
  if (patch.capacity !== undefined) set.push(sql`capacity = ${patch.capacity}::int`);
  if (patch.clientSessionId !== undefined) set.push(sql`client_session_id = ${patch.clientSessionId}`);
  if (patch.startsAt !== undefined) set.push(sql`starts_at = ${patch.startsAt?.toISOString() ?? null}::timestamptz`);
  if (patch.endsAt !== undefined) set.push(sql`ends_at = ${patch.endsAt?.toISOString() ?? null}::timestamptz`);

  // The patch schema's ordering refine only sees the keys the drawer sent, and
  // the drawer sends a key only when the organizer changed it — so moving just
  // "Starts at" past an untouched, earlier "Ends at" arrives here as a patch of
  // one, unchecked. `submissions` carries no ordering CHECK the way `sessions`
  // does, so that inverted pair persists silently and only surfaces later as a
  // raw 23514 from the `sessions` INSERT in `promoteSubmissionIn`. Merge the
  // patch over the stored pair and refuse it here instead, with the message the
  // schema already uses. The `row_version` guard below keeps this read-then-
  // write honest: a concurrent edit bumps the version and the save is STALE.
  if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
    const stored = await db.execute<{ starts_at: string | Date | null; ends_at: string | Date | null }>(sql`
      SELECT starts_at, ends_at FROM submissions WHERE event_id = ${eventId} AND id = ${submissionId}
    `);
    const current = (stored.rows ?? [])[0];
    const startsAt = patch.startsAt === undefined ? toDateOrNull(current?.starts_at) : patch.startsAt;
    const endsAt = patch.endsAt === undefined ? toDateOrNull(current?.ends_at) : patch.endsAt;
    if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
      throw new AppError("VALIDATION", "A session cannot end before it starts");
    }
  }

  // Absent means "leave the tags alone"; an empty array means "remove them all".
  const tagIds = patch.tagIds === undefined ? null : JSON.stringify(patch.tagIds);
  const reconcileTags = tagIds === null ? sql.empty() : sql`,
    cleared AS (
      DELETE FROM submission_tags st USING updated u
      WHERE st.submission_id = u.id
        AND st.tag_id NOT IN (SELECT t.value::uuid FROM jsonb_array_elements_text(${tagIds}::jsonb) AS t(value))
    ),
    added AS (
      INSERT INTO submission_tags (event_id, submission_id, tag_id)
      SELECT ${eventId}::uuid, u.id, t.value::uuid
      FROM updated u, jsonb_array_elements_text(${tagIds}::jsonb) AS t(value)
      ON CONFLICT DO NOTHING
    )`;

  const result = await db.execute<{ row_version: number }>(sql`
    WITH updated AS (
      UPDATE submissions SET ${sql.join(set, sql`, `)}
      WHERE event_id = ${eventId} AND id = ${submissionId} AND row_version = ${expectedRowVersion}
      RETURNING id, row_version
    )${reconcileTags}
    SELECT id, row_version FROM updated
  `);

  const row = (result.rows ?? [])[0];
  if (!row) {
    const existing = await db.execute<{ id: string }>(sql`
      SELECT id FROM submissions WHERE id = ${submissionId} AND event_id = ${eventId}
    `);
    if ((existing.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Submission not found");
    throw new AppError("STALE_WRITE", "This submission changed since you opened it");
  }
  return { rowVersion: Number(row.row_version) };
}
