import { describe, expect, it } from "vitest";
import {
  POLL_BASE_MS,
  POLL_CALM_AFTER_MS,
  POLL_CEILING_MS,
  arcSteps,
  chapterStepIds,
  skipNotices,
  nextArcStepId,
  nextChapterStepId,
  nextPollIntervalMs,
  objectiveSatisfied,
  resolveTourPath,
  resolveVisibleStepId,
  routeMatches,
  tourHref,
  tourProgress,
  visibleTourSteps,
  worldChanged,
  worldSatisfied,
} from "./objectives";
import type { TourChapter, TourStep } from "./types";

const CONTEXT = { eventId: "evt-1", slug: "worlds-fair-demo" };

function step(partial: Partial<TourStep> & Pick<TourStep, "id" | "chapter">): TourStep {
  return { kind: "act", title: partial.id, body: "", ...partial };
}

const CHAPTERS: readonly TourChapter[] = [
  { id: "deck", name: "Command deck" },
  { id: "grid", name: "The grid", mobileNote: "Scheduling wants a bigger screen — come back on a laptop." },
  { id: "live", name: "Go live" },
];

const SCRIPT: readonly TourStep[] = [
  step({ id: "deck.attention", chapter: "deck", kind: "observe" }),
  step({ id: "deck.palette", chapter: "deck" }),
  step({ id: "grid.place", chapter: "grid", desktopOnly: true }),
  step({ id: "grid.resolve", chapter: "grid", desktopOnly: true }),
  step({ id: "live.publish", chapter: "live" }),
  step({ id: "quest.outbox", chapter: "live", optional: true }),
];

describe("route resolution", () => {
  it("substitutes context tokens in the path and the query", () => {
    expect(resolveTourPath("/events/:eventId/agenda", CONTEXT)).toBe("/events/evt-1/agenda");
    expect(tourHref({ path: "/e/:slug/agenda", query: { view: "day" } }, CONTEXT)).toBe("/e/worlds-fair-demo/agenda?view=day");
  });

  it("leaves an unknown token alone rather than rendering the word undefined", () => {
    expect(resolveTourPath("/events/:missing/x", CONTEXT)).toBe("/events/:missing/x");
  });
});

describe("route objectives", () => {
  const objective = { path: "/events/:eventId/abstracts", query: { status: "accepted" } };

  it("matches on the substituted path and the named query parameters", () => {
    expect(routeMatches(objective, { pathname: "/events/evt-1/abstracts", query: { status: "accepted" } }, CONTEXT)).toBe(true);
  });

  it("tolerates query parameters the step never mentioned", () => {
    // Arming a chapter adds `?arm=1`, and organizers add filters of their own.
    // Neither may un-complete a step the player already finished.
    const location = { pathname: "/events/evt-1/abstracts", query: { status: "accepted", arm: "1", q: "mcp" } };
    expect(routeMatches(objective, location, CONTEXT)).toBe(true);
  });

  it("rejects a different value for a parameter it does name", () => {
    expect(routeMatches(objective, { pathname: "/events/evt-1/abstracts", query: { status: "pending" } }, CONTEXT)).toBe(false);
  });

  it("rejects another event's identically-shaped route", () => {
    expect(routeMatches(objective, { pathname: "/events/evt-2/abstracts", query: { status: "accepted" } }, CONTEXT)).toBe(false);
  });
});

describe("world objectives", () => {
  const baseline = { conflictCount: 2, formVersions: 3, templateUpdatedAt: "2026-01-01T00:00:00Z", embedEnabled: false };

  it("fires when the fact moved the way the step asked", () => {
    expect(worldSatisfied("conflictCount", "decreased", baseline, { ...baseline, conflictCount: 1 })).toBe(true);
    expect(worldSatisfied("formVersions", "increased", baseline, { ...baseline, formVersions: 4 })).toBe(true);
    expect(worldSatisfied("templateUpdatedAt", "changed", baseline, { ...baseline, templateUpdatedAt: "2026-02-02T00:00:00Z" })).toBe(true);
  });

  it("does not fire on movement in the wrong direction, or on no movement", () => {
    expect(worldSatisfied("conflictCount", "decreased", baseline, { ...baseline, conflictCount: 3 })).toBe(false);
    expect(worldSatisfied("formVersions", "increased", baseline, baseline)).toBe(false);
    expect(worldSatisfied("templateUpdatedAt", "changed", baseline, baseline)).toBe(false);
  });

  it("measures against the persisted baseline, not the value at page load", () => {
    // The whole point of persisting the baseline: a reload mid-step must not
    // re-anchor to the post-action value and make the work invisible.
    const armedAt = { conflictCount: 2 };
    const afterTheFix = { conflictCount: 1 };
    expect(worldSatisfied("conflictCount", "decreased", armedAt, afterTheFix)).toBe(true);
    expect(worldSatisfied("conflictCount", "decreased", afterTheFix, afterTheFix)).toBe(false);
  });

  it("stays false until a baseline exists, so an unarmed step cannot self-satisfy", () => {
    expect(worldSatisfied("conflictCount", "decreased", null, { conflictCount: 0 })).toBe(false);
  });

  it("refuses to compare non-numbers with a directional delta", () => {
    expect(worldSatisfied("embedEnabled", "increased", baseline, { ...baseline, embedEnabled: true })).toBe(false);
    expect(worldSatisfied("embedEnabled", "changed", baseline, { ...baseline, embedEnabled: true })).toBe(true);
  });
});

describe("objective dispatch", () => {
  const base = {
    location: { pathname: "/events/evt-1/agenda", query: {} },
    routeContext: CONTEXT,
    world: { sessionsScheduled: 18 },
    baseline: { sessionsScheduled: 17 },
    domPresent: false,
    selfDone: false,
  };

  it("has no opinion about a step with no objective", () => {
    expect(objectiveSatisfied(undefined, base)).toBe(false);
  });

  it("routes each `via` to its own evidence", () => {
    expect(objectiveSatisfied({ via: "route", path: "/events/:eventId/agenda" }, base)).toBe(true);
    expect(objectiveSatisfied({ via: "dom", present: "abstracts.row" }, base)).toBe(false);
    expect(objectiveSatisfied({ via: "dom", present: "abstracts.row" }, { ...base, domPresent: true })).toBe(true);
    expect(objectiveSatisfied({ via: "world", fact: "sessionsScheduled", delta: "increased" }, base)).toBe(true);
    expect(objectiveSatisfied({ via: "self" }, base)).toBe(false);
    expect(objectiveSatisfied({ via: "self" }, { ...base, selfDone: true })).toBe(true);
  });
});

describe("poll cadence", () => {
  it("stays at two seconds while anything is happening", () => {
    expect(nextPollIntervalMs(POLL_BASE_MS, { armedForMs: 5_000, changed: false })).toBe(POLL_BASE_MS);
    expect(nextPollIntervalMs(9_000, { armedForMs: 120_000, changed: true })).toBe(POLL_BASE_MS);
  });

  it("stretches by half once a step has sat still for half a minute", () => {
    expect(nextPollIntervalMs(POLL_BASE_MS, { armedForMs: POLL_CALM_AFTER_MS, changed: false })).toBe(3_000);
    expect(nextPollIntervalMs(3_000, { armedForMs: 60_000, changed: false })).toBe(4_500);
  });

  it("never exceeds the ten-second ceiling", () => {
    let interval = POLL_BASE_MS;
    for (let tick = 0; tick < 40; tick += 1) interval = nextPollIntervalMs(interval, { armedForMs: 600_000, changed: false });
    expect(interval).toBe(POLL_CEILING_MS);
  });
});

describe("world change detection", () => {
  it("sees a single fact move and ignores an identical snapshot", () => {
    expect(worldChanged({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(false);
    expect(worldChanged({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(true);
    expect(worldChanged({ a: 1 }, { a: 1, b: 2 })).toBe(true);
  });
});

describe("script arithmetic", () => {
  it("reports progress in chapters, counting only the golden path", () => {
    const progress = tourProgress(CHAPTERS, SCRIPT, "grid.resolve");
    expect(progress.chapter?.name).toBe("The grid");
    expect(progress.chapterIndex).toBe(2);
    expect(progress.chapterCount).toBe(3);
    expect(progress.stepCount).toBe(5);
    expect(progress.percent).toBe(60);
  });

  it("walks the arc and skips side quests in sequence", () => {
    expect(nextArcStepId(SCRIPT, "grid.resolve")).toBe("live.publish");
    expect(nextArcStepId(SCRIPT, "live.publish")).toBe(null);
    expect(arcSteps(SCRIPT).map((entry) => entry.id)).not.toContain("quest.outbox");
  });

  it("jumps a whole chapter without stopping inside it", () => {
    expect(nextChapterStepId(SCRIPT, "deck.attention")).toBe("grid.place");
    expect(chapterStepIds(SCRIPT, "grid")).toEqual(["grid.place", "grid.resolve"]);
    // A side quest is not on the arc. Answering `null` would read to a caller
    // as "there is no chapter after this one", i.e. end the tour.
    expect(nextChapterStepId(SCRIPT, "quest.outbox")).toBe("deck.attention");
  });

  it("resolves a dropped cursor forwards, and never to the first step", () => {
    const visible = visibleTourSteps(SCRIPT, { mobile: true }).steps;
    expect(resolveVisibleStepId(SCRIPT, visible, "grid.place")).toBe("live.publish");
    expect(resolveVisibleStepId(SCRIPT, visible, "deck.palette")).toBe("deck.palette");
    // Nothing survives after the drop: the last visible step still gets to
    // carry the apology.
    expect(resolveVisibleStepId(SCRIPT, [SCRIPT[0] as TourStep], "live.publish")).toBe("deck.attention");
  });

  it("puts a cursor this build has never heard of on the next unfinished objective", () => {
    // A release renamed or retired the step somebody was standing on. The
    // resolution gets written back to the row, so answering "the first step"
    // would restart a half-finished tour *and* record the restart.
    const visible = visibleTourSteps(SCRIPT, { mobile: false }).steps;
    expect(resolveVisibleStepId(SCRIPT, visible, "grid.retired-in-m62", ["deck.attention", "deck.palette"]))
      .toBe("grid.place");
    // A side quest is never where the golden path resumes.
    expect(resolveVisibleStepId(SCRIPT, visible, "gone", ["deck.attention", "deck.palette", "grid.place", "grid.resolve", "live.publish"]))
      .toBe("deck.attention");
    // Nothing known about what was finished: the head of the script, as before.
    expect(resolveVisibleStepId(SCRIPT, visible, "gone")).toBe("deck.attention");
  });
});

describe("small screens", () => {
  it("drops desktop-only steps and names the chapter it dropped", () => {
    const visible = visibleTourSteps(SCRIPT, { mobile: true });
    expect(visible.steps.map((entry) => entry.id)).toEqual(["deck.attention", "deck.palette", "live.publish", "quest.outbox"]);
    expect(visible.droppedChapters).toEqual(["grid"]);
  });

  it("hands the dropped chapter's apology to the next step that survived", () => {
    const visible = visibleTourSteps(SCRIPT, { mobile: true });
    const notices = skipNotices(SCRIPT, visible.steps, CHAPTERS);
    // Silence would read as a bug; the player is told at the moment it happens.
    expect(notices["live.publish"]).toContain("bigger screen");
    expect(notices["deck.palette"]).toBeUndefined();
  });

  it("changes nothing at all on a laptop", () => {
    const visible = visibleTourSteps(SCRIPT, { mobile: false });
    expect(visible.steps).toBe(SCRIPT);
    expect(skipNotices(SCRIPT, visible.steps, CHAPTERS)).toEqual({});
  });
});
