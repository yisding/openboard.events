import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { submissionAnswers, submissionParticipants, submissions } from "@/db/schema";
import { runSubmitPipeline, getPinnedSnapshotIn, type RawAnswers } from "@/features/forms";
// The named portal contract avoids importing the submissions feature's broad
// server barrel while keeping this intentional cross-feature mutation explicit.
import { updateSubmissionFromCfp } from "@/features/submissions/index.portal";
import {
  answerValueSchema,
  cleanAnswersSchema,
  formIdSchema,
  submissionIdSchema,
  type AnswerValue,
  type CleanAnswers,
  type ContactId,
  type EventId,
  type FormSnapshot,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * M41 — the speaker's own edit of their submission, up until the form closes.
 *
 * This file never writes to `submissions` or `submission_answers` itself. The
 * single permitted write path is M18's `updateSubmissionFromCfp`; everything
 * here is either a read (the gate, the pinned snapshot, the current answers) or
 * a call into M16's exported pure pipeline (`runSubmitPipeline`) to turn a raw
 * payload into `CleanAnswers` before handing it to that one mutation.
 */

export type EditableSubmissionSummary = { submissionId: string; code: number; title: string };

export type GetEditableSubmissionResult =
  | { blocked?: undefined; submission: EditableSubmissionSummary; snapshot: FormSnapshot; answers: Record<string, AnswerValue> }
  | { blocked: "FORM_CLOSED" | "NOT_EDITABLE" | "NOT_FOUND" };

/**
 * The section that carries a form's speaker/co-speaker identity fields. Those
 * fields are locked, mapped to `contact.*`, and managed through the Profile page
 * (M22) — not this module. Editing here is the abstract only.
 */
function isParticipantSection(section: FormSnapshot["sections"][number]): boolean {
  return section.key === "participant";
}

/**
 * Ownership is the *submitter* alone (M18 step 7's guard, mirrored here so a
 * co-speaker who can read the submission in the portal never sees an Edit CTA
 * their own POST would be refused for — two docs asserting opposite behaviors
 * would leave that AC unable to pass). A mismatched contactId reads exactly like
 * a submission that does not exist, so probing ids reveals nothing.
 */
export async function getEditableSubmissionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  submissionId: string,
): Promise<GetEditableSubmissionResult> {
  const [row] = await dbOrTx
    .select({
      id: submissions.id,
      code: submissions.code,
      title: submissions.title,
      status: submissions.status,
      formId: submissions.formId,
      formVersion: submissions.formVersion,
    })
    .from(submissions)
    .where(and(
      eq(submissions.eventId, eventId),
      eq(submissions.id, submissionId),
      eq(submissions.submitterContactId, contactId),
    ))
    .limit(1);
  if (!row) return { blocked: "NOT_FOUND" };

  // Accepted, declined, withdrawn and queue states are never editable here —
  // editing a decided submission would change the talk an organizer already
  // acted on without telling them (matches M18's own `updateSubmissionFromCfp`
  // guard for the identical condition).
  if (row.status !== "draft" && row.status !== "pending") return { blocked: "NOT_EDITABLE" };
  if (!row.formId || row.formVersion === null) return { blocked: "NOT_EDITABLE" };

  const formId = formIdSchema.parse(row.formId);
  // The database clock, never the page's: a form that closed since page load
  // must refuse here exactly as the POST will refuse it moments later.
  const openResult = await dbOrTx.execute<{ open: boolean | null }>(sql`SELECT is_form_open(${formId}) AS open`);
  if ((openResult.rows ?? [])[0]?.open !== true) return { blocked: "FORM_CLOSED" };

  // The *pinned* version — the form the speaker last answered, not whatever an
  // organizer has since published.
  const snapshot = await getPinnedSnapshotIn(dbOrTx, eventId, formId, row.formVersion);
  if (!snapshot) return { blocked: "NOT_FOUND" };

  const abstractFieldIds = new Set<string>(
    snapshot.sections.filter((section) => !isParticipantSection(section)).flatMap((section) => section.fields.map((field) => field.id)),
  );
  const answerRows = await dbOrTx
    .select({ fieldId: submissionAnswers.fieldId, value: submissionAnswers.value })
    .from(submissionAnswers)
    .where(and(
      eq(submissionAnswers.eventId, eventId),
      eq(submissionAnswers.submissionId, submissionId),
      isNull(submissionAnswers.participantId),
    ));

  // R10: a hidden-by-visibility or since-removed field's stray answer is simply
  // skipped, never a crash on a key the renderer does not expect.
  const answers: Record<string, AnswerValue> = {};
  for (const answerRow of answerRows) {
    if (!abstractFieldIds.has(answerRow.fieldId)) continue;
    const parsed = answerValueSchema.safeParse(answerRow.value);
    if (parsed.success) answers[answerRow.fieldId] = parsed.data;
  }

  return {
    submission: { submissionId: row.id, code: row.code, title: row.title },
    snapshot,
    answers,
  };
}

export function getEditableSubmission(eventId: EventId, contactId: ContactId, submissionId: string): Promise<GetEditableSubmissionResult> {
  return getEditableSubmissionIn(db, eventId, contactId, submissionId);
}

/**
 * The participant-section answers currently on file, translated back into the
 * `CleanAnswers` shape `updateSubmissionFromCfp` expects (`participantId` there
 * is a contact id, while `submission_answers.participant_id` stores the
 * `submission_participants` row id — the join undoes exactly the mapping
 * `insertAnswers` applied on the way in).
 *
 * `updateSubmissionFromCfp` replaces every answer for a field on the pinned
 * snapshot with whatever this call supplies, so a co-speaker's roster answers —
 * out of scope for this module's abstract-only edit — must be carried forward
 * unchanged here or they would be silently deleted.
 */
async function preservedParticipantAnswers(
  eventId: EventId,
  submissionId: string,
  participantFieldIds: ReadonlySet<string>,
): Promise<CleanAnswers> {
  if (participantFieldIds.size === 0) return cleanAnswersSchema.parse([]);
  // LEFT, not INNER. A *draft* stores the primary speaker's participant answers
  // with `participant_id IS NULL` — `saveCfpDraft` runs the pipeline over the
  // whole snapshot with `participantId: null` — and an inner join can never see
  // those rows. The abstract-only edit form then deleted them anyway, because
  // the replace is scoped by field id alone: a speaker who resumed a draft to
  // fix a typo in the title lost their entire "Tell us about you" step,
  // including required locked fields, and the wizard does not re-seed it.
  const rows = await db
    .select({ fieldId: submissionAnswers.fieldId, value: submissionAnswers.value, contactId: submissionParticipants.contactId })
    .from(submissionAnswers)
    .leftJoin(submissionParticipants, and(
      eq(submissionParticipants.id, submissionAnswers.participantId),
      eq(submissionParticipants.eventId, submissionAnswers.eventId),
    ))
    .where(and(eq(submissionAnswers.eventId, eventId), eq(submissionAnswers.submissionId, submissionId)));

  return cleanAnswersSchema.parse(
    rows
      .filter((row) => participantFieldIds.has(row.fieldId))
      .map((row) => ({ fieldId: row.fieldId, participantId: row.contactId ?? null, value: answerValueSchema.parse(row.value) })),
  );
}

/**
 * The speaker's own save. The gate is re-run here from scratch — never trusted
 * from the page that rendered the form, which may be seconds or hours stale —
 * and every failure throws the same `AppError` codes `updateSubmissionFromCfp`
 * itself would raise for the identical condition, so a client that already
 * knows how to read that mutation's errors needs nothing new.
 */
export async function applySubmissionEdit(
  eventId: EventId,
  contactId: ContactId,
  submissionId: string,
  formVersion: number,
  raw: RawAnswers,
): Promise<{ rowVersion: number }> {
  const gate = await getEditableSubmissionIn(db, eventId, contactId, submissionId);
  if ("blocked" in gate) {
    if (gate.blocked === "FORM_CLOSED") throw new AppError("FORM_CLOSED", "This form is no longer accepting submissions");
    if (gate.blocked === "NOT_EDITABLE") throw new AppError("STALE_STATUS", "This submission can no longer be edited");
    throw new AppError("NOT_FOUND", "Submission not found");
  }

  // Pinned means pinned: the version the speaker's page rendered must still be
  // the version on the submission the server just re-read.
  if (formVersion !== gate.snapshot.version) {
    throw new AppError("FORM_VERSION_STALE", "This form changed while you were editing", {
      snapshot: gate.snapshot,
      version: gate.snapshot.version,
    });
  }

  // Only the abstract section is open for edit here (see `isParticipantSection`).
  const abstractSnapshot: FormSnapshot = {
    ...gate.snapshot,
    sections: gate.snapshot.sections.filter((section) => !isParticipantSection(section)),
  };
  // M16's exported pure pipeline — parse, visibility, strip, validate, brand —
  // reused verbatim, never reimplemented (R12).
  const pipeline = runSubmitPipeline(abstractSnapshot, raw, { participantId: null, requireRequired: true });
  if (!pipeline.ok) throw new AppError("VALIDATION", "Some answers need attention", { fieldErrors: pipeline.fieldErrors });

  const participantFieldIds = new Set(
    gate.snapshot.sections.filter(isParticipantSection).flatMap((section) => section.fields.map((field) => field.id)),
  );
  const preserved = await preservedParticipantAnswers(eventId, submissionId, participantFieldIds);

  const answers = cleanAnswersSchema.parse([...pipeline.clean, ...preserved]);
  // Routing is not re-run: `updateSubmissionFromCfp`'s contract is answers-only
  // (resolution #8), so a routing rule that would now match differently does not
  // re-stamp `track_id`/`submission_tags` on an edit.
  return updateSubmissionFromCfp(eventId, contactId, submissionIdSchema.parse(submissionId), answers);
}
