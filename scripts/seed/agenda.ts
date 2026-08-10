import { sql } from "drizzle-orm";
import { sessions, sessionSpeakers } from "@/db/schema";
import { eventLocal, type SeedCtx } from "./lib/helpers";

/**
 * Owned by M28 (WS-E).
 *
 * Fifteen sessions across the two event days: twelve published and placed, three
 * unscheduled so the tray and the List view's `<Dash>` cells have something real
 * to render.
 *
 * Three properties here are asserted by other modules and must not drift:
 *
 * 1. **The two named conflict pairs.** `⚠ Demo conflict A` is a room
 *    double-booking, `⚠ Demo conflict B` is one speaker in two places. M29's
 *    acceptance suite looks them up by that prefix and checks the `kind`, and
 *    the Conflicts tab is demoed live on them.
 * 2. **A back-to-back pair that must not flag.** 10:00–10:30 followed by
 *    10:30–11:00 in the same room is a normal programme; an engine that reddens
 *    it is an engine organizers stop trusting.
 * 3. **Exactly two conflicts, not three.** Every other placement is checked
 *    against room, speaker *and* track overlap, so the demo's conflict count is
 *    a fact about the schedule rather than an accident.
 *
 * Times are authored as event-local wall clock through `eventLocal`, never as
 * bare UTC literals: a 4pm PT session written as `T16:00:00Z` lands on the wrong
 * day tab for everyone.
 */

type Placement = {
  /** Day offset from the run date, matching `events.ts`'s 65/66/67 window. */
  dayOffset: number;
  start: string;
  end: string;
  room: string;
  format: string;
};

type Seeded = {
  key: string;
  title: string;
  description: string;
  track: string | null;
  speakers: string[];
  status: "draft" | "published";
  placement: Placement | null;
};

function placed(dayOffset: number, start: string, end: string, room: string, format: string): Placement {
  return { dayOffset, start, end, room, format };
}

const SESSIONS: Seeded[] = [
  {
    key: "opening-keynote", title: "Opening keynote: the year agents grew up",
    description: "<p>Where the last twelve months actually landed, and what shipped.</p>",
    track: "agents", speakers: ["ada"], status: "published",
    placement: placed(65, "09:00", "09:45", "main-stage", "keynote"),
  },
  // The back-to-back pair. Same room, touching at 10:30, and deliberately not a
  // conflict — half-open intervals are the whole point.
  {
    key: "caching-edge", title: "Caching at the edge without losing your mind",
    description: "<p>What a CDN can and cannot do for an inference path.</p>",
    track: "platforms", speakers: ["grace"], status: "published",
    placement: placed(65, "10:00", "10:30", "main-stage", "talk"),
  },
  {
    key: "evals-survive", title: "Evals that survive contact with users",
    description: "<p>Offline scores lie. Here is what we replaced them with.</p>",
    track: "agents", speakers: ["alan"], status: "published",
    placement: placed(65, "10:30", "11:00", "main-stage", "talk"),
  },
  // Pair A — the same room at overlapping times. Different tracks and different
  // speakers, so this pair produces exactly one conflict, of kind `room`.
  {
    key: "conflict-a-1", title: "⚠ Demo conflict A — Platform deep dive",
    description: "<p>Double-booked into Workshop A on purpose, so the Conflicts tab has something to resolve.</p>",
    track: "platforms", speakers: ["katherine"], status: "published",
    placement: placed(65, "11:00", "11:45", "workshop-a", "workshop"),
  },
  {
    key: "conflict-a-2", title: "⚠ Demo conflict A — Vector search at scale",
    description: "<p>The other half of the room clash.</p>",
    track: "security", speakers: ["margaret"], status: "published",
    placement: placed(65, "11:30", "12:15", "workshop-a", "workshop"),
  },
  {
    key: "retrieval-database", title: "Retrieval is not a database problem",
    // The standing XSS probe, stored raw exactly as the submissions seed stores
    // its own: `<RichTextView>` sanitizes on render, so this proves the render
    // path rather than the write path.
    description: '<p>Before: <img src=x onerror=alert(1)><script>alert(2)</script> after.</p>',
    track: "platforms", speakers: ["barbara"], status: "published",
    placement: placed(65, "13:00", "13:30", "workshop-b", "talk"),
  },
  // Pair B — one speaker in two rooms at once. Different rooms and different
  // tracks, so this pair produces exactly one conflict, of kind `speaker`.
  {
    key: "conflict-b-1", title: "⚠ Demo conflict B — Agent evals live",
    description: "<p>Same speaker as the Guardrails workshop, at the same time, on purpose.</p>",
    track: "agents", speakers: ["linus"], status: "published",
    placement: placed(65, "14:00", "14:45", "studio", "panel"),
  },
  {
    key: "conflict-b-2", title: "⚠ Demo conflict B — Guardrails that do not annoy anyone",
    description: "<p>The other half of the speaker clash.</p>",
    track: "security", speakers: ["linus"], status: "published",
    placement: placed(65, "14:15", "15:00", "atrium", "workshop"),
  },
  {
    key: "cost-controls", title: "Cost controls for long-running agents",
    description: "<p>Budgets, caps and the alert that actually pages someone.</p>",
    track: "agents", speakers: ["tim"], status: "published",
    placement: placed(66, "09:30", "10:00", "main-stage", "talk"),
  },
  {
    key: "observability", title: "Observability for prompt pipelines",
    description: "<p>Traces that survive a prompt rewrite.</p>",
    track: "platforms", speakers: ["radia"], status: "published",
    placement: placed(66, "10:15", "10:45", "workshop-a", "talk"),
  },
  {
    key: "human-review", title: "Scaling human review",
    description: "<p>What we learned staffing a review queue that never emptied.</p>",
    track: "community", speakers: ["sophie"], status: "published",
    placement: placed(66, "11:00", "11:30", "workshop-b", "talk"),
  },
  {
    key: "closing-panel", title: "Closing panel: what we would build next",
    description: "<p>Two speakers, one room, no conflicts.</p>",
    track: "community", speakers: ["james", "shafi"], status: "published",
    placement: placed(66, "16:00", "16:45", "main-stage", "panel"),
  },
  // The tray. One of them carries no track, no room and no speakers at all —
  // the row that proves a NULL-everything session never crashes a view.
  {
    key: "unscheduled-migrating", title: "Migrating from bespoke to boring",
    description: "<p>Not placed yet.</p>",
    track: "platforms", speakers: ["ada"], status: "draft", placement: null,
  },
  {
    key: "unscheduled-unglamorous", title: "The unglamorous parts of shipping AI",
    description: "<p>Not placed yet.</p>",
    track: "community", speakers: ["grace"], status: "draft", placement: null,
  },
  {
    key: "unscheduled-lightning", title: "Lightning talks — call for volunteers",
    description: "",
    track: null, speakers: [], status: "draft", placement: null,
  },
];

export async function seedAgenda(ctx: SeedCtx): Promise<void> {
  const { tx, eventId } = ctx;

  // Rooms, tracks, formats and contacts all come from earlier modules. A seed
  // that inserts sessions pointing at ids nobody created would fail the FK
  // halfway through; saying so is more useful than a constraint error.
  const vocabulary = await tx.execute<{ n: number }>(sql`
    SELECT (SELECT count(*) FROM rooms WHERE event_id = ${eventId})
         + (SELECT count(*) FROM tracks WHERE event_id = ${eventId})
         + (SELECT count(*) FROM contacts WHERE event_id = ${eventId}) AS n
  `);
  if (Number((vocabulary.rows ?? [])[0]?.n ?? 0) === 0) {
    ctx.log("skipped — needs the seeded event vocabulary and contacts (events.ts, contacts.ts)");
    return;
  }

  let published = 0;
  let unscheduled = 0;

  for (const [index, seeded] of SESSIONS.entries()) {
    const id = ctx.id("session", seeded.key);
    const startsAt = seeded.placement
      ? eventLocal(ctx.now, seeded.placement.dayOffset, `${seeded.placement.start}:00`)
      : null;
    const endsAt = seeded.placement
      ? eventLocal(ctx.now, seeded.placement.dayOffset, `${seeded.placement.end}:00`)
      : null;

    await tx.insert(sessions).values({
      id,
      eventId,
      title: seeded.title,
      // Deterministic and stable: a re-run must update this row, not mint a
      // second slug for the same session.
      slug: seeded.key,
      descriptionHtml: seeded.description,
      trackId: seeded.track ? ctx.id("track", seeded.track) : null,
      roomId: seeded.placement ? ctx.id("room", seeded.placement.room) : null,
      formatId: seeded.placement ? ctx.id("format", seeded.placement.format) : null,
      startsAt,
      endsAt,
      status: seeded.status,
      // Published-and-placed rows already "have" a schedule, so their revision
      // starts at 1 — the same number a real publish through `saveSession`
      // would have left, which keeps M35's SEQUENCE monotonic across a reseed.
      scheduleRevision: seeded.placement && seeded.status === "published" ? 1 : 0,
    }).onConflictDoUpdate({
      target: sessions.id,
      set: {
        title: seeded.title,
        descriptionHtml: seeded.description,
        trackId: seeded.track ? ctx.id("track", seeded.track) : null,
        roomId: seeded.placement ? ctx.id("room", seeded.placement.room) : null,
        formatId: seeded.placement ? ctx.id("format", seeded.placement.format) : null,
        startsAt,
        endsAt,
        status: seeded.status,
        updatedAt: new Date(),
      },
    });

    // The speaker set is replaced rather than merged: a re-run must converge on
    // exactly the people listed above, or an edited seed leaves ghosts behind
    // that quietly invent speaker conflicts.
    await tx.execute(sql`DELETE FROM session_speakers WHERE session_id = ${id} AND event_id = ${eventId}`);
    for (const [order, speaker] of seeded.speakers.entries()) {
      await tx.insert(sessionSpeakers).values({
        eventId,
        sessionId: id,
        contactId: ctx.id("contact", speaker),
        role: order === 0 ? "speaker" : "co_speaker",
        sortOrder: order,
      }).onConflictDoNothing();
    }

    if (seeded.status === "published") published += 1;
    if (!seeded.placement) unscheduled += 1;
    if (index === SESSIONS.length - 1) {
      ctx.log(`${SESSIONS.length} sessions (${published} published, ${unscheduled} unscheduled) incl. both named conflict pairs`);
    }
  }
}
