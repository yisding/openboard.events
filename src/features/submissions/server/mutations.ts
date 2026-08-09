import { and, eq, isNull, sql } from "drizzle-orm";
import { withTx, type TxDb } from "@/db/client";
import { forms, submissionAnswers, submissionParticipants, submissionTags, submissions } from "@/db/schema";
import {
  LIMITS,
  answerValueSchema,
  idem,
  type AnswerValue,
  type CleanAnswers,
  type ContactId,
  type CreateSubmissionInput,
  type EventId,
  type FormId,
  type SubmissionId,
  type SubmissionStatus,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { enqueueEmail } from "@/shared/server/enqueue-email";

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

/**
 * The only file in the repository that inserts into `submissions`. Six callers
 * across four lanes go through these functions, which is what keeps the code
 * allocation, the limit rule and the outbox write from being reimplemented
 * three different ways.
 */

/** Every rendering of a submission code, everywhere. */
export function formatCode(code: number): string {
  return `SESS-${code}`;
}

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

type FormRow = { id: string; sendConfirmation: boolean; submissionLimit: number | null };

async function loadForm(tx: TxDb, eventId: EventId, formId: FormId): Promise<FormRow> {
  const [form] = await tx
    .select({ id: forms.id, sendConfirmation: forms.sendConfirmation, submissionLimit: forms.submissionLimit })
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
  for (const answer of answers) {
    const participantId = answer.participantId ? participantIds.get(answer.participantId) : null;
    if (answer.participantId && !participantId) {
      throw new AppError("VALIDATION", "An answer belongs to an unknown participant");
    }
    await tx.execute(sql`
      INSERT INTO submission_answers (event_id, submission_id, field_id, participant_id, value)
      VALUES (${eventId}, ${submissionId}, ${answer.fieldId}, ${participantId}, ${JSON.stringify(answer.value)}::jsonb)
      ON CONFLICT (submission_id, field_id, participant_id)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `);
  }
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

export async function createSubmission(eventId: EventId, input: CreateSubmissionInput): Promise<CreateSubmissionResult> {
  assertOnePrimary(input.participants);
  const status: SubmissionStatus = input.initialStatus ?? "pending";

  return withTx(async (tx) => {
    // Serializes submits per event, which is what closes the two-tab race on the
    // limit check and on the code sequence.
    const [event] = await tx.execute<{ id: string; submission_cap_per_user: number }>(sql`
      SELECT id, submission_cap_per_user FROM events WHERE id = ${eventId} FOR UPDATE
    `).then((result) => result.rows ?? []);
    if (!event) throw new AppError("NOT_FOUND", "Event not found");

    let form: FormRow | null = null;
    if (input.formId) {
      form = await loadForm(tx, eventId, input.formId);
      if (input.enforce?.deadline !== false) await assertFormOpen(tx, input.formId);
      if (input.enforce?.limit !== false && input.submitterContactId) {
        await assertUnderLimit(tx, eventId, input.formId, input.submitterContactId, form.submissionLimit, Number(event.submission_cap_per_user));
      }
    }

    const columns = submissionColumns(input);

    // A retried or double-clicked submit arrives after the first one already
    // promoted the draft, so there is no draft left to find. Without this the
    // second request allocates a fresh code and the speaker ends up with two
    // proposals. M16 passes the draft id it holds precisely for this.
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
      await tx.update(submissions).set({
        ...columns,
        status,
        formVersion: input.formVersion,
        source: input.source,
        kind: input.kind,
        // A promotion that stays a draft has not been submitted, so it must not
        // carry a submitted_at that every downstream sort trusts.
        ...(status === "draft" ? {} : { submittedAt: new Date() }),
        rowVersion: sql`${submissions.rowVersion} + 1`,
        updatedAt: new Date(),
      }).where(eq(submissions.id, submissionId));
    } else {
      code = await nextSubmissionCode(tx, eventId);
      const [inserted] = await tx.insert(submissions).values({
        eventId,
        formId: input.formId,
        formVersion: input.formVersion,
        code,
        kind: input.kind,
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
  });
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
): Promise<{ submissionId: SubmissionId; code: number; answers: Record<string, AnswerValue> }> {
  return withTx(async (tx) => {
    // The form_id foreign key proves the form exists, not that it belongs to
    // this event — without this a caller could start a draft against another
    // event's form and the row would look legitimate.
    await loadForm(tx, eventId, formId);

    const existing = (await tx.execute<{ id: string; code: number }>(sql`
      SELECT id, code FROM submissions
      WHERE event_id = ${eventId} AND form_id = ${formId} AND submitter_contact_id = ${contactId} AND status = 'draft'
      FOR UPDATE
    `)).rows?.[0];

    if (existing) {
      await tx.update(submissions)
        .set({ formVersion, updatedAt: new Date() })
        .where(eq(submissions.id, existing.id));
      const rows = await tx.select({ fieldId: submissionAnswers.fieldId, value: submissionAnswers.value })
        .from(submissionAnswers)
        .where(and(eq(submissionAnswers.submissionId, existing.id), isNull(submissionAnswers.participantId)));
      return {
        submissionId: existing.id as SubmissionId,
        code: Number(existing.code),
        answers: Object.fromEntries(rows.map((row) => [row.fieldId, answerValueSchema.parse(row.value)])),
      };
    }

    // FOR UPDATE cannot lock a row that does not exist, so two first-time calls
    // both reach here. The partial unique index is what actually decides;
    // ON CONFLICT turns the loser into a read instead of a duplicate-key error.
    const code = await nextSubmissionCode(tx, eventId);
    const upserted = (await tx.execute<{ id: string; code: number }>(sql`
      INSERT INTO submissions (event_id, form_id, form_version, code, status, source, submitter_contact_id, title)
      VALUES (${eventId}, ${formId}, ${formVersion}, ${code}, 'draft', 'cfp', ${contactId}, '')
      ON CONFLICT (event_id, form_id, submitter_contact_id) WHERE status = 'draft' AND form_id IS NOT NULL AND submitter_contact_id IS NOT NULL
      DO UPDATE SET form_version = EXCLUDED.form_version, updated_at = now()
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
    return { submissionId: inserted.id as SubmissionId, code: inserted.code, answers: {} };
  });
}

/** Replace an authenticated speaker's incomplete draft answers. */
export async function saveDraftAnswers(
  eventId: EventId,
  contactId: ContactId,
  formId: FormId,
  formVersion: number,
  answers: CleanAnswers,
): Promise<{ submissionId: SubmissionId }> {
  return withTx(async (tx) => {
    const draft = (await tx.execute<{ id: string }>(sql`
      SELECT id FROM submissions
      WHERE event_id = ${eventId} AND form_id = ${formId}
        AND submitter_contact_id = ${contactId} AND status = 'draft'
      FOR UPDATE
    `)).rows?.[0];
    if (!draft) throw new AppError("NOT_FOUND", "Draft not found");
    await replaceAnswers(tx, eventId, draft.id, answers);
    await tx.update(submissions)
      .set({ formVersion, updatedAt: new Date() })
      .where(eq(submissions.id, draft.id));
    return { submissionId: draft.id as SubmissionId };
  });
}
