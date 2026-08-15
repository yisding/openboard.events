import { and, eq } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { promoteSubmissionIn, saveSessionIn } from "@/features/agenda";
import { contactIdSchema, sessionIdSchema, type SubmissionId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { demoLocal } from "../clock";
import { SESSIONS, SUBMISSIONS, type DemoSession } from "../dataset";
import { demoId } from "../ids";
import { demoContactId, readDemoVocabIn, type DemoVocabIndex, type PhaseCtx } from "./context";
import { readDemoSubmissionIdsIn } from "./lookup";

/**
 * Sessions and submissions are keyed independently in the dataset — every
 * session's *title* matches exactly one submission's (design §2.4: "the same
 * twenty that appear as accepted `SUBMISSIONS`... now placed on the grid"),
 * but nineteen of the twenty happen to reuse that submission's own `key`
 * string while the opening keynote does not (`"opening-keynote"` vs.
 * `"keynote-agentic-stack"`). Matching on title rather than assuming key
 * equality is what survives that one exception without special-casing it.
 */
const SUBMISSION_KEY_BY_TITLE = new Map(SUBMISSIONS.map((submission) => [submission.title, submission.key]));
const SUBMISSION_STATUS_BY_KEY = new Map(SUBMISSIONS.map((submission) => [submission.key, submission.status]));

/**
 * Phase 7 — the set-piece. Twenty sessions, two planted conflicts, one pair
 * that must never be flagged, three left in the tray.
 *
 * **Verified discrepancy, not introduced here.** Design §2.4 describes all
 * twenty session titles as backing an *accepted* submission, and
 * `promoteSubmissionIn` enforces exactly that (`status !== 'accepted'` is a
 * `VALIDATION` throw). But `dataset.ts`'s own `SUBMISSIONS` array assigns
 * seven of those same twenty titles a different status — two `accept_queue`,
 * two `pending` (including *both* members of the planted speaker conflict —
 * `sales-agent-aes-trust` and `agentic-commerce-cart`), one `decline_queue`,
 * one `withdrawn`, one `declined` — because the same twenty titles also have
 * to cover "24 submissions across all 7 statuses" for Chapters 3 and 5. There
 * is no way to satisfy both requirements against one shared title list: every
 * status other than `accepted` this phase left in place is a submission
 * Chapter 3 or 5 still needs to *decide on*, so flipping it to `accepted`
 * here to unlock `promoteSubmissionIn` would empty out the review queue those
 * chapters are built around.
 *
 * The resolution: a session whose backing submission genuinely **is**
 * `accepted` goes through `promoteSubmissionIn`, exactly as designed — the
 * submission stays the session's source of truth, id and all. A session
 * whose backing submission is anything else is created **directly** through
 * `saveSessionIn`'s own create path (a deterministic `creationId`, no
 * `submission_id`) — an organizer adding a session by hand is an entirely
 * ordinary path in this product, not a fallback, and it is what lets both
 * planted conflicts and the full twenty-session schedule exist without
 * touching a single submission's status.
 *
 * `saveSessionIn` and `promoteSubmissionIn` are both typed against `DbOrTx`,
 * not a transaction runner (verified — neither demands a `TxDb`), so this
 * phase writes directly through `ctx.dbOrTx` rather than opening a `withTx`
 * of its own; see the doc comment on `06-evaluation.ts` for the phase that
 * actually needs one.
 *
 * Every session this phase writes stays `status: 'draft'` — never
 * `'published'` — which is what keeps `saveSessionIn`'s own speaker-notice
 * logic a no-op here: `notifySchedule`/`notifyAddedSpeakers` only enqueue mail
 * once a session is published, and Chapter 8 is what publishes it. A
 * `communication_logs` row from this phase would be rail 3's first crack.
 */
export async function runAgendaPhase(ctx: PhaseCtx): Promise<void> {
  const { dbOrTx, eventId } = ctx;
  const vocab = await readDemoVocabIn(dbOrTx, eventId);
  const acceptedKeys = SESSIONS.flatMap((session) => {
    const key = SUBMISSION_KEY_BY_TITLE.get(session.title);
    return key && SUBMISSION_STATUS_BY_KEY.get(key) === "accepted" ? [key] : [];
  });
  const submissionIds = await readDemoSubmissionIdsIn(dbOrTx, eventId, acceptedKeys);

  for (const session of SESSIONS) {
    await placeOneIn(ctx, session, vocab, submissionIds);
  }
}

async function placeOneIn(
  ctx: PhaseCtx,
  session: DemoSession,
  vocab: DemoVocabIndex,
  submissionIds: ReadonlyMap<string, SubmissionId>,
): Promise<void> {
  const { dbOrTx, eventId, now, actorUserId } = ctx;

  const submissionKey = SUBMISSION_KEY_BY_TITLE.get(session.title);
  const isAccepted = submissionKey ? SUBMISSION_STATUS_BY_KEY.get(submissionKey) === "accepted" : false;

  const roomId = session.placement ? (vocab.rooms.get(session.placement.roomKey) ?? null) : null;
  if (session.placement && !roomId) {
    throw new AppError("INTERNAL", `The demo room "${session.placement.roomKey}" is missing`);
  }
  const startsAt = session.placement ? demoLocal(now, session.placement.dayOffset, session.placement.start) : null;
  const endsAt = session.placement ? demoLocal(now, session.placement.dayOffset, session.placement.end) : null;
  const formatId = vocab.formats.get(session.formatKey) ?? null;
  const trackId = vocab.tracks.get(session.trackKey) ?? null;
  const speakerContactIds = session.speakerKeys.map((key) => contactIdSchema.parse(demoContactId(eventId, key)));

  if (isAccepted) {
    const submissionId = submissionKey ? submissionIds.get(submissionKey) : undefined;
    if (!submissionId) {
      throw new AppError("INTERNAL", `The demo submission behind "${session.title}" is missing — did phases 4/5 run first?`);
    }
    const { sessionId } = await promoteSubmissionIn(dbOrTx, eventId, submissionId);
    // Three sessions are accepted but deliberately left unscheduled (design
    // §2.4's tray). Promotion alone is their whole story.
    if (!session.placement) return;

    const [row] = await dbOrTx.select({ rowVersion: sessions.rowVersion })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.eventId, eventId)))
      .limit(1);
    if (!row) throw new AppError("INTERNAL", "The session just promoted from this abstract disappeared");
    // `promoteSubmissionIn` always inserts at row_version 1 (the schema
    // default) and never touches an existing row, so version 1 means "this
    // phase has not placed it yet" and anything higher means a previous run
    // already did — the idempotency check `promoteSubmissionIn`'s own
    // submission_id lookup does not give this phase for free.
    if (row.rowVersion !== 1) return;

    await saveSessionIn(dbOrTx, eventId, {
      id: sessionId,
      expectedVersion: 1,
      title: session.title,
      descriptionHtml: session.descriptionHtml,
      formatId,
      trackId,
      roomId,
      startsAt: startsAt ? startsAt.toISOString() : null,
      endsAt: endsAt ? endsAt.toISOString() : null,
      speakerContactIds,
      status: "draft",
    }, actorUserId);
    return;
  }

  // Not (yet) accepted in the CFP's own review queue: a real session, added
  // directly rather than promoted (see the discrepancy note above).
  // `saveSessionIn`'s create path is idempotent on `creationId` by itself —
  // a replay with the identical payload recovers the row it already made —
  // so no row-version dance is needed here the way the promoted branch above
  // needs one.
  await saveSessionIn(dbOrTx, eventId, {
    creationId: sessionIdSchema.parse(demoId(eventId, `session:${session.key}`)),
    title: session.title,
    descriptionHtml: session.descriptionHtml,
    formatId,
    trackId,
    roomId,
    startsAt: startsAt ? startsAt.toISOString() : null,
    endsAt: endsAt ? endsAt.toISOString() : null,
    speakerContactIds,
    status: "draft",
  }, actorUserId);
}
