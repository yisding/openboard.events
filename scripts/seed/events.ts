import { eq } from "drizzle-orm";
import { eventMembers, events, rooms, sessionFormats, tags, tracks, users } from "@/db/schema";
import { EVENT_TIMEZONE, eventLocal, type SeedCtx } from "./lib/helpers";

/**
 * Owned by M11 (WS-B1).
 *
 * The world everything else hangs off: the demo event, its vocabulary, and the
 * two admin identities. Nothing downstream can seed until this runs, so it is
 * deliberately the first module in the orchestrator's order.
 *
 * Dates are relative to the run, not literals, so the demo cannot rot: a
 * hard-coded September event reads as stale the moment September passes.
 */
const TRACKS = [
  { key: "agents", name: "AI Agents", color: "#6958d7" },
  { key: "platforms", name: "Platforms", color: "#2f8f5b" },
  { key: "security", name: "Security", color: "#b6742a" },
  { key: "community", name: "Community", color: "#c04b6a" },
];

const ROOMS = [
  { key: "main-stage", name: "Main Stage", capacity: 800 },
  { key: "workshop-a", name: "Workshop A", capacity: 120 },
  { key: "workshop-b", name: "Workshop B", capacity: 120 },
  { key: "studio", name: "Studio", capacity: 60 },
  { key: "atrium", name: "Atrium", capacity: 200 },
];

const FORMATS = [
  { key: "keynote", name: "Keynote", minutes: 45 },
  { key: "talk", name: "Talk", minutes: 30 },
  { key: "workshop", name: "Workshop", minutes: 90 },
  { key: "panel", name: "Panel", minutes: 45 },
  { key: "break", name: "Break", minutes: 15 },
];

const TAGS = ["Evals", "Safety", "Platforms", "Open source", "Community", "Tooling"];

const ADMINS = [
  { key: "organizer", email: "organizer@openboard.dev", name: "Openboard Organizer", role: "owner" as const },
  { key: "reviewer", email: "reviewer@openboard.dev", name: "Openboard Reviewer", role: "reviewer" as const },
];

export async function seedEvents(ctx: SeedCtx): Promise<void> {
  const { tx } = ctx;

  // 65 days out: far enough that the CFP is plausibly open, close enough that
  // "days to event" is a real number on the dashboard.
  const startsAt = eventLocal(ctx.now, 65, "09:00");
  const endsAt = eventLocal(ctx.now, 67, "17:00");
  const emptyStartsAt = eventLocal(ctx.now, 120, "09:00");
  const emptyEndsAt = eventLocal(ctx.now, 121, "17:00");

  await tx.insert(events).values({
    id: ctx.eventId,
    name: "AI.Engineer Sandbox — NYC",
    slug: "ai-engineer-sandbox-event",
    timezone: EVENT_TIMEZONE,
    startsAt,
    endsAt,
    submissionCapPerUser: 3,
  }).onConflictDoUpdate({
    target: events.id,
    set: { name: "AI.Engineer Sandbox — NYC", startsAt, endsAt, updatedAt: new Date() },
  });

  // The standing empty-state test. It must stay genuinely empty: every surface
  // is expected to render its designed empty state here rather than crash.
  await tx.insert(events).values({
    id: ctx.emptyEventId,
    name: "Empty Conf",
    slug: "empty-conf",
    timezone: EVENT_TIMEZONE,
    startsAt: emptyStartsAt,
    endsAt: emptyEndsAt,
  }).onConflictDoUpdate({
    target: events.id,
    set: { name: "Empty Conf", startsAt: emptyStartsAt, endsAt: emptyEndsAt, updatedAt: new Date() },
  });

  for (const [index, track] of TRACKS.entries()) {
    await tx.insert(tracks).values({
      id: ctx.id("track", track.key), eventId: ctx.eventId, name: track.name, color: track.color, sortOrder: index,
    }).onConflictDoUpdate({ target: tracks.id, set: { name: track.name, color: track.color, updatedAt: new Date() } });
  }
  for (const [index, room] of ROOMS.entries()) {
    await tx.insert(rooms).values({
      id: ctx.id("room", room.key), eventId: ctx.eventId, name: room.name, capacity: room.capacity, sortOrder: index,
    }).onConflictDoUpdate({ target: rooms.id, set: { name: room.name, capacity: room.capacity, updatedAt: new Date() } });
  }
  for (const [index, format] of FORMATS.entries()) {
    await tx.insert(sessionFormats).values({
      id: ctx.id("format", format.key), eventId: ctx.eventId, name: format.name, defaultDurationMins: format.minutes, sortOrder: index,
    }).onConflictDoUpdate({ target: sessionFormats.id, set: { name: format.name, defaultDurationMins: format.minutes, updatedAt: new Date() } });
  }
  for (const tag of TAGS) {
    await tx.insert(tags).values({
      id: ctx.id("tag", tag.toLowerCase().replace(/\s+/g, "-")), eventId: ctx.eventId, name: tag,
    }).onConflictDoUpdate({ target: tags.id, set: { name: tag, updatedAt: new Date() } });
  }

  // Identity here, credentials in `pnpm admin:bootstrap`. password_hash stays
  // null so a seeded database can never be signed into until somebody
  // deliberately sets a password — a seed that ships a working login is a seed
  // that ships a backdoor.
  for (const admin of ADMINS) {
    const [user] = await tx.insert(users)
      .values({ id: ctx.id("user", admin.key), email: admin.email, name: admin.name })
      .onConflictDoUpdate({ target: users.email, set: { name: admin.name, updatedAt: new Date() } })
      .returning({ id: users.id });
    const userId = user?.id ?? (await tx.select({ id: users.id }).from(users).where(eq(users.email, admin.email)).limit(1))[0]?.id;
    if (!userId) throw new Error(`could not resolve the seeded user ${admin.email}`);
    await tx.insert(eventMembers)
      .values({ userId, eventId: ctx.eventId, role: admin.role })
      .onConflictDoUpdate({ target: [eventMembers.userId, eventMembers.eventId], set: { role: admin.role } });
    // Both admins also belong to the empty event, or its empty states cannot be
    // checked by the people who need to check them.
    await tx.insert(eventMembers)
      .values({ userId, eventId: ctx.emptyEventId, role: admin.role })
      .onConflictDoUpdate({ target: [eventMembers.userId, eventMembers.eventId], set: { role: admin.role } });
  }

  ctx.log(`seeded 2 events, ${TRACKS.length} tracks, ${ROOMS.length} rooms, ${FORMATS.length} formats, ${TAGS.length} tags, ${ADMINS.length} admins`);
}
