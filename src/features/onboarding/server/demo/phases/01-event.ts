import { sql } from "drizzle-orm";
import { embeds, rooms, sessionFormats, tags, tracks } from "@/db/schema";
import { createEventIn, type CreateEventInput } from "@/features/events";
import { EMBED_CONTENT_TYPES, type EmbedContentType } from "@/shared/contracts";
import { DEMO_TIMEZONE, demoNowFromEventStart } from "../clock";
import { FORMATS, ROOMS, TAGS, TRACKS } from "../dataset";
import { demoId, demoSlug } from "../ids";
import type { PhaseCtx } from "./context";

/**
 * Phase 1 — the event itself, and the vocabulary everything later hangs off.
 *
 * `createEventIn` is called with the demo flag as its **non-schema options
 * argument** (design D2). That is the single most important line in the whole
 * provisioner: `is_demo` is written inside the INSERT, so a demo event cannot
 * exist unflagged for even one instant, and the flag has no HTTP surface at all
 * — the comms dispatcher's suppression guard and the billing exemption both
 * hang off that column, and an `isDemo` field on `createEventInputSchema` would
 * let any organizer mint unlimited plan-exempt events over the wire.
 *
 * What this phase deliberately does **not** do: it never calls
 * `provisionOrganizationEventIn`. That composition writes an
 * `event_onboarding_progress` row, and a demo checkpoint would strand the
 * organizer in the setup wizard forever (design §1.4, Trap A). It also never
 * calls the entitlement gate or the usage counter, and never records
 * `event_created` — a tutorial must not look like a conversion in the funnel.
 *
 * Replay: `createEventIn` recognizes its own stable id, returns the existing
 * event, and re-runs its idempotent defaults only if the orphan heuristic says
 * the original create stopped early. Every vocabulary write below is an upsert.
 *
 * Returns the **effective** frozen clock: the `now` the committed event row is
 * actually authored against, recovered from its `starts_at` rather than taken
 * from this request's wall clock. On a first run the two agree; on a replay of
 * a phase 1 whose cursor insert never landed they do not, and it is the
 * committed row every later phase has to stay in step with. See
 * `demoNowFromEventStart`.
 */
export async function runEventPhase(ctx: PhaseCtx): Promise<Date> {
  const { dbOrTx, eventId, organizationId, actorUserId, dates } = ctx;

  const input: CreateEventInput = {
    id: eventId,
    name: dates.event.name,
    slug: demoSlug(eventId),
    eventType: "conference",
    // Left blank rather than pointed at the real conference's website: every
    // outward-facing string in this world has to be unmistakably a prop.
    websiteUrl: "",
    location: "Moscone West, San Francisco, CA",
    timezone: DEMO_TIMEZONE,
    startsAt: dates.event.startsAt.toISOString(),
    endsAt: dates.event.endsAt.toISOString(),
    theme: "Three days of engineers who ship with AI, and the people building the tools they ship with.",
  };
  const event = await createEventIn(dbOrTx, actorUserId, input, organizationId, { isDemo: true });

  await upsertVocabularyIn(ctx);
  await seedDisabledEmbedsIn(ctx);

  // Almost always the same instant this phase was handed: the row it just
  // wrote carries the window this `now` authored. It differs only when
  // `createEventIn` recovered an event an earlier attempt had already
  // committed, in which case the committed window is the authority and the
  // clock has to be recovered from it.
  const committedStartsAt = new Date(event.startsAt);
  return committedStartsAt.getTime() === dates.event.startsAt.getTime()
    ? ctx.now
    : demoNowFromEventStart(committedStartsAt);
}

/**
 * Five embed configurations, all **off**.
 *
 * `listEmbedConfigsIn` creates any missing row `enabled: true` the first time
 * an organizer opens `/events/{id}/embeds`, which for a demo would be wrong
 * twice over. Rail 8 says fabricated content stays out of the world until the
 * organizer publishes it in Chapter 8 — an embed created enabled would put an
 * unpublished-but-embeddable surface on the internet the moment the tour
 * routed the player to that page. And it would break the chapter's own last
 * beat: the objective is `embedEnabled changed`, so a page that enables the
 * embed just by being opened leaves nothing for "Turn on the Agenda embed"
 * to do, and the card would wait forever on an act the player had already
 * been given for free.
 *
 * Written here rather than through `@/features/public`'s reader because that
 * feature publishes no barrel; the row shape is the whole contract and the
 * names mirror its `DEFAULT_EMBED_NAME` so an organizer who later opens the
 * page sees the ordinary product, not a demo dialect.
 */
const EMBED_NAMES: Record<EmbedContentType, string> = {
  agenda: "Agenda",
  session_list: "Sessions list",
  schedule_itinerary: "Schedule itinerary",
  speaker_list: "Speakers list",
  speaker_gallery: "Speaker gallery",
};

async function seedDisabledEmbedsIn({ dbOrTx, eventId }: PhaseCtx): Promise<void> {
  await dbOrTx.insert(embeds).values(EMBED_CONTENT_TYPES.map((contentType) => ({
    id: demoId(eventId, `embed:${contentType}`),
    eventId,
    contentType,
    name: EMBED_NAMES[contentType],
    enabled: false,
    // Untargeted: `drizzle/0049` added a second unique on
    // (event_id, content_type), and a replay of this phase can meet either —
    // the id when it is re-seeding its own rows, the pair if an organizer
    // opened the embeds page in between and `getOrCreateEmbedConfigIn` wrote
    // one first. A targeted DO NOTHING only swallows the conflict it names.
  }))).onConflictDoNothing();
}

/**
 * All four vocabularies, upserted on `(event_id, name)`.
 *
 * The conflict target is the name, not the id, because `createEventIn` has
 * already seeded five default formats and four of them share a name with a demo
 * format (Keynote, Talk, Workshop, Panel). Targeting the name means the demo's
 * durations land on the rows that already exist — `Talk` becomes the real
 * AI Engineer World's Fair 18-minute slot rather than the platform's rounder 30
 * — instead of raising a unique violation the phase would have to catch.
 *
 * The consequence is that four format ids are the platform's rather than the
 * demo's, which is why every later phase resolves vocabulary through
 * `readDemoVocabIn` instead of recomputing `demoId`.
 */
async function upsertVocabularyIn({ dbOrTx, eventId, now }: PhaseCtx): Promise<void> {
  // `excluded.*` restates the row this INSERT proposed, so a replay converges
  // on the dataset's values rather than on whatever is already there.
  const sortOrder = sql`excluded.sort_order`;

  await dbOrTx.insert(tracks).values(TRACKS.map((track, index) => ({
    id: demoId(eventId, `track:${track.key}`),
    eventId,
    name: track.name,
    color: track.color,
    sortOrder: index,
  }))).onConflictDoUpdate({
    target: [tracks.eventId, tracks.name],
    set: { color: sql`excluded.color`, sortOrder, updatedAt: now },
  });

  await dbOrTx.insert(rooms).values(ROOMS.map((room, index) => ({
    id: demoId(eventId, `room:${room.key}`),
    eventId,
    name: room.name,
    capacity: room.capacity,
    sortOrder: index,
  }))).onConflictDoUpdate({
    target: [rooms.eventId, rooms.name],
    set: { capacity: sql`excluded.capacity`, sortOrder, updatedAt: now },
  });

  await dbOrTx.insert(sessionFormats).values(FORMATS.map((format, index) => ({
    id: demoId(eventId, `format:${format.key}`),
    eventId,
    name: format.name,
    defaultDurationMins: format.defaultDurationMins,
    sortOrder: index,
  }))).onConflictDoUpdate({
    target: [sessionFormats.eventId, sessionFormats.name],
    set: { defaultDurationMins: sql`excluded.default_duration_mins`, sortOrder, updatedAt: now },
  });

  await dbOrTx.insert(tags).values(TAGS.map((tag) => ({
    id: demoId(eventId, `tag:${tag.key}`),
    eventId,
    name: tag.name,
  }))).onConflictDoNothing({ target: [tags.eventId, tags.name] });
}
