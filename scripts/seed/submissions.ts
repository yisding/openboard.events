import { sql } from "drizzle-orm";
import { createSubmissionIn } from "@/features/submissions";
import { cleanAnswersSchema, type ContactId, type FieldId, type FormId, type FormatId, type SubmissionStatus, type TrackId } from "@/shared/contracts";
import type { SeedCtx } from "./lib/helpers";

/**
 * Owned by M17 (WS-C).
 *
 * Every row goes through `createSubmissionIn`, the single writer — so the seed
 * exercises the same code path a real submit does, including the code sequence
 * and the participant rules. A seed that inserts directly is a seed that keeps
 * working after the real path breaks.
 *
 * The content is deliberately hostile. A demo world of well-behaved English
 * sentences proves the product renders well-behaved English sentences; these
 * rows carry the XSS probe, an emoji title, right-to-left text, punctuation that
 * breaks naive CSV, and a title at the column limit, so those cases are visible
 * on every surface rather than discovered by a judge.
 */
const HOSTILE = [
  { key: "xss", title: '<img src=x onerror=alert(1)> Prompt injection in production', status: "pending" as const },
  { key: "punctuation", title: ';lkj,"quoted",=cmd|\' /C calc', status: "pending" as const },
  { key: "emoji", title: "🚀 Shipping agents 🤖 without 🔥", status: "pending" as const },
  { key: "rtl", title: "מהנדסי בינה מלאכותית בפעולה", status: "pending" as const },
  // Exactly at the column width, not near it: 254 characters plus the final
  // period. A probe that stops two short never tests the boundary it is for.
  { key: "long", title: `The ${"very ".repeat(49)}long talk`.slice(0, 254) + ".", status: "pending" as const },
];

const SPREAD: Array<{ key: string; title: string; status: SubmissionStatus }> = [
  { key: "accepted-1", title: "Caching at the edge without losing your mind", status: "accepted" },
  { key: "accepted-2", title: "Evals that survive contact with users", status: "accepted" },
  { key: "accepted-3", title: "What we learned running agents in production", status: "accepted" },
  { key: "accept-queue-1", title: "Retrieval is not a database problem", status: "accept_queue" },
  { key: "accept-queue-2", title: "Cost controls for long-running agents", status: "accept_queue" },
  { key: "decline-queue-1", title: "A tour of our internal tooling", status: "decline_queue" },
  { key: "declined-1", title: "Ten predictions for next year", status: "declined" },
  { key: "declined-2", title: "Why our framework is different", status: "declined" },
  { key: "withdrawn-1", title: "Talk withdrawn by the speaker", status: "withdrawn" },
  { key: "pending-1", title: "Observability for prompt pipelines", status: "pending" },
  { key: "pending-2", title: "Scaling human review", status: "pending" },
  { key: "pending-3", title: "Guardrails that do not annoy anyone", status: "pending" },
  { key: "pending-4", title: "Migrating from bespoke to boring", status: "pending" },
  { key: "pending-5", title: "The unglamorous parts of shipping AI", status: "pending" },
];

/** Mirrors contacts.ts, which owns these people. */
const SPEAKER_KEYS = ["ada", "grace", "alan", "katherine", "margaret", "barbara", "tim", "radia", "linus", "sophie", "james", "shafi"];
/**
 * Employers, on the seeded "Employer" question. They are deliberately
 * recognisable: an anonymized reviewer who can see one of these names on a
 * proposal is looking at a blindness bug, and a demo needs that to be obvious
 * rather than subtle.
 */
const EMPLOYERS = ["Northwind Labs", "Contoso Cloud", "Initech Systems", "Globex Research"];
const TRACK_KEYS = ["agents", "platforms", "security", "community"] as const;
const FORMAT_KEYS = ["talk", "workshop", "panel", "keynote"] as const;

export async function seedSubmissions(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  const formId = ctx.id("form", "form-a") as FormId;
  const [form] = (await tx.execute<{ id: string }>(sql`
    SELECT id FROM forms WHERE id = ${formId} AND event_id = ${eventId}
  `)).rows ?? [];
  // Only the contacts this seed created. A judge who adds a speaker during
  // judging must not find themselves silently co-authoring a seeded proposal.
  const seededContactIds = SPEAKER_KEYS.map((key) => ctx.id("contact", key));
  const contactRows = (await tx.execute<{ id: string }>(sql`
    SELECT id FROM contacts
    WHERE event_id = ${eventId} AND id IN (${sql.join(seededContactIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY created_at, email
  `)).rows ?? [];
  if (!form || contactRows.length === 0) {
    ctx.log("skipped — needs the seeded form and contacts (forms.ts, contacts.ts)");
    return;
  }
  const contacts = contactRows.map((row) => row.id as ContactId);
  const noAnswers = cleanAnswersSchema.parse([]);

  // The pinned snapshot's field ids, so seeded rows have answers to show in the
  // drawer rather than an empty Answers panel on every abstract.
  const field = (key: string) => ctx.id("field", `form-a-${key}`) as FieldId;
  const answersFor = (title: string, index: number) => cleanAnswersSchema.parse([
    { fieldId: field("title"), participantId: null, value: { t: "s", v: title } },
    { fieldId: field("description"), participantId: null, value: { t: "s", v: `<p>A talk about ${title.toLowerCase().slice(0, 60)}.</p>` } },
    { fieldId: field("track"), participantId: null, value: { t: "opt", v: TRACK_KEYS[index % TRACK_KEYS.length] ?? "agents" } },
    { fieldId: field("format"), participantId: null, value: { t: "opt", v: FORMAT_KEYS[index % FORMAT_KEYS.length] ?? "talk" } },
    // M50's blind-review pair, answered on every seeded abstract so a blind
    // round has something to keep as well as something to withhold: "Approach"
    // is classified as proposal content and reaches an anonymized reviewer,
    // "Employer" is left at the fail-closed default and does not.
    { fieldId: field("approach"), participantId: null, value: { t: "s", v: `Live walkthrough, then the parts of ${title.toLowerCase().slice(0, 40)} that went wrong.` } },
    { fieldId: field("employer"), participantId: null, value: { t: "s", v: EMPLOYERS[index % EMPLOYERS.length] ?? "Northwind Labs" } },
  ]);

  const create = async (key: string, title: string, status: SubmissionStatus, index: number) => {
    const primary = contacts[index % contacts.length];
    if (!primary) return;

    // M09's contract is that a re-run is a no-op, and createSubmissionIn always
    // inserts. The seed key rides in client_session_id, which is what makes a
    // second `pnpm seed` find this row instead of writing a twin.
    const seedKey = `seed:submission:${key}`;
    const [existing] = (await tx.execute<{ id: string }>(sql`
      SELECT id FROM submissions WHERE event_id = ${eventId} AND client_session_id = ${seedKey}
    `)).rows ?? [];
    if (existing) return;
    // A co-speaker on every third row: the fan-out law and the participant
    // rendering both need submissions with more than one person on them.
    const second = index % 3 === 0 ? contacts[(index + 5) % contacts.length] : undefined;
    await createSubmissionIn(tx, eventId, {
      formId,
      formVersion: 1,
      source: "cfp",
      kind: "abstract",
      initialStatus: status,
      submitterContactId: primary,
      fields: {
        title,
        clientSessionId: seedKey,
        trackId: ctx.id("track", TRACK_KEYS[index % TRACK_KEYS.length] ?? "agents") as TrackId,
        formatId: ctx.id("format", FORMAT_KEYS[index % FORMAT_KEYS.length] ?? "talk") as FormatId,
        descriptionHtml: key === "xss"
          // The standing probe, in rich text as well as in a title.
          ? '<p>Before: <img src=x onerror=alert(1)><script>alert(2)</script> after.</p>'
          : `<p>A talk about ${title.toLowerCase().slice(0, 60)}.</p>`,
      },
      participants: [
        { contactId: primary, role: "speaker", isPrimary: true, sortOrder: 0 },
        ...(second && second !== primary ? [{ contactId: second, role: "co_speaker" as const, isPrimary: false, sortOrder: 1 }] : []),
      ],
      answers: status === "draft" ? noAnswers : answersFor(title, index),
      // Seeded rows bypass the deadline and the limit deliberately: they model a
      // CFP that has been running for weeks, not one judged from now.
      enforce: { deadline: false, limit: false },
      sendConfirmation: false,
    });
  };

  let index = 0;
  for (const row of [...SPREAD, ...HOSTILE]) {
    await create(row.key, row.title, row.status, index);
    index += 1;
  }

  // Two genuine drafts, so the Drafts tab and the form-card counts are real
  // rather than decorative.
  for (const key of ["draft-1", "draft-2"]) {
    await create(key, key === "draft-1" ? "Half-written idea about evals" : "", "draft", index);
    index += 1;
  }

  // One row null in every nullable column a surface actually renders: the
  // standing probe for a renderer that assumes a field is always there.
  // client_session_id is deliberately left alone — it carries the seed key, and
  // nulling it makes this row reappear on every re-run.
  await tx.execute(sql`
    UPDATE submissions SET description_html = NULL, track_id = NULL, format_id = NULL, level = NULL,
      language = NULL, capacity = NULL
    WHERE event_id = ${eventId} AND client_session_id = 'seed:submission:pending-5'
  `);

  await topUpBlindReviewAnswers(ctx);

  ctx.log(`seeded ${SPREAD.length + HOSTILE.length + 2} submissions across every status, including the XSS, emoji, RTL and null probes`);
}

/**
 * The blind-review pair, added to submissions that were seeded before those two
 * questions existed.
 *
 * `create` above is a no-op for a row it already made — deliberately, so a
 * re-run cannot overwrite a judge's edits — which means new questions never
 * reach the abstracts already in a seeded database. That is the same shape of
 * bug that once kept Round 2 off every previously-seeded preview: without this,
 * a blind round on `sb-test` would have nothing to show a reviewer and nothing
 * to withhold from them, and only a full wipe would fix it.
 *
 * Answers that already exist are left exactly as they are.
 */
async function topUpBlindReviewAnswers(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;
  const approach = ctx.id("field", "form-a-approach");
  const employer = ctx.id("field", "form-a-employer");
  const employerCase = sql.join(
    EMPLOYERS.map((name, position) => sql`WHEN ${position} THEN ${name}`),
    sql` `,
  );

  const filled = await tx.execute<{ field_id: string }>(sql`
    INSERT INTO submission_answers (event_id, submission_id, field_id, participant_id, value)
    SELECT s.event_id, s.id, field.id, NULL, jsonb_build_object('t', 's', 'v', field.answer)
    FROM submissions s
    CROSS JOIN LATERAL (VALUES
      (${approach}::uuid, 'Live walkthrough, then the parts of ' || lower(left(s.title, 40)) || ' that went wrong.'),
      (${employer}::uuid, CASE (s.code % ${EMPLOYERS.length}) ${employerCase} ELSE ${EMPLOYERS[0]} END)
    ) AS field(id, answer)
    WHERE s.event_id = ${eventId}
      AND s.client_session_id LIKE 'seed:submission:%'
      -- Drafts are answerless on purpose; the Drafts tab is a fixture too.
      AND s.status <> 'draft'
      AND EXISTS (SELECT 1 FROM form_fields f WHERE f.id = field.id AND f.event_id = s.event_id)
      AND NOT EXISTS (
        SELECT 1 FROM submission_answers a
        WHERE a.submission_id = s.id AND a.field_id = field.id AND a.participant_id IS NULL
      )
    RETURNING field_id
  `);
  const added = (filled.rows ?? []).length;
  if (added > 0) ctx.log(`topped up ${added} blind-review answers on submissions seeded before those questions existed`);
}
