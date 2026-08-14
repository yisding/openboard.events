import { describe, expect, it } from "vitest";
import { effectiveLimit, formAvailability, formAvailabilityActionCopy, formOpenState } from "./form-open";

const NOW = "2026-08-09T18:00:00.000Z";

describe("formOpenState", () => {
  it("both dates null, status open: ok", () => {
    expect(formOpenState({ status: "open", opensAt: null, closesAt: null }, NOW)).toEqual({ open: true, reason: "ok" });
  });

  it("draft status, no dates: closed_by_admin (an unpublished form is never open)", () => {
    expect(formOpenState({ status: "draft", opensAt: null, closesAt: null }, NOW)).toEqual({ open: false, reason: "closed_by_admin" });
  });

  it("draft status even with an opens/closes window that would otherwise be open: closed_by_admin", () => {
    expect(formOpenState({
      status: "draft",
      opensAt: "2026-08-01T00:00:00.000Z",
      closesAt: "2026-09-01T00:00:00.000Z",
    }, NOW)).toEqual({ open: false, reason: "closed_by_admin" });
  });

  it("closed status wins even with a future close date (status stores admin intent)", () => {
    expect(formOpenState({
      status: "closed",
      opensAt: null,
      closesAt: "2027-01-01T00:00:00.000Z",
    }, NOW)).toEqual({ open: false, reason: "closed_by_admin" });
  });

  it("open status, opens_at in the future: not_open_yet", () => {
    expect(formOpenState({
      status: "open",
      opensAt: "2026-08-10T00:00:00.000Z",
      closesAt: null,
    }, NOW)).toEqual({ open: false, reason: "not_open_yet" });
  });

  it("open status, opens_at exactly equal to now: open (opens_at <= now in SQL)", () => {
    expect(formOpenState({ status: "open", opensAt: NOW, closesAt: null }, NOW)).toEqual({ open: true, reason: "ok" });
  });

  it("open status, opens_at in the past and no close date: ok", () => {
    expect(formOpenState({
      status: "open",
      opensAt: "2026-01-01T00:00:00.000Z",
      closesAt: null,
    }, NOW)).toEqual({ open: true, reason: "ok" });
  });

  it("open status, closes_at in the past: closed_by_date", () => {
    expect(formOpenState({
      status: "open",
      opensAt: null,
      closesAt: "2026-08-01T00:00:00.000Z",
    }, NOW)).toEqual({ open: false, reason: "closed_by_date" });
  });

  it("open status, closes_at exactly equal to now: closed (SQL uses '>', so equality is closed — the twin must agree)", () => {
    expect(formOpenState({ status: "open", opensAt: null, closesAt: NOW }, NOW)).toEqual({ open: false, reason: "closed_by_date" });
  });

  it("open status, one millisecond before close: still open", () => {
    const closesAt = "2026-08-09T18:00:00.001Z";
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, NOW)).toEqual({ open: true, reason: "ok" });
  });

  it("open status, one millisecond after close: closed_by_date", () => {
    const closesAt = "2026-08-09T17:59:59.999Z";
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, NOW)).toEqual({ open: false, reason: "closed_by_date" });
  });

  it("DST spring-forward boundary (America/Los_Angeles, 2026-03-08): the instant comparison does not care about the zone transition", () => {
    // 2026-03-08 09:59:59 UTC is 01:59:59 PST; 2026-03-08 10:00:00 UTC is
    // 03:00:00 PDT (clocks skip 2 AM entirely). formOpenState only ever
    // compares raw UTC instants, so the discontinuity in local wall-clock time
    // must not perturb the open/closed boundary.
    const closesAt = "2026-03-08T10:00:00.000Z";
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, "2026-03-08T09:59:59.999Z")).toEqual({ open: true, reason: "ok" });
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, "2026-03-08T10:00:00.000Z")).toEqual({ open: false, reason: "closed_by_date" });
  });

  it("DST fall-back boundary (America/Los_Angeles, 2026-11-01): still a plain instant comparison", () => {
    const closesAt = "2026-11-01T09:00:00.000Z";
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, "2026-11-01T08:59:59.999Z")).toEqual({ open: true, reason: "ok" });
    expect(formOpenState({ status: "open", opensAt: null, closesAt }, "2026-11-01T09:00:00.000Z")).toEqual({ open: false, reason: "closed_by_date" });
  });

  it("open status, opens_at in the future beats an already-past close date (not_open_yet takes precedence in the checked order)", () => {
    expect(formOpenState({
      status: "open",
      opensAt: "2027-01-01T00:00:00.000Z",
      closesAt: "2026-01-01T00:00:00.000Z",
    }, NOW)).toEqual({ open: false, reason: "not_open_yet" });
  });
});

describe("formAvailability", () => {
  it.each([
    ["draft", { status: "draft" as const, opensAt: null, closesAt: null }],
    ["scheduled", { status: "open" as const, opensAt: "2026-08-10T00:00:00.000Z", closesAt: null }],
    ["live", { status: "open" as const, opensAt: NOW, closesAt: "2026-08-09T18:00:00.001Z" }],
    ["ended", { status: "open" as const, opensAt: null, closesAt: NOW }],
    ["closed", { status: "closed" as const, opensAt: null, closesAt: "2027-01-01T00:00:00.000Z" }],
  ])("labels an organizer form as %s", (expected, form) => {
    expect(formAvailability(form, NOW)).toBe(expected);
  });
});

describe("formAvailabilityActionCopy", () => {
  const now = "2026-08-12T20:00:00.000Z";

  it("distinguishes opening now from scheduling a future opening", () => {
    expect(formAvailabilityActionCopy("open", { opensAt: null, closesAt: null }, now)).toMatchObject({
      title: "Open this form now?",
      confirmLabel: "Open form",
    });
    expect(formAvailabilityActionCopy("open", { opensAt: "2026-08-13T20:00:00.000Z", closesAt: null }, now)).toMatchObject({
      title: "Schedule this form to open?",
      confirmLabel: "Schedule form",
    });
  });

  it("warns that closing blocks in-progress submissions", () => {
    const copy = formAvailabilityActionCopy("close", { opensAt: null, closesAt: null }, now);
    expect(copy.title).toBe("Stop accepting submissions now?");
    expect(copy.confirmLabel).toBe("Stop accepting submissions");
    expect(copy.body).toContain("in-progress drafts will not be able to submit");
  });

  it("does not imply a past closing time will accept submissions", () => {
    expect(formAvailabilityActionCopy("open", { opensAt: null, closesAt: now }, now)).toMatchObject({
      title: "Set this ended form to open?",
      confirmLabel: "Set status to open",
    });
  });
});

describe("effectiveLimit", () => {
  it("falls back to the event's per-user cap when the form sets no limit", () => {
    expect(effectiveLimit({ submissionLimit: null }, { submissionCapPerUser: 3 })).toBe(3);
  });

  it("uses the form's own limit when set, even when lower than the event cap", () => {
    expect(effectiveLimit({ submissionLimit: 1 }, { submissionCapPerUser: 3 })).toBe(1);
  });

  it("uses the form's own limit when set, even when higher than the event cap", () => {
    expect(effectiveLimit({ submissionLimit: 10 }, { submissionCapPerUser: 3 })).toBe(10);
  });
});
