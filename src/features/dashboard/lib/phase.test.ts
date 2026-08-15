import { describe, expect, it } from "vitest";
import { EMPTY_FIXTURE_OVERVIEW, FIXTURE_OVERVIEW } from "../__fixtures__/overview";
import { computeEventPhase, defaultTabForPhase } from "./phase";

function overview(patch: Partial<typeof FIXTURE_OVERVIEW>) {
  return { ...FIXTURE_OVERVIEW, ...patch };
}

describe("computeEventPhase", () => {
  it("is cfp while a form is open, no matter how far out the event is", () => {
    expect(computeEventPhase(FIXTURE_OVERVIEW)).toBe("cfp");
  });

  it("is decisions once the form closes and submissions are still awaiting a call", () => {
    const closed = overview({ forms: FIXTURE_OVERVIEW.forms.map((form) => ({ ...form, availability: "closed" as const })) });
    expect(computeEventPhase(closed)).toBe("decisions");
  });

  it("leaves cfp when the deadline elapses, not only when the form is closed by hand", () => {
    // Nothing writes `forms.status` when `closes_at` passes, so the ordinary
    // end state of a call is `status: "open"` with a past deadline. Reading the
    // column left the dashboard in `cfp` forever.
    const elapsed = overview({
      forms: FIXTURE_OVERVIEW.forms.map((form) => ({ ...form, status: "open" as const, availability: "ended" as const })),
    });
    expect(computeEventPhase(elapsed)).toBe("decisions");
  });

  it("stays in cfp while a form is still waiting for its opening date", () => {
    const scheduled = overview({
      forms: FIXTURE_OVERVIEW.forms.map((form) => ({ ...form, availability: "scheduled" as const })),
    });
    expect(computeEventPhase(scheduled)).toBe("cfp");
  });

  it("is onboarding once decisions are made and speakers are accepted", () => {
    const noOpenForms = overview({
      forms: [],
      statusCounts: { ...FIXTURE_OVERVIEW.statusCounts, pending: 0, accept_queue: 0, decline_queue: 0 },
    });
    expect(computeEventPhase(noOpenForms)).toBe("onboarding");
  });

  it("is live from a couple of days before the event through the event itself", () => {
    expect(computeEventPhase(overview({ event: { ...FIXTURE_OVERVIEW.event, daysToEvent: 2 } }))).toBe("live");
    expect(computeEventPhase(overview({ event: { ...FIXTURE_OVERVIEW.event, daysToEvent: 0 } }))).toBe("live");
    expect(computeEventPhase(overview({ event: { ...FIXTURE_OVERVIEW.event, daysToEvent: -6 } }))).toBe("live");
  });

  it("is wrap more than a week after the event started", () => {
    expect(computeEventPhase(overview({ event: { ...FIXTURE_OVERVIEW.event, daysToEvent: -8 } }))).toBe("wrap");
  });

  it("falls back to cfp for a brand-new event with nothing yet", () => {
    expect(computeEventPhase(EMPTY_FIXTURE_OVERVIEW)).toBe("cfp");
  });
});

describe("defaultTabForPhase", () => {
  it("leads with Speaker Tracking once there is onboarding or live work to track", () => {
    expect(defaultTabForPhase("onboarding")).toBe("speakers");
    expect(defaultTabForPhase("live")).toBe("speakers");
  });

  it("leads with Today for every other phase", () => {
    expect(defaultTabForPhase("cfp")).toBe("today");
    expect(defaultTabForPhase("decisions")).toBe("today");
    expect(defaultTabForPhase("wrap")).toBe("today");
  });
});
