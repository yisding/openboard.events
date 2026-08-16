import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { forms, submissions } from "@/db/schema";
import { createSubmissionIn } from "@/features/submissions";
import {
  cleanAnswersSchema,
  contactIdSchema,
  type AnswerValue,
  type CleanAnswers,
  type ContactId,
  type CreateSubmissionInput,
  type EventId,
  type FieldId,
} from "@/shared/contracts";
import { demoLocal } from "../clock";
import { FORMS, SPEAKERS, SUBMISSIONS, type DemoSubmission } from "../dataset";
import {
  demoContactId,
  demoFieldId,
  demoFormId,
  demoOptionId,
  demoSubmissionKey,
  readDemoVocabIn,
  type DemoVocabIndex,
  type PhaseCtx,
} from "./context";

/**
 * The engine both submission phases share (design §2.4: 24 proposals across
 * every status, split over two requests so neither one is long enough to worry
 * a Worker's CPU budget).
 *
 * Every row goes through `createSubmissionIn`, the single writer, exactly as
 * the command-line seed does — so the demo world exercises the same code path a
 * real speaker's submit takes, including the public-code allocation and the
 * participant rules, and stays correct when that path changes.
 *
 * Two escape hatches, both deliberate and both the seed's own:
 *
 * - `enforce: { deadline: false, limit: false }` — these proposals model a call
 *   for speakers that has been running for five weeks, not one being judged
 *   from this instant, and several speakers legitimately have more than the
 *   form's three-per-person cap once co-authored talks are counted.
 * - `sendConfirmation: false` — provisioning must never write a `queued`
 *   outbox row (rail 3). The dispatcher would skip it on a demo event anyway,
 *   but a rail that only holds because another rail holds is not a rail.
 */

/** Where phase A stops and phase B starts. Both drafts sit at the tail, in B. */
export const SUBMISSIONS_PHASE_A = SUBMISSIONS.slice(0, 12);
export const SUBMISSIONS_PHASE_B = SUBMISSIONS.slice(12);

export async function runSubmissionsIn(ctx: PhaseCtx, batch: readonly DemoSubmission[]): Promise<void> {
  const vocab = await readDemoVocabIn(ctx.dbOrTx, ctx.eventId);
  // Read the pinned version rather than hard-coding phase three's `2`: a
  // proposal is pinned to the snapshot its speaker actually saw, and the one
  // place that number is authoritative is the form row itself.
  const pinned = await readFormVersionsIn(ctx.dbOrTx, ctx.eventId);
  await ctx.inTransaction(async (tx) => {
    for (const submission of batch) {
      await createOneIn(tx, ctx, submission, vocab, pinned);
    }
  });
}

async function readFormVersionsIn(dbOrTx: PhaseCtx["dbOrTx"], eventId: EventId): Promise<ReadonlyMap<string, number>> {
  const versions = new Map<string, number>();
  for (const form of FORMS) {
    const [row] = await dbOrTx.select({ currentVersion: forms.currentVersion })
      .from(forms)
      .where(and(eq(forms.eventId, eventId), eq(forms.id, demoFormId(eventId, form.key))))
      .limit(1);
    if (row) versions.set(form.key, row.currentVersion);
  }
  return versions;
}

async function createOneIn(
  tx: TxDb,
  ctx: PhaseCtx,
  submission: DemoSubmission,
  vocab: DemoVocabIndex,
  pinned: ReadonlyMap<string, number>,
): Promise<void> {
  const { eventId, now } = ctx;
  const replayKey = demoSubmissionKey(submission.key);

  // `createSubmissionIn` always inserts, and only accepts a caller-supplied row
  // id for organizer-created abstracts. These came in through the call for
  // speakers, so the replay key rides in `client_session_id` — the same
  // mechanism `scripts/seed/submissions.ts` uses, for the same reason.
  const [existing] = await tx.select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.eventId, eventId), eq(submissions.clientSessionId, replayKey)))
    .limit(1);
  if (existing) return;

  const primary = submission.participants.find((participant) => participant.isPrimary)
    ?? submission.participants[0];
  if (!primary) return;
  const submitterContactId = contactIdSchema.parse(demoContactId(eventId, primary.speakerKey));

  const input: CreateSubmissionInput = {
    formId: demoFormId(eventId, submission.formKey),
    formVersion: pinned.get(submission.formKey) ?? null,
    source: "cfp",
    kind: "abstract",
    initialStatus: submission.status,
    submitterContactId,
    fields: {
      title: submission.title,
      descriptionHtml: submission.descriptionHtml,
      clientSessionId: replayKey,
      ...(vocab.tracks.get(submission.trackKey) ? { trackId: vocab.tracks.get(submission.trackKey) } : {}),
      ...(vocab.formats.get(submission.formatKey) ? { formatId: vocab.formats.get(submission.formatKey) } : {}),
      ...(submission.level ? { level: submission.level } : {}),
    },
    participants: submission.participants.map((participant, index) => ({
      contactId: contactIdSchema.parse(demoContactId(eventId, participant.speakerKey)),
      role: participant.role,
      isPrimary: participant.isPrimary,
      sortOrder: index,
    })),
    answers: answersFor(eventId, submission, vocab, submitterContactId),
    ...(submission.tagKeys?.length
      ? { tagIds: submission.tagKeys.flatMap((key) => { const id = vocab.tags.get(key); return id ? [id] : []; }) }
      : {}),
    enforce: { deadline: false, limit: false },
    sendConfirmation: false,
  };

  const created = await createSubmissionIn(tx, eventId, input);

  // `createSubmissionIn` stamps `submitted_at` with the wall clock, which would
  // make twenty-four proposals arrive in the same second. Backdating them here
  // — from the *frozen* clock, so a replay writes the identical instants — is
  // what gives the review queue its five-week spread and the two drafts their
  // "started last week, still not sent" shape.
  const authoredAt = demoLocal(now, submission.createdOffsetDays, arrivalTime(submission));
  await tx.update(submissions).set({
    createdAt: authoredAt,
    submittedAt: submission.status === "draft" ? null : authoredAt,
    updatedAt: authoredAt,
  }).where(and(eq(submissions.id, created.submissionId), eq(submissions.eventId, eventId)));
}

/**
 * The answers behind each proposal, pinned to the field ids of the snapshot the
 * speaker "saw".
 *
 * Both halves of the blind-review pair are answered on every row, which is what
 * gives Round 2 something real to keep *and* something real to withhold:
 * "Approach" is classified as proposal content and reaches an anonymized
 * reviewer, while "Company" — a participant question nobody classified — keeps
 * the fail-closed `identity` default and does not.
 */
function answersFor(
  eventId: EventId,
  submission: DemoSubmission,
  vocab: DemoVocabIndex,
  submitterContactId: ContactId,
): CleanAnswers {
  const form = FORMS.find((candidate) => candidate.key === submission.formKey);
  // Only questions this form actually asks. The two forms have different
  // question sets, and an answer to a field that is not on the form would be
  // orphaned data the drawer could never render.
  const asks = new Set((form?.fields ?? []).map((field) => field.key));
  const field = (key: string) => demoFieldId(eventId, submission.formKey, key);
  const option = (fieldKey: string, optionKey: string) => demoOptionId(eventId, submission.formKey, fieldKey, optionKey);

  const rows: Array<{ fieldId: FieldId; participantId: string | null; value: AnswerValue }> = [];
  const answer = (key: string, value: AnswerValue, participantId: string | null = null) => {
    if (asks.has(key)) rows.push({ fieldId: field(key), participantId, value });
  };

  answer("title", { t: "s", v: submission.title });
  answer("description", { t: "s", v: submission.descriptionHtml });
  if (vocab.tracks.has(submission.trackKey)) {
    answer("track", { t: "opt", v: option("track", submission.trackKey) });
  }
  if (vocab.formats.has(submission.formatKey)) {
    answer("format", { t: "opt", v: option("format", submission.formatKey) });
  }
  if (submission.workshopDurationAnswer) {
    answer("workshop_duration", { t: "s", v: submission.workshopDurationAnswer });
  }
  const topics = (submission.tagKeys ?? []).filter((key) => vocab.tags.has(key)).map((key) => option("topics", key));
  if (topics.length > 0) answer("topics", { t: "opts", v: topics });
  answer("approach", { t: "s", v: approachFor(submission) });
  // Keyed by contact id: `createSubmissionIn` resolves a participant answer
  // through the map it builds while writing that submission's participants.
  answer("company", { t: "s", v: companyFor(submission) }, submitterContactId);

  return cleanAnswersSchema.parse(rows);
}

/**
 * A plausible hour of the day for a proposal to have arrived. Twenty-four rows
 * all stamped 10:00 look generated; the review queue should look like people
 * hitting submit whenever they finished writing.
 */
function arrivalTime(submission: DemoSubmission): string {
  const times = ["08:42", "11:15", "14:03", "16:37", "21:58"];
  return times[Math.abs(submission.createdOffsetDays) % times.length] ?? "11:15";
}

function approachFor(submission: DemoSubmission): string {
  return submission.status === "draft"
    ? "Still working out the structure. Probably one war story, then the architecture underneath it."
    : "A worked example first, then the two things that went wrong in production and what we changed.";
}

/**
 * The employer, on a question nobody classified as proposal content — so an
 * anonymized Round 2 reviewer never sees it. A recognisable company name here
 * is the point: a blindness bug becomes obvious rather than subtle.
 */
function companyFor(submission: DemoSubmission): string {
  const primaryKey = submission.participants.find((participant) => participant.isPrimary)?.speakerKey;
  const speaker = SPEAKERS.find((candidate) => candidate.key === primaryKey);
  return speaker?.company ?? "Independent";
}
