import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { eventIdSchema, type EventDTO } from "@/shared/contracts";
import {
  eventDetailsDraftFrom,
  eventDetailsValidationErrors,
  eventSlugValidationError,
  focusDetailsError,
  focusDetailsNotice,
  incomingEventDetailsAction,
  isEventDetailsDraftDirty,
  STALE_NOTICE_A11Y,
} from "./details-tab";

const fixtureEvent = {
  id: eventIdSchema.parse("00000000-0000-4000-8000-0000000000e1"),
  name: "AI.Engineer Sandbox — NYC",
  slug: "ai-engineer-sandbox-event",
  eventType: "conference",
  websiteUrl: null,
  location: "New York, NY",
  physicalAddress: null,
  timezone: "America/Los_Angeles",
  startsAt: "2026-11-12T17:00:00.000Z",
  endsAt: "2026-11-14T01:00:00.000Z",
  theme: null,
  logoFileId: null,
  backgroundFileId: null,
  submissionCapPerUser: 3,
  rowVersion: 1,
} satisfies EventDTO;

describe("event details slug validation", () => {
  it("rejects invalid and reserved slugs before save", () => {
    expect(eventSlugValidationError(" ")).toBe("Event slug is required");
    expect(eventSlugValidationError("My Event")).toBe("Slug must be lowercase letters, numbers and single hyphens");
    expect(eventSlugValidationError("two--hyphens")).toBe("Slug must be lowercase letters, numbers and single hyphens");
    expect(eventSlugValidationError("portal")).toBe("“portal” is a reserved word and cannot be used as a slug");
  });

  it("accepts a trimmed lowercase slug", () => {
    expect(eventSlugValidationError("  my-event-2026  ")).toBeNull();
  });

  it("associates each invalid value with the first field that must recover focus", () => {
    expect(eventDetailsValidationErrors({ name: "", slug: "My Event", startsAt: null, endsAt: null, theme: "" })).toEqual({
      name: "Event name is required",
      slug: "Slug must be lowercase letters, numbers and single hyphens",
      startsAt: "Start date and time are required",
      endsAt: "End date and time are required",
    });

    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    focusDetailsError({ querySelector }, { current: null }, (callback) => callback());
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
    expect(focus).toHaveBeenCalledOnce();
  });

  it("focuses the alert summary when a response error has no invalid field", () => {
    const focus = vi.fn();
    focusDetailsError(null, { current: { focus } }, (callback) => callback());
    expect(focus).toHaveBeenCalledOnce();
  });

  it("announces and focuses a stale-write recovery notice", () => {
    expect(STALE_NOTICE_A11Y).toEqual({ role: "alert", tabIndex: -1 });
    const focus = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    focusDetailsNotice({ current: { focus } }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("compares every organizer-editable detail against the saved baseline", () => {
    const baseline = eventDetailsDraftFrom(fixtureEvent);
    expect(isEventDetailsDraftDirty({ ...baseline }, baseline)).toBe(false);
    expect(isEventDetailsDraftDirty({ ...baseline, name: "A better event name" }, baseline)).toBe(true);
    expect(isEventDetailsDraftDirty({ ...baseline, physicalAddress: "123 Main St" }, baseline)).toBe(true);
    expect(isEventDetailsDraftDirty({ ...baseline, timezone: "UTC" }, baseline)).toBe(true);
  });

  it("distinguishes safe version advances from incoming detail replacements", () => {
    const baseline = eventDetailsDraftFrom(fixtureEvent);
    const dirty = { ...baseline, name: "My unsaved name" };
    const incoming = { ...baseline, location: "A newer saved venue" };

    expect(incomingEventDetailsAction({ draft: dirty, baseline, incoming: baseline })).toBe("advance-version");
    expect(incomingEventDetailsAction({ draft: baseline, baseline, incoming })).toBe("replace-pristine");
    expect(incomingEventDetailsAction({ draft: dirty, baseline, incoming })).toBe("defer-dirty");
  });

  it("guards page and button-driven tab exits, while stale recovery preserves the draft until confirmation", () => {
    const details = readFileSync(new URL("./details-tab.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");

    expect(details).toContain("useUnsavedWorkGuard(dirty)");
    expect(details).toContain("if (dirty) setConfirmingLoadLatest(true)");
    expect(details).toContain('title="Load the latest event details?"');
    expect(details).toContain('confirmLabel="Load latest"');
    expect(details).toContain("const latest = await api(`events/${event.id}`, eventDtoSchema)");
    expect(details).toContain("replaceWith(latest)");
    expect(details).not.toContain("router.refresh()");

    expect(shell).toContain("event.rowVersion > saved.rowVersion ? event : saved");
    expect(shell).toContain("runGuarded(() => allowNextNavigation(() => {");
    expect(shell).toContain("router.push(href, { scroll: false })");
    expect(shell).toContain("{ destination: href }");
  });

  it("advances branding-only versions without overwriting a details draft", () => {
    const source = readFileSync(new URL("./details-tab.tsx", import.meta.url), "utf8");

    expect(source).toContain('if (action === "advance-version") {');
    expect(source).toContain("setSourceEvent(event);");
    expect(source).toContain('if (action === "replace-pristine") {');
    expect(source).toContain("setDraft(incoming);");
    expect(source).toContain("expectedRowVersion: sourceEvent.rowVersion");
  });
});
