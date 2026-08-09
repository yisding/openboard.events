import { and, eq, isNull, sql } from "drizzle-orm";
import { db, withTx, type TxDb } from "@/db/client";
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
import { updateContactFields } from "@/features/portal";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { assertTransition } from "./guards";
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
): Promise<TransitionResult> {
  if (ids.length === 0) return { changed: [], stale: [] };
  const from = Array.isArray(expectedFrom) ? expectedFrom : [expectedFrom];
  // A friendly error before the trigger's 23514, for the cases a UI can prevent.
  for (const source of from) assertTransition(source, to);

  const updated = await db.execute<{ id: string }>(sql`
    UPDATE submissions SET
      status = ${to},
      row_version = row_version + 1,
      updated_at = now(),
      notified_at = CASE WHEN status IN ('accepted','declined') AND ${to} NOT IN ('accepted','declined') THEN NULL ELSE notified_at END,
      notify_revision = notify_revision + CASE WHEN status IN ('accepted','declined') AND ${to} NOT IN ('accepted','declined') THEN 1 ELSE 0 END
    WHERE event_id = ${eventId}
      AND id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
      AND status IN (${sql.join(from.map((status) => sql`${status}`), sql`, `)})
    RETURNING id
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
export async function notifyQueues(eventId: EventId): Promise<NotifyResult> {
  return withTx(async (tx) => {
    const finalize = async (queue: "accept_queue" | "decline_queue", decided: "accepted" | "declined") => {
      const result = await tx.execute<QueueRow>(sql`
        UPDATE submissions s SET status = ${decided}, notified_at = now(), row_version = row_version + 1, updated_at = now()
        WHERE s.event_id = ${eventId} AND s.status = ${queue} AND s.notified_at IS NULL
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
