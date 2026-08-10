import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EventId } from "@/shared/contracts";

const revalidatePath = vi.fn<(path: string) => void>();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

/** One `select().from().where().limit()` chain, resolving to whatever is queued. */
let rows: Array<{ slug: string }> | Error = [{ slug: "sandbox-nyc" }];
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (rows instanceof Error) throw rows;
            return rows;
          },
        }),
      }),
    }),
  },
}));

const { revalidatePublicEvent, revalidatePublicEmbed } = await import("./revalidate-public");

const eventId = "11111111-1111-4111-8111-111111111111" as EventId;

/**
 * M53 split the public schedule into five surfaces and left `/e/<slug>/schedule`
 * a bare redirect with no `revalidate` of its own, so revalidating that one path
 * dropped nothing and every page that really shows sessions kept serving stale
 * HTML for the full 60 s. These cases pin the fan-out to the routes that
 * actually render each surface — on both the direct and (since the M53
 * caching-regression fix made `/embed/**` cacheable too) the embed variant.
 */
describe("revalidatePublicEvent", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
    rows = [{ slug: "sandbox-nyc" }];
  });

  it("drops every page (direct and embed) that renders the published schedule", async () => {
    await revalidatePublicEvent(eventId, ["schedule"], "req-1");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/e/sandbox-nyc/agenda",
      "/embed/sandbox-nyc/agenda",
      "/e/sandbox-nyc/sessions",
      "/embed/sandbox-nyc/sessions",
      "/e/sandbox-nyc/itinerary",
      "/embed/sandbox-nyc/itinerary",
    ]);
  });

  it("drops both speaker surfaces, direct and embed", async () => {
    await revalidatePublicEvent(eventId, ["speakers"], "req-2");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/e/sandbox-nyc/speakers",
      "/embed/sandbox-nyc/speakers",
      "/e/sandbox-nyc/gallery",
      "/embed/sandbox-nyc/gallery",
    ]);
  });

  it("never revalidates a shared route twice for the common pair", async () => {
    await revalidatePublicEvent(eventId, ["schedule", "speakers"], "req-3");
    const paths = revalidatePath.mock.calls.map(([path]) => path);
    expect(paths).toHaveLength(new Set(paths).size);
    // 5 shared routes × (direct + embed) = 10.
    expect(paths).toHaveLength(10);
  });

  it("does nothing for an event that no longer exists", async () => {
    rows = [];
    await revalidatePublicEvent(eventId, ["schedule"], "req-4");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /**
   * The write that triggered this already committed. An organizer must never be
   * shown an error for a change that landed, so a failure here degrades to the
   * page refreshing on its own 60 s schedule.
   */
  it("swallows a lookup failure rather than failing the write that committed", async () => {
    rows = new Error("connection reset");
    await expect(revalidatePublicEvent(eventId, ["schedule"], "req-5")).resolves.toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * A saved embed config only ever affects its own `/embed/[slug]/<route>`
 * page — the direct `/e/**` page never reads it — so this fan-out is
 * deliberately one path, not a call into `revalidatePublicEvent` above.
 */
describe("revalidatePublicEmbed", () => {
  beforeEach(() => {
    revalidatePath.mockClear();
    rows = [{ slug: "sandbox-nyc" }];
  });

  it.each([
    ["session_list", "/embed/sandbox-nyc/sessions"],
    ["agenda", "/embed/sandbox-nyc/agenda"],
    ["schedule_itinerary", "/embed/sandbox-nyc/itinerary"],
    ["speaker_list", "/embed/sandbox-nyc/speakers"],
    ["speaker_gallery", "/embed/sandbox-nyc/gallery"],
  ] as const)("maps %s to its own embed route only", async (contentType, expected) => {
    await revalidatePublicEmbed(eventId, contentType, "req-6");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([expected]);
  });

  it("does nothing for an event that no longer exists", async () => {
    rows = [];
    await revalidatePublicEmbed(eventId, "agenda", "req-7");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("swallows a lookup failure rather than failing the write that committed", async () => {
    rows = new Error("connection reset");
    await expect(revalidatePublicEmbed(eventId, "agenda", "req-8")).resolves.toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * The cases above pin what the helper does with the surfaces it is handed; they
 * say nothing about which surfaces a caller hands it, and that is where the bug
 * lives. A session write is never schedule-only: `published_speakers_v` is
 * derived from published sessions (`0001_views_triggers.sql`, joined on
 * `s.starts_at IS NOT NULL`), and the speaker pages print each session's start
 * time, room name and title. So a move, a bulk Apply or a revision restore that
 * asks for `["schedule"]` alone leaves /speakers and /gallery — and their embed
 * twins — stale for the full 60 s, and a move to or from the unscheduled tray
 * leaves them showing the wrong *set* of speakers, not merely a stale field.
 *
 * This reads the route sources rather than invoking the handlers: the mistake is
 * a literal in the call, one character from correct, and every one of these
 * routes needs a request, an auth session and a database to run.
 */
describe("session-mutating routes ask for both public surfaces", () => {
  const SESSION_WRITE_ROUTES = [
    "../../app/api/internal/agenda/sessions/route.ts",
    "../../app/api/internal/agenda/sessions/[sessionId]/route.ts",
    "../../app/api/internal/agenda/sessions/[sessionId]/move/route.ts",
    "../../app/api/internal/agenda/sessions/[sessionId]/revisions/route.ts",
    "../../app/api/internal/agenda/sessions/bulk-publish/route.ts",
    "../../app/api/internal/agenda/placements/apply/route.ts",
  ] as const;

  it.each(SESSION_WRITE_ROUTES)("%s revalidates speakers as well as schedule", (route) => {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    const calls = source.match(/revalidatePublicEvent\([^)]*\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain('"schedule"');
      expect(call).toContain('"speakers"');
    }
  });
});
