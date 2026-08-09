import { sql } from "drizzle-orm";
import { createSubmissionIn } from "@/features/submissions";
import { cleanAnswersSchema, type ContactId, type FormId, type SubmissionStatus } from "@/shared/contracts";
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
  { key: "long", title: `The ${"very ".repeat(48)}long talk`.slice(0, 255), status: "pending" as const },
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

export async function seedSubmissions(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  const formId = ctx.id("form", "form-a") as FormId;
  const [form] = (await tx.execute<{ id: string }>(sql`
    SELECT id FROM forms WHERE id = ${formId} AND event_id = ${eventId}
  `)).rows ?? [];
  const contactRows = (await tx.execute<{ id: string }>(sql`
    SELECT id FROM contacts WHERE event_id = ${eventId} ORDER BY created_at
  `)).rows ?? [];
  if (!form || contactRows.length === 0) {
    ctx.log("skipped — needs the seeded form and contacts (forms.ts, contacts.ts)");
    return;
  }
  const contacts = contactRows.map((row) => row.id as ContactId);
  const noAnswers = cleanAnswersSchema.parse([]);

  const create = async (key: string, title: string, status: SubmissionStatus, index: number) => {
    const primary = contacts[index % contacts.length];
    if (!primary) return;
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
        descriptionHtml: key === "xss"
          // The standing probe, in rich text as well as in a title.
          ? '<p>Before: <img src=x onerror=alert(1)><script>alert(2)</script> after.</p>'
          : `<p>A talk about ${title.toLowerCase().slice(0, 60)}.</p>`,
      },
      participants: [
        { contactId: primary, role: "speaker", isPrimary: true, sortOrder: 0 },
        ...(second && second !== primary ? [{ contactId: second, role: "co_speaker" as const, isPrimary: false, sortOrder: 1 }] : []),
      ],
      answers: noAnswers,
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

  // One row null in every nullable column it can be: the standing probe for a
  // renderer that assumes a field is always there.
  await tx.execute(sql`
    UPDATE submissions SET description_html = NULL, track_id = NULL, format_id = NULL, level = NULL,
      language = NULL, capacity = NULL, client_session_id = NULL
    WHERE event_id = ${eventId} AND title = ${SPREAD[SPREAD.length - 1]?.title ?? ""}
  `);

  ctx.log(`seeded ${SPREAD.length + HOSTILE.length + 2} submissions across every status, including the XSS, emoji, RTL and null probes`);
}
