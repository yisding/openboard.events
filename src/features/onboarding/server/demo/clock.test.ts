import { describe, expect, it } from "vitest";
import { eventDayKey } from "@/shared/lib/time";
import { DEMO_TIMEZONE, demoDates, demoLocal } from "./clock";

/**
 * A small, deterministic PRNG (mulberry32) rather than an unseeded
 * `Math.random()` or a `fast-check` dependency this repo does not carry —
 * a failing sample must be reproducible from the seed printed below, and a
 * fixed seed keeps this suite green from run to run.
 */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_SEED = 0x1a5c2e;
const SAMPLE_COUNT = 400;

/**
 * ~7 years around the DST transition rules currently in effect for
 * `America/Los_Angeles` (second Sunday in March / first Sunday in
 * November), so the sample set reliably straddles many spring-forward and
 * fall-back boundaries without hand-picking specific dates.
 */
const RANGE_START = Date.UTC(2024, 0, 1);
const RANGE_END = Date.UTC(2031, 0, 1);

function sampleNows(): Date[] {
  const random = mulberry32(SAMPLE_SEED);
  const samples: Date[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const instant = RANGE_START + random() * (RANGE_END - RANGE_START);
    samples.push(new Date(instant));
  }
  return samples;
}

describe("demoLocal", () => {
  it("authors an instant that reads back as the requested local time in DEMO_TIMEZONE", () => {
    const now = new Date("2026-01-15T12:00:00.000Z");
    const authored = demoLocal(now, 65, "09:00");
    const rendered = new Intl.DateTimeFormat("en-US", {
      timeZone: DEMO_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(authored);
    expect(rendered).toBe("09:00");
  });

  it("is a pure function of its inputs", () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    expect(demoLocal(now, 10, "14:30").getTime()).toBe(demoLocal(now, 10, "14:30").getTime());
  });

  it("supports negative offsets (a CFP that opened in the past)", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    const past = demoLocal(now, -20, "00:00");
    expect(past.getTime()).toBeLessThan(now.getTime());
  });
});

describe("demoDates — property test over DST boundaries (seed 0x1a5c2e, n=400)", () => {
  const samples = sampleNows();

  it("is a pure function of `now`: calling it twice with the same instant is byte-identical", () => {
    for (const now of samples) {
      const a = demoDates(new Date(now.getTime()));
      const b = demoDates(new Date(now.getTime()));
      expect(a.event.startsAt.getTime()).toBe(b.event.startsAt.getTime());
      expect(a.event.endsAt.getTime()).toBe(b.event.endsAt.getTime());
      expect(a.forms.cfp.closesAt.getTime()).toBe(b.forms.cfp.closesAt.getTime());
      expect(a.portal.overdueTaskDueAt.getTime()).toBe(b.portal.overdueTaskDueAt.getTime());
      expect(a.comms.latestLogAt.getTime()).toBe(b.comms.latestLogAt.getTime());
    }
  });

  it("the event is always in the future — the demo cannot rot", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.event.startsAt.getTime()).toBeGreaterThan(now.getTime());
      expect(dates.event.endsAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("startsAt is always before endsAt", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.event.startsAt.getTime()).toBeLessThan(dates.event.endsAt.getTime());
    }
  });

  it("the CFP is always open: opensAt is in the past and closesAt is in the future", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.forms.cfp.opensAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(dates.forms.cfp.closesAt.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it("the Expo Stage lightning form is always closed: closesAt is in the past", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.forms.expoLightning.opensAt.getTime()).toBeLessThan(dates.forms.expoLightning.closesAt.getTime());
      expect(dates.forms.expoLightning.closesAt.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("exactly one overdue task: the portal due date is always in the past, and its created date always precedes it", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.portal.overdueTaskDueAt.getTime()).toBeLessThan(now.getTime());
      expect(dates.portal.overdueTaskCreatedAt.getTime()).toBeLessThan(dates.portal.overdueTaskDueAt.getTime());
    }
  });

  it("the communications log window is always in the past and internally ordered", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.comms.earliestLogAt.getTime()).toBeLessThan(dates.comms.latestLogAt.getTime());
      expect(dates.comms.latestLogAt.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("the event name always carries the year `startsAt` actually falls in", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      const year = eventDayKey(dates.event.startsAt, DEMO_TIMEZONE).slice(0, 4);
      expect(dates.event.name).toBe(`AI Engineer World’s Fair ${year}`);
    }
  });

  it("submissions were authored before the event and before `now`", () => {
    for (const now of samples) {
      const dates = demoDates(now);
      expect(dates.submissions.earliestSubmittedAt.getTime()).toBeLessThan(dates.submissions.latestSubmittedAt.getTime());
      expect(dates.submissions.latestSubmittedAt.getTime()).toBeLessThan(now.getTime());
      expect(dates.submissions.latestSubmittedAt.getTime()).toBeLessThan(dates.event.startsAt.getTime());
    }
  });
});

describe("demoLocal across DST transitions specifically", () => {
  // America/Los_Angeles springs forward on the second Sunday in March
  // (02:00 -> 03:00 PST->PDT) and falls back on the first Sunday in
  // November (02:00 PDT -> 01:00 PST). A `now` a few days before either
  // transition, offset far enough forward to land past it, must still
  // resolve to the exact requested local clock time.
  const springForward2026 = new Date("2026-03-05T12:00:00.000Z");
  const fallBack2026 = new Date("2026-10-29T12:00:00.000Z");

  it.each([
    ["spring-forward", springForward2026, 10],
    ["fall-back", fallBack2026, 10],
  ])("%s: demoLocal still authors the exact requested local time", (_label, now, offsetDays) => {
    const authored = demoLocal(now, offsetDays, "09:15");
    const rendered = new Intl.DateTimeFormat("en-US", {
      timeZone: DEMO_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(authored);
    expect(rendered).toBe("09:15");
  });
});
